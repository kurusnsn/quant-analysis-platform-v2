import pytest
from pydantic import ValidationError
from src.schemas import AIResponse, InsightLevel

# --- Contracts Tests ---

def test_response_schema_validation():
    """Ensure the response matches the agreed JSON contract."""
    data = {
        "level": "brief",
        "summary": "Market is bullish.",
        "insights": [{"label": "Trend", "value": "Up"}],
        "reasoning": None,
        "calculations": [],
        "citations": [],
        "metadata": {"model": "llama-3.1", "latency_ms": 120, "cached": False}
    }
    response = AIResponse(**data)
    assert response.level == InsightLevel.BRIEF
    assert response.summary == "Market is bullish."

def test_deep_requires_reasoning():
    """Deep insights must include reasoning."""
    data = {
        "level": "deep",
        "summary": "Complex analysis.",
        "insights": [],
        "reasoning": None, # Should fail
        "calculations": [],
        "citations": [],
        "metadata": {"model": "deepseek-r1", "latency_ms": 500, "cached": False}
    }
    with pytest.raises(ValidationError):
        AIResponse(**data)

# --- Router Tests ---

from src.router import route_query

def test_router_heuristic_brief():
    """Simple keywords should route to Brief/Llama."""
    level, model = route_query("Give me a market summary")
    assert level == InsightLevel.BRIEF
    assert "llama" in model

def test_router_heuristic_deep():
    """Complex keywords should route to Deep/DeepSeek."""
    level, model = route_query("Why is AAPL down compared to MSFT?")
    assert level == InsightLevel.DEEP
    assert "deepseek" in model
