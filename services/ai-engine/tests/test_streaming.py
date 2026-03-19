import json
from unittest.mock import MagicMock

from fastapi.testclient import TestClient


def test_streaming_insights_yields_json_chunks(monkeypatch):
    from src import main as main_module

    mock_store = MagicMock()
    mock_store.retrieve = MagicMock(return_value=[
        ("Context chunk", {"source": "UnitTest", "title": "Doc", "url": "http://example.com"})
    ])
    monkeypatch.setattr(main_module, "get_rag_store", lambda: mock_store)

    mock_groq = MagicMock()
    mock_choice = MagicMock()
    mock_choice.message.content = "Mock summary"
    mock_response = MagicMock()
    mock_response.choices = [mock_choice]
    mock_groq.chat.completions.create.return_value = mock_response
    monkeypatch.setattr(main_module, "get_groq_client", lambda: mock_groq)

    client = TestClient(main_module.app)

    with client.stream(
        "GET",
        "/stream/insights",
        params={"query": "Why did VIX spike?", "user_id": "u1"},
    ) as response:
        assert response.status_code == 200

        chunks = []
        for line in response.iter_lines():
            if not line:
                continue
            if isinstance(line, bytes):
                line = line.decode("utf-8")
            if line.startswith("data: "):
                payload = json.loads(line[len("data: "):])
                chunks.append(payload)

    assert chunks, "Expected at least one streamed chunk"
    assert all("event" in chunk and "data" in chunk for chunk in chunks)
    assert any(chunk["event"] == "meta" for chunk in chunks)
    assert any(chunk["event"] == "summary" for chunk in chunks)
