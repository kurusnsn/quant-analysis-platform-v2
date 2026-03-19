import logging
from src.main import generate_insights
from src.schemas import InsightLevel
import pytest

# --- Observability Tests ---

@pytest.mark.asyncio
async def test_structured_logging(caplog):
    """
    Ensure that generating an insight produces a structured log entry
    with critical metrics (latency, model, level).
    """
    caplog.set_level(logging.INFO)
    
    # Trigger the function directly (unit test style)
    await generate_insights(query="Why is the market down?", user_id="test_user_123")
    
    # Check if log was captured
    assert len(caplog.records) > 0
    last_log = caplog.records[-1].message
    
    # Assert structured fields exist
    assert "event=insight_generated" in last_log
    assert "user=test_user_123" in last_log
    assert "level=deep" in last_log  # "Why" triggers deep
    assert "latency=" in last_log
    assert "model=" in last_log
