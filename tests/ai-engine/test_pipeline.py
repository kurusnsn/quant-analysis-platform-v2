"""
Tests for the hybrid LLM + Quant pipeline.
"""
import pytest
from unittest.mock import patch, MagicMock
import pandas as pd
import numpy as np

from pipeline import (
    StrategyIntent,
    extract_intent,
    generate_candidates,
    validate_tickers,
    filter_tickers,
    calculate_risk_score,
    run_quant_analysis,
    compose_results
)


class TestExtractIntent:
    """Test intent extraction from prompts."""
    
    def test_extracts_intent_from_structured_prompt(self):
        """Should parse structured prompt into intent."""
        # Mock Groq response
        mock_response = '{"sector": "Technology", "risk_level": "high", "region": "US", "theme": "AI", "market_cap": "large", "time_horizon": "short"}'
        
        with patch('pipeline._call_groq', return_value=mock_response):
            intent = extract_intent("High risk AI tech stocks")
            
            assert intent.sector == "Technology"
            assert intent.risk_level == "high"
            assert intent.theme == "AI"
    
    def test_returns_default_on_groq_failure(self):
        """Should return default intent if LLM fails."""
        with patch('pipeline._call_groq', return_value=None):
            intent = extract_intent("Some random prompt")
            
            assert intent.risk_level == "medium"
            assert intent.region == "US"


class TestGenerateCandidates:
    """Test candidate ticker generation."""
    
    def test_generates_candidates_from_intent(self):
        """Should generate list of ticker candidates."""
        mock_response = '{"candidates": ["NVDA", "AMD", "INTC", "AVGO", "QCOM"]}'
        
        with patch('pipeline._call_groq', return_value=mock_response):
            intent = StrategyIntent(sector="Semiconductors", risk_level="high")
            candidates = generate_candidates(intent)
            
            assert len(candidates) >= 5
            assert "NVDA" in candidates
    
    def test_returns_fallback_on_groq_failure(self):
        """Should return fallback tickers if LLM fails."""
        with patch('pipeline._call_groq', return_value=None):
            intent = StrategyIntent()
            candidates = generate_candidates(intent)
            
            assert len(candidates) > 0
            assert "AAPL" in candidates  # Fallback includes AAPL


class TestValidateTickers:
    """Test ticker validation with yfinance."""
    
    def test_validates_real_tickers(self):
        """Should validate and return info for real tickers."""
        mock_info = {
            "regularMarketPrice": 150.0,
            "shortName": "Apple Inc.",
            "marketCap": 2500000000000,
            "averageVolume": 50000000,
            "sector": "Technology"
        }
        
        with patch('yfinance.Ticker') as mock_yf:
            mock_yf.return_value.info = mock_info
            
            valid = validate_tickers(["AAPL"])
            
            assert len(valid) == 1
            assert valid[0]["symbol"] == "AAPL"
            assert valid[0]["price"] == 150.0
    
    def test_skips_invalid_tickers(self):
        """Should skip tickers that don't exist."""
        with patch('yfinance.Ticker') as mock_yf:
            mock_yf.return_value.info = {}  # No price = invalid
            
            valid = validate_tickers(["INVALIDTICKER"])
            
            assert len(valid) == 0


class TestFilterTickers:
    """Test ticker filtering logic."""
    
    def test_filters_by_market_cap(self):
        """Should filter out low market cap tickers."""
        tickers = [
            {"symbol": "BIG", "market_cap": 5e9, "volume": 1000000},
            {"symbol": "SMALL", "market_cap": 500e6, "volume": 1000000},
        ]
        
        filtered = filter_tickers(tickers, min_market_cap=1e9)
        
        assert len(filtered) == 1
        assert filtered[0]["symbol"] == "BIG"
    
    def test_filters_by_volume(self):
        """Should filter out low volume tickers."""
        tickers = [
            {"symbol": "LIQUID", "market_cap": 5e9, "volume": 1000000},
            {"symbol": "ILLIQUID", "market_cap": 5e9, "volume": 50000},
        ]
        
        filtered = filter_tickers(tickers, min_volume=100000)
        
        assert len(filtered) == 1
        assert filtered[0]["symbol"] == "LIQUID"
    
    def test_limits_max_tickers(self):
        """Should limit to max_tickers count."""
        tickers = [
            {"symbol": f"T{i}", "market_cap": (10-i)*1e9, "volume": 1000000}
            for i in range(10)
        ]
        
        filtered = filter_tickers(tickers, max_tickers=5)
        
        assert len(filtered) == 5


class TestCalculateRiskScore:
    """Test composite risk score calculation."""
    
    def test_high_volatility_high_score(self):
        """High volatility should produce high risk score."""
        score = calculate_risk_score(volatility=0.5, var_95=-0.05, sharpe=0.5)
        assert score > 50
    
    def test_low_volatility_low_score(self):
        """Low volatility should produce low risk score."""
        score = calculate_risk_score(volatility=0.1, var_95=-0.01, sharpe=1.5)
        assert score < 30
    
    def test_negative_sharpe_adds_risk(self):
        """Negative Sharpe ratio should increase risk score."""
        score_positive = calculate_risk_score(0.3, -0.03, sharpe=0.5)
        score_negative = calculate_risk_score(0.3, -0.03, sharpe=-0.5)
        
        assert score_negative > score_positive
    
    def test_score_bounded_0_100(self):
        """Risk score should always be between 0 and 100."""
        # Extreme values
        score_high = calculate_risk_score(1.0, -0.2, sharpe=-2.0)
        score_low = calculate_risk_score(0.01, -0.001, sharpe=3.0)
        
        assert 0 <= score_high <= 100
        assert 0 <= score_low <= 100


class TestComposeResults:
    """Test result composition from quant data."""
    
    def test_composes_results_with_quant_data(self):
        """Should combine ticker info with quant metrics."""
        tickers = [
            {"symbol": "AAPL", "name": "Apple", "sector": "Tech", "price": 150}
        ]
        quant_data = {
            "volatility": {"AAPL": 0.25},
            "sharpe": {"AAPL": 1.2},
            "var_95": {"AAPL": -0.02},
            "cvar_95": {"AAPL": -0.03}
        }
        
        results = compose_results(tickers, quant_data)
        
        assert len(results) == 1
        assert results[0]["symbol"] == "AAPL"
        assert results[0]["volatility_30d"] == 0.25
        assert results[0]["riskScore"] > 0
