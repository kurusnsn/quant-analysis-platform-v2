"""
Tests for quant models - deterministic, no network calls.
"""
import pytest
import numpy as np
import pandas as pd
from quant_models import (
    calculate_rolling_volatility,
    calculate_sharpe_ratio,
    calculate_var,
    calculate_cvar,
    monte_carlo_simulation,
    detect_regime
)


@pytest.fixture
def sample_returns():
    """Generate deterministic sample returns."""
    np.random.seed(42)
    dates = pd.date_range("2023-01-01", periods=252, freq="D")
    returns = pd.DataFrame({
        "AAPL": np.random.normal(0.0005, 0.02, 252),
        "GOOGL": np.random.normal(0.0003, 0.025, 252)
    }, index=dates)
    return returns


class TestVolatility:
    def test_volatility_is_positive(self, sample_returns):
        vol = calculate_rolling_volatility(sample_returns)
        assert (vol.dropna() >= 0).all().all()
    
    def test_volatility_annualized(self, sample_returns):
        vol = calculate_rolling_volatility(sample_returns)
        # Annualized vol should typically be 10-50% for stocks
        last_vol = vol.iloc[-1].mean()
        assert 0.05 < last_vol < 1.0


class TestSharpe:
    def test_sharpe_is_finite(self, sample_returns):
        sharpe = calculate_sharpe_ratio(sample_returns)
        assert np.isfinite(sharpe).all()
    
    def test_sharpe_deterministic(self, sample_returns):
        sharpe1 = calculate_sharpe_ratio(sample_returns)
        sharpe2 = calculate_sharpe_ratio(sample_returns)
        assert (sharpe1 == sharpe2).all()


class TestVaR:
    def test_var_is_negative(self, sample_returns):
        var = calculate_var(sample_returns)
        assert (var < 0).all()
    
    def test_var_95_percentile(self, sample_returns):
        var = calculate_var(sample_returns, confidence=0.95)
        # VaR should be around -2% to -5% for daily returns
        assert (var > -0.10).all()
        assert (var < 0).all()


class TestCVaR:
    def test_cvar_less_than_var(self, sample_returns):
        var = calculate_var(sample_returns)
        cvar = calculate_cvar(sample_returns)
        # CVaR (expected shortfall) should be <= VaR
        assert (cvar <= var).all()
    
    def test_cvar_is_negative(self, sample_returns):
        cvar = calculate_cvar(sample_returns)
        assert (cvar < 0).all()


class TestMonteCarlo:
    def test_loss_probability_in_range(self, sample_returns):
        result = monte_carlo_simulation(sample_returns)
        assert 0 <= result["loss_probability_30d"] <= 1
    
    def test_deterministic_with_seed(self, sample_returns):
        result1 = monte_carlo_simulation(sample_returns, seed=42)
        result2 = monte_carlo_simulation(sample_returns, seed=42)
        assert result1["loss_probability_30d"] == result2["loss_probability_30d"]
    
    def test_percentiles_ordered(self, sample_returns):
        result = monte_carlo_simulation(sample_returns)
        p = result["percentiles"]
        assert p["p5"] <= p["p25"] <= p["p50"] <= p["p75"] <= p["p95"]


class TestRegime:
    def test_regime_is_valid(self, sample_returns):
        result = detect_regime(sample_returns)
        assert result["current_regime"] in ["low_vol", "mid_vol", "high_vol", "unknown"]
    
    def test_persistence_in_range(self, sample_returns):
        result = detect_regime(sample_returns)
        assert 0 <= result["persistence_probability"] <= 1
    
    def test_deterministic_with_seed(self, sample_returns):
        result1 = detect_regime(sample_returns, seed=42)
        result2 = detect_regime(sample_returns, seed=42)
        assert result1["current_regime"] == result2["current_regime"]
