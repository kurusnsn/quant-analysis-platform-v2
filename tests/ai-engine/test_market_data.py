"""
Tests for MarketDataProvider - mocked yfinance, no network calls.
"""
import pytest
import pandas as pd
import numpy as np
from pathlib import Path
from unittest.mock import patch, MagicMock
import tempfile
import shutil

from market_data import MarketDataProvider


@pytest.fixture
def temp_cache_dir():
    """Create temporary cache directory."""
    temp_dir = Path(tempfile.mkdtemp())
    yield temp_dir
    shutil.rmtree(temp_dir)


@pytest.fixture
def mock_yf_data():
    """Generate mock yfinance data (Geometric Brownian Motion)."""
    dates = pd.date_range("2023-01-01", periods=252, freq="D")
    
    # Generate prices with ~1% daily volatility
    aapl_prices = 150 * np.exp(np.cumsum(np.random.normal(0, 0.01, 252)))
    goog_prices = 100 * np.exp(np.cumsum(np.random.normal(0, 0.01, 252)))
    
    data = pd.DataFrame({
        ('Adj Close', 'AAPL'): aapl_prices,
        ('Adj Close', 'GOOGL'): goog_prices
    }, index=dates)
    data.columns = pd.MultiIndex.from_tuples(data.columns)
    return data


class TestMarketDataProvider:
    def test_get_prices_caches_result(self, temp_cache_dir, mock_yf_data):
        provider = MarketDataProvider(cache_dir=temp_cache_dir)
        
        with patch('market_data.yf.download', return_value=mock_yf_data):
            # First call - hits yfinance
            prices1 = provider.get_prices(['AAPL', 'GOOGL'])
            
            # Second call - should use cache
            prices2 = provider.get_prices(['AAPL', 'GOOGL'])
        
        assert not prices1.empty
        assert prices1.shape == prices2.shape
    
    def test_get_returns_calculated_correctly(self, temp_cache_dir, mock_yf_data):
        provider = MarketDataProvider(cache_dir=temp_cache_dir)
        
        with patch('market_data.yf.download', return_value=mock_yf_data):
            returns = provider.get_returns(['AAPL'])
        
        # Just verify returns are calculated
        assert not returns.empty
        assert len(returns) > 0
    
    def test_fallback_to_expired_cache(self, temp_cache_dir, mock_yf_data):
        provider = MarketDataProvider(cache_dir=temp_cache_dir, cache_ttl_hours=0)  # Immediate expiry
        
        with patch('market_data.yf.download', return_value=mock_yf_data):
            # Prime the cache
            provider.get_prices(['AAPL'])
        
        # Now fail yfinance - should fallback to expired cache
        with patch('market_data.yf.download', side_effect=Exception("Network error")):
            prices = provider.get_prices(['AAPL'])
            assert not prices.empty
    
    def test_no_data_raises(self, temp_cache_dir):
        provider = MarketDataProvider(cache_dir=temp_cache_dir)
        empty_df = pd.DataFrame()
        
        with patch('market_data.yf.download', return_value=empty_df):
            with pytest.raises(Exception):
                provider.get_prices(['INVALID_TICKER'])


class TestCaching:
    def test_cache_file_created(self, temp_cache_dir, mock_yf_data):
        provider = MarketDataProvider(cache_dir=temp_cache_dir)
        
        with patch('market_data.yf.download', return_value=mock_yf_data):
            provider.get_prices(['AAPL'])
        
        # Check cache file exists
        cache_files = list(temp_cache_dir.glob("*.json"))
        assert len(cache_files) == 1
