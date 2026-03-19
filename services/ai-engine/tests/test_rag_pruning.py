from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.rag import VectorStore


def _ref_metadata(store: VectorStore, user_id: str):
    index = store._load_or_create_index(user_id=user_id, create_if_missing=False)
    assert index is not None
    return list((index.storage_context.docstore.get_all_ref_doc_info() or {}).values())


def test_prunes_to_max_docs_per_user(monkeypatch, tmp_path):
    monkeypatch.setenv("RAG_PERSIST_DIR", str(tmp_path))
    monkeypatch.setenv("RAG_EMBED_MODEL", "mock")
    monkeypatch.setenv("RAG_EMBED_DIM", "8")
    monkeypatch.setenv("RAG_MAX_DOCS_PER_USER", "2")
    monkeypatch.setenv("RAG_RETENTION_DAYS", "0")
    monkeypatch.setenv("RAG_PRUNE_COOLDOWN_SEC", "0")

    store = VectorStore(connection_string="local://")
    user_id = "u1"

    store.ingest("first context", metadata={"user_id": user_id, "seq": 1, "_ingested_at": 1})
    store.ingest("second context", metadata={"user_id": user_id, "seq": 2, "_ingested_at": 2})
    store.ingest("third context", metadata={"user_id": user_id, "seq": 3, "_ingested_at": 3})

    ref_infos = _ref_metadata(store, user_id)
    assert len(ref_infos) == 2
    seqs = sorted(int((ref.metadata or {}).get("seq")) for ref in ref_infos)
    assert seqs == [2, 3]


def test_prunes_by_retention_window(monkeypatch, tmp_path):
    monkeypatch.setenv("RAG_PERSIST_DIR", str(tmp_path))
    monkeypatch.setenv("RAG_EMBED_MODEL", "mock")
    monkeypatch.setenv("RAG_EMBED_DIM", "8")
    monkeypatch.setenv("RAG_MAX_DOCS_PER_USER", "10")
    monkeypatch.setenv("RAG_RETENTION_DAYS", "1")
    monkeypatch.setenv("RAG_PRUNE_COOLDOWN_SEC", "0")

    store = VectorStore(connection_string="local://")
    user_id = "u1"
    now = time.time()

    store.ingest(
        "stale context",
        metadata={"user_id": user_id, "seq": 1, "_ingested_at": now - (3 * 86400)},
    )
    store.ingest("fresh context", metadata={"user_id": user_id, "seq": 2, "_ingested_at": now})

    ref_infos = _ref_metadata(store, user_id)
    assert len(ref_infos) == 1
    assert int((ref_infos[0].metadata or {}).get("seq")) == 2
