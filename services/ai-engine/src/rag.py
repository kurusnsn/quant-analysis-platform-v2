from __future__ import annotations

from typing import List, Tuple, Dict, Any, Optional
from collections import OrderedDict
import re
import time
import uuid
import os

from llama_index.core import (
    Document,
    VectorStoreIndex,
    StorageContext,
    load_index_from_storage,
)
from llama_index.core.embeddings.mock_embed_model import MockEmbedding
from llama_index.core.indices.vector_store.retrievers.retriever import VectorIndexRetriever
from llama_index.core.node_parser import HierarchicalNodeParser, get_leaf_nodes
from llama_index.core.retrievers import AutoMergingRetriever
from llama_index.core.schema import MetadataMode
from llama_index.core.vector_stores.types import VectorStoreQueryMode

class VectorStore:
    """
    Lightweight LlamaIndex-backed RAG store.

    Design goals for quant-platform:
    - No direct DB dependency by default (ai-engine runs in a restricted network).
    - Stronger retrieval for "deep insights" via hierarchical chunking + auto-merging + MMR.
    - Lazy initialization so unit tests can freely instantiate VectorStore without
      downloading models.
    """

    _PERSIST_FILES = ("docstore.json", "index_store.json", "vector_store.json")
    _INGESTED_AT_FIELD = "_ingested_at"

    def __init__(self, connection_string: str):
        # Keep the arg name for backward compatibility; it is treated as a generic store URI.
        self.connection_string = connection_string

        self._persist_base_dir = self._resolve_persist_base_dir()
        self._embed_model = None
        self._node_parser = None

        self._cache_max_users = int(os.getenv("RAG_CACHE_MAX_USERS", "64"))
        self._index_cache: "OrderedDict[str, VectorStoreIndex]" = OrderedDict()
        self._max_docs_per_user = max(0, int(os.getenv("RAG_MAX_DOCS_PER_USER", "600")))
        self._retention_days = max(0, int(os.getenv("RAG_RETENTION_DAYS", "365")))
        self._prune_cooldown_seconds = max(0, int(os.getenv("RAG_PRUNE_COOLDOWN_SEC", "45")))
        self._last_prune_by_user: Dict[str, float] = {}

    def _resolve_persist_base_dir(self) -> str:
        configured = os.getenv("RAG_PERSIST_DIR")
        if configured:
            return configured

        # Container-friendly default (ai-engine mounts a writable /app/cache volume).
        if os.path.isdir("/app/cache"):
            return "/app/cache/rag"

        # Local dev default.
        return os.path.join(os.getcwd(), "cache", "rag")

    def _safe_user_key(self, user_id: str) -> str:
        # Prevent path traversal and keep dirs readable.
        key = re.sub(r"[^a-zA-Z0-9_-]+", "_", (user_id or "").strip())
        return (key or "anon")[:128]

    def _user_dir(self, user_id: str) -> str:
        return os.path.join(self._persist_base_dir, self._safe_user_key(user_id))

    def _persisted_store_exists(self, persist_dir: str) -> bool:
        return all(os.path.exists(os.path.join(persist_dir, f)) for f in self._PERSIST_FILES)

    def _get_embed_model(self):
        if self._embed_model is not None:
            return self._embed_model

        embed_model_name = os.getenv("RAG_EMBED_MODEL", "BAAI/bge-small-en-v1.5").strip()
        if embed_model_name.lower() == "mock":
            embed_dim = int(os.getenv("RAG_EMBED_DIM", "16"))
            self._embed_model = MockEmbedding(embed_dim=embed_dim)
            return self._embed_model

        # Import lazily so unit tests can run without installing optional embedding backends.
        try:
            from llama_index.embeddings.huggingface import HuggingFaceEmbedding
        except Exception as e:  # pragma: no cover
            raise RuntimeError(
                "HuggingFace embeddings backend is not available. "
                "Install `llama-index-embeddings-huggingface` (and `sentence-transformers`) "
                "or set RAG_EMBED_MODEL=mock for tests."
            ) from e

        self._embed_model = HuggingFaceEmbedding(model_name=embed_model_name)
        return self._embed_model

    def _get_node_parser(self) -> HierarchicalNodeParser:
        if self._node_parser is not None:
            return self._node_parser

        # Multi-granularity chunks allow deep queries to "zoom out" when needed.
        raw_sizes = os.getenv("RAG_CHUNK_SIZES", "2048,512,128")
        try:
            chunk_sizes = [int(x.strip()) for x in raw_sizes.split(",") if x.strip()]
        except ValueError:
            chunk_sizes = [2048, 512, 128]

        chunk_overlap = int(os.getenv("RAG_CHUNK_OVERLAP", "64"))
        self._node_parser = HierarchicalNodeParser.from_defaults(
            chunk_sizes=chunk_sizes,
            chunk_overlap=chunk_overlap,
        )
        return self._node_parser

    def _cache_get(self, key: str) -> Optional[VectorStoreIndex]:
        index = self._index_cache.get(key)
        if index is None:
            return None
        self._index_cache.move_to_end(key)
        return index

    def _cache_put(self, key: str, index: VectorStoreIndex) -> None:
        self._index_cache[key] = index
        self._index_cache.move_to_end(key)
        while len(self._index_cache) > self._cache_max_users:
            self._index_cache.popitem(last=False)

    def _coerce_timestamp(self, value: Any) -> float:
        if isinstance(value, (int, float)):
            return float(value)
        if isinstance(value, str):
            try:
                return float(value.strip())
            except ValueError:
                return 0.0
        return 0.0

    def _insert_documents(self, index: VectorStoreIndex, docs: List[Document]) -> None:
        if not docs:
            return

        node_parser = self._get_node_parser()
        nodes = node_parser.get_nodes_from_documents(docs)
        leaf_nodes = get_leaf_nodes(nodes)

        # Persist hierarchical nodes for auto-merging, but only index leaf nodes.
        index.storage_context.docstore.add_documents(nodes, allow_update=True)
        index.insert_nodes(leaf_nodes)

    def _collect_ref_documents(self, index: VectorStoreIndex) -> List[Dict[str, Any]]:
        docstore = index.storage_context.docstore
        if not hasattr(docstore, "get_all_ref_doc_info"):
            return []

        ref_infos = docstore.get_all_ref_doc_info() or {}
        stored_nodes = getattr(docstore, "docs", {}) or {}
        collected: List[Dict[str, Any]] = []

        for ref_doc_id, ref_info in ref_infos.items():
            meta = dict(getattr(ref_info, "metadata", {}) or {})
            node_ids = list(getattr(ref_info, "node_ids", []) or [])
            best_text = ""

            for node_id in node_ids:
                node = stored_nodes.get(node_id)
                if node is None:
                    continue
                try:
                    text = node.get_content(metadata_mode=MetadataMode.NONE)
                except Exception:
                    text = getattr(node, "text", "") or ""
                if len(text) > len(best_text):
                    best_text = text

            if not best_text:
                continue

            collected.append(
                {
                    "doc_id": ref_doc_id,
                    "text": best_text,
                    "metadata": meta,
                    "ingested_at": self._coerce_timestamp(meta.get(self._INGESTED_AT_FIELD)),
                }
            )

        collected.sort(key=lambda item: item["ingested_at"], reverse=True)
        return collected

    def _rebuild_user_index(self, user_id: str, docs: List[Dict[str, Any]]) -> VectorStoreIndex:
        embed_model = self._get_embed_model()
        storage_context = StorageContext.from_defaults()
        rebuilt = VectorStoreIndex(nodes=[], storage_context=storage_context, embed_model=embed_model)

        rebuilt_docs: List[Document] = []
        for item in docs:
            metadata = dict(item.get("metadata", {}) or {})
            metadata["user_id"] = user_id
            if self._coerce_timestamp(metadata.get(self._INGESTED_AT_FIELD)) <= 0:
                metadata[self._INGESTED_AT_FIELD] = time.time()

            rebuilt_docs.append(
                Document(
                    text=str(item.get("text", "")),
                    metadata=metadata,
                    id_=str(item.get("doc_id", uuid.uuid4())),
                )
            )

        self._insert_documents(rebuilt, rebuilt_docs)
        storage_context.persist(persist_dir=self._user_dir(user_id))
        return rebuilt

    def _prune_user_index(self, user_id: str, index: VectorStoreIndex) -> VectorStoreIndex:
        if self._max_docs_per_user == 0 and self._retention_days == 0:
            return index

        user_dir = self._user_dir(user_id)
        now = time.time()
        last_prune = self._last_prune_by_user.get(user_dir, 0.0)
        if self._prune_cooldown_seconds > 0 and (now - last_prune) < self._prune_cooldown_seconds:
            return index
        self._last_prune_by_user[user_dir] = now

        ref_docs = self._collect_ref_documents(index)
        if not ref_docs:
            return index

        retained = ref_docs
        if self._retention_days > 0:
            cutoff_ts = now - (self._retention_days * 86400)
            retained = [doc for doc in retained if doc["ingested_at"] >= cutoff_ts]

        if self._max_docs_per_user > 0 and len(retained) > self._max_docs_per_user:
            retained = retained[: self._max_docs_per_user]

        if len(retained) == len(ref_docs):
            return index

        rebuilt = self._rebuild_user_index(user_id=user_id, docs=retained)
        self._cache_put(user_dir, rebuilt)
        return rebuilt

    def _load_or_create_index(self, user_id: str, create_if_missing: bool) -> Optional[VectorStoreIndex]:
        persist_dir = self._user_dir(user_id)
        cached = self._cache_get(persist_dir)
        if cached is not None:
            return cached

        os.makedirs(persist_dir, exist_ok=True)

        if self._persisted_store_exists(persist_dir):
            embed_model = self._get_embed_model()
            storage_context = StorageContext.from_defaults(persist_dir=persist_dir)
            index = load_index_from_storage(storage_context, embed_model=embed_model)
            self._cache_put(persist_dir, index)
            return index

        if not create_if_missing:
            return None

        embed_model = self._get_embed_model()

        # Create an empty index: we need a doc to generate structures; callers will insert.
        storage_context = StorageContext.from_defaults()
        index = VectorStoreIndex(nodes=[], storage_context=storage_context, embed_model=embed_model)
        storage_context.persist(persist_dir=persist_dir)
        self._cache_put(persist_dir, index)
        return index

    def ingest(self, content: str, metadata: Dict[str, Any]) -> str:
        """
        Chunks, embeds, and stores the document.
        Returns document ID.
        """
        user_id = (metadata or {}).get("user_id")
        if not user_id:
            raise ValueError("metadata.user_id is required for ingestion")

        normalized_meta = dict(metadata or {})
        normalized_meta["user_id"] = user_id
        if self._coerce_timestamp(normalized_meta.get(self._INGESTED_AT_FIELD)) <= 0:
            normalized_meta[self._INGESTED_AT_FIELD] = time.time()

        doc_id = str(uuid.uuid4())
        doc = Document(text=content, metadata=normalized_meta, id_=doc_id)

        index = self._load_or_create_index(user_id=user_id, create_if_missing=True)
        if index is None:  # pragma: no cover
            raise RuntimeError("Failed to initialize RAG index")

        self._insert_documents(index, [doc])
        index = self._prune_user_index(user_id=user_id, index=index)

        index.storage_context.persist(persist_dir=self._user_dir(user_id))
        return doc_id

    def retrieve(
        self,
        query: str,
        user_id: str,
        k: int = 3,
        deep: bool = False,
    ) -> List[Tuple[str, Dict[str, Any]]]:
        """
        Retrieves relevant chunks scoped by user_id.
        """
        index = self._load_or_create_index(user_id=user_id, create_if_missing=False)
        if index is None:
            return []

        embed_model = self._get_embed_model()

        # Deep mode: get a larger, more diverse candidate set and then auto-merge.
        similarity_top_k = max(k, int(os.getenv("RAG_TOP_K_DEEP", "12"))) if deep else k
        query_mode = VectorStoreQueryMode.MMR if deep else VectorStoreQueryMode.DEFAULT

        base_retriever = VectorIndexRetriever(
            index=index,
            similarity_top_k=similarity_top_k,
            vector_store_query_mode=query_mode,
            embed_model=embed_model,
        )
        retriever = (
            AutoMergingRetriever(
                base_retriever,
                storage_context=index.storage_context,
                simple_ratio_thresh=float(os.getenv("RAG_AUTO_MERGE_RATIO", "0.5")),
            )
            if deep
            else base_retriever
        )

        retrieved = retriever.retrieve(query)

        # Unpack results: (text, metadata)
        results: List[Tuple[str, Dict[str, Any]]] = []
        for item in retrieved[:k]:
            node = getattr(item, "node", item)
            score = getattr(item, "score", None)

            text = node.get_content(metadata_mode=MetadataMode.NONE)
            meta = dict(getattr(node, "metadata", {}) or {})
            if score is not None:
                meta["score"] = score
            results.append((text, meta))

        return results
