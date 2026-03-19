from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import numpy as np
import pandas as pd
from transformers import AutoTokenizer, AutoModelForSequenceClassification
import torch
import os
import asyncio
import time
import contextlib

from market_data import MarketDataProvider
from quant_models import (
    calculate_rolling_volatility,
    calculate_sharpe_ratio,
    calculate_var,
    calculate_cvar,
    monte_carlo_simulation,
    detect_regime
)

from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.requests import RequestsInstrumentor
from observability import (
    request_duration_ms,
    request_count,
    error_count,
    inc_active_requests,
    dec_active_requests,
    set_event_loop_lag_ms,
)

app = FastAPI(title="quant-platform AI Engine")

# Instrument FastAPI
FastAPIInstrumentor.instrument_app(app)
RequestsInstrumentor().instrument()

# Initialize providers
market_data = MarketDataProvider()

# In-memory cache for per-ticker commentary, keyed by "{SYMBOL}:{YYYY-MM-DD}"
_ticker_commentary_cache: dict = {}

@app.middleware("http")
async def record_request_metrics(request, call_next):
    start = time.perf_counter()
    inc_active_requests()
    status_code = 500
    try:
        response = await call_next(request)
        status_code = response.status_code
        return response
    except Exception:
        raise
    finally:
        duration_ms = (time.perf_counter() - start) * 1000.0
        route = request.scope.get("route")
        route_path = route.path if route is not None and hasattr(route, "path") else "unmatched"

        tags = {
            "http.method": request.method,
            "http.route": route_path,
            "http.status_code": status_code
        }

        request_duration_ms.record(duration_ms, tags)
        request_count.add(1, tags)
        if status_code >= 500:
            error_count.add(1, tags)
        dec_active_requests()


@app.on_event("startup")
async def start_event_loop_monitor():
    async def monitor():
        interval = 0.5
        loop = asyncio.get_running_loop()
        expected = loop.time() + interval
        while True:
            await asyncio.sleep(interval)
            now = loop.time()
            lag_ms = max(0.0, (now - expected) * 1000.0)
            set_event_loop_lag_ms(lag_ms)
            expected = now + interval

    app.state.loop_monitor_task = asyncio.create_task(monitor())


@app.on_event("shutdown")
async def stop_event_loop_monitor():
    task = getattr(app.state, "loop_monitor_task", None)
    if task is None:
        return
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task

MAX_PROMPT_LEN = 500
MAX_NEWS_HEADLINE_LEN = 200
MAX_TICKERS_PER_REQUEST = 50

def _sanitize_text(value: str, max_len: int) -> str:
    if not value:
        return ""
    cleaned = value.replace("\n", " ").replace("\r", " ").replace("\t", " ")
    cleaned = "".join(ch for ch in cleaned if ch.isprintable())
    cleaned = cleaned.strip()
    return cleaned[:max_len]

def _sanitize_ticker(value: str) -> str:
    if not value:
        return ""
    cleaned = value.strip().upper()
    cleaned = "".join(ch for ch in cleaned if ch.isalnum() or ch in ".^-")
    return cleaned[:10]

# Load FinBERT at startup (News Sentiment)
print("Loading FinBERT model...")
tokenizer = AutoTokenizer.from_pretrained("ProsusAI/finbert")
model = AutoModelForSequenceClassification.from_pretrained("ProsusAI/finbert")
model.eval()
print("FinBERT loaded successfully!")



# Request/Response models
class WatchlistRequest(BaseModel):
    tickers: List[str]

class AssetRequest(BaseModel):
    ticker: str
    period: str = "1y"

class SentimentRequest(BaseModel):
    texts: List[str]

class SimulationRequest(BaseModel):
    tickers: List[str]
    days: int = 30
    n_simulations: int = 5000


# Health endpoints
@app.get("/health")
def health_check():
    return {"status": "healthy", "service": "ai-engine", "model_loaded": True}

@app.get("/health/ai")
def ai_health():
    test_input = tokenizer("Test", return_tensors="pt", padding=True, truncation=True)
    with torch.no_grad():
        _ = model(**test_input)
    return {"status": "healthy", "model": "ProsusAI/finbert", "inference": "ok"}


# Analysis endpoints
@app.post("/analyze/watchlist")
def analyze_watchlist(request: WatchlistRequest):
    """Full watchlist analysis with real quant models."""
    if not request.tickers:
        raise HTTPException(status_code=400, detail="No tickers provided")
    
    try:
        # Get market data
        returns = market_data.get_returns(request.tickers)
        
        # Calculate metrics
        vol = calculate_rolling_volatility(returns).iloc[-1].mean()
        var = calculate_var(returns).mean()
        cvar = calculate_cvar(returns).mean()
        
        # Monte Carlo
        mc = monte_carlo_simulation(returns)
        
        # Regime
        regime_info = detect_regime(returns)
        
        return {
            "volatility": round(float(vol), 4) if not np.isnan(vol) else 0.0,
            "var_95": round(float(var), 4) if not np.isnan(var) else 0.0,
            "cvar_95": round(float(cvar), 4) if not np.isnan(cvar) else 0.0,
            "loss_probability_30d": mc["loss_probability_30d"],
            "expected_return": mc["expected_return"],
            "regime": regime_info["current_regime"],
            "regime_persistence": regime_info.get("persistence_probability", 0),
            "tickers": request.tickers
        }
    except Exception as e:
        # Graceful fallback
        return {
            "volatility": 0.0,
            "var_95": 0.0,
            "cvar_95": 0.0,
            "loss_probability_30d": 0.0,
            "expected_return": 0.0,
            "regime": "unknown",
            "error": str(e),
            "tickers": request.tickers
        }


@app.post("/analyze/asset")
def analyze_asset(request: AssetRequest):
    """Single asset analysis."""
    try:
        returns = market_data.get_returns([request.ticker], request.period)
        
        vol = calculate_rolling_volatility(returns).iloc[-1].values[0]
        sharpe = calculate_sharpe_ratio(returns).values[0]
        var = calculate_var(returns).values[0]
        cvar = calculate_cvar(returns).values[0]
        regime_info = detect_regime(returns)
        
        return {
            "ticker": request.ticker,
            "volatility": round(float(vol), 4) if not np.isnan(vol) else 0.0,
            "sharpe_ratio": round(float(sharpe), 4) if not np.isnan(sharpe) else 0.0,
            "var_95": round(float(var), 4) if not np.isnan(var) else 0.0,
            "cvar_95": round(float(cvar), 4) if not np.isnan(cvar) else 0.0,
            "regime": regime_info["current_regime"]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/sentiment")
def analyze_sentiment(request: SentimentRequest):
    """Analyze sentiment using FinBERT."""
    results = []
    
    for text in request.texts:
        inputs = tokenizer(text, return_tensors="pt", padding=True, truncation=True, max_length=512)
        with torch.no_grad():
            outputs = model(**inputs)
        
        probs = torch.nn.functional.softmax(outputs.logits, dim=-1)
        labels = ["positive", "negative", "neutral"]
        scores = probs[0].tolist()
        
        results.append({
            "text": text[:50] + "..." if len(text) > 50 else text,
            "positive": round(scores[0], 4),
            "negative": round(scores[1], 4),
            "neutral": round(scores[2], 4),
            "label": labels[scores.index(max(scores))],
            "score": round(max(scores) * (1 if labels[scores.index(max(scores))] == "positive" else -1 if labels[scores.index(max(scores))] == "negative" else 0), 4)
        })
    
    return {"sentiments": results}


@app.post("/simulate")
def run_simulation(request: SimulationRequest):
    """Run Monte Carlo simulation."""
    try:
        returns = market_data.get_returns(request.tickers)
        result = monte_carlo_simulation(returns, days=request.days, n_simulations=request.n_simulations)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/financials/{ticker}")
def get_financials(ticker: str):
    """Get financial statements for a single ticker."""
    try:
        data = market_data.get_financials(ticker)

        statements = data.get("statements", {}) if isinstance(data, dict) else {}
        has_rows = False
        for section in statements.values():
            for period in section.values():
                if isinstance(period, dict) and period.get("rows"):
                    has_rows = True
                    break
            if has_rows:
                break

        if not has_rows:
            raise HTTPException(status_code=404, detail="No financials available")

        return data
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/holders/{ticker}")
def get_holders(ticker: str):
    """Get holders data for a single ticker."""
    try:
        data = market_data.get_holders(ticker)

        holders = data.get("holders", {}) if isinstance(data, dict) else {}
        has_rows = False
        for section in holders.values():
            if isinstance(section, dict) and section.get("rows"):
                has_rows = True
                break

        if not has_rows:
            raise HTTPException(status_code=404, detail="No holders data available")

        return data
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/profile/{ticker}")
def get_profile(ticker: str):
    """Get company profile (description, sector, industry, etc.)."""
    try:
        data = market_data.get_profile(ticker)
        if not data or not data.get("description"):
            raise HTTPException(status_code=404, detail="No profile data available")
        return data
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/earnings/{ticker}")
def get_earnings(ticker: str):
    """Get earnings calendar/dates for a single ticker."""
    try:
        data = market_data.get_earnings(ticker)

        calendar = data.get("calendar", {}) if isinstance(data, dict) else {}
        earnings_dates = data.get("earnings_dates", {}) if isinstance(data, dict) else {}

        has_rows = False
        for section in (calendar, earnings_dates):
            if isinstance(section, dict) and section.get("rows"):
                has_rows = True
                break

        if not has_rows:
            raise HTTPException(status_code=404, detail="No earnings data available")

        return data
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# EDGAR SEC Filings
from edgar_data import edgar_provider

class FilingsRequest(BaseModel):
    tickers: List[str]
    filing_types: List[str] = ["10-K", "10-Q", "8-K"]

@app.post("/filings")
def get_filings(request: FilingsRequest):
    """Get recent SEC filings for tickers."""
    filings = edgar_provider.get_filings_for_watchlist(request.tickers, request.filing_types)
    return {"filings": filings, "count": len(filings)}

@app.post("/filings/analyze")
def analyze_filings_sentiment(request: FilingsRequest):
    """Get SEC filings and analyze their descriptions with FinBERT."""
    filings = edgar_provider.get_filings_for_watchlist(request.tickers, request.filing_types)
    
    # Analyze descriptions with FinBERT
    for filing in filings:
        desc = filing.get("description", "")
        if desc:
            inputs = tokenizer(desc, return_tensors="pt", padding=True, truncation=True, max_length=512)
            with torch.no_grad():
                outputs = model(**inputs)
            probs = torch.nn.functional.softmax(outputs.logits, dim=-1)
            labels = ["positive", "negative", "neutral"]
            scores = probs[0].tolist()
            filing["sentiment"] = {
                "label": labels[scores.index(max(scores))],
                "positive": round(scores[0], 4),
                "negative": round(scores[1], 4),
                "neutral": round(scores[2], 4)
            }
    
    return {"filings": filings, "count": len(filings)}


# News endpoints (yfinance)
# IMPORTANT: Specific routes must come BEFORE parameterized routes
@app.get("/news/market")
def get_market_news_endpoint(limit: int = 20):
    """
    Get general market news from major stocks.
    Uses yfinance - free, no rate limits, cached for 1 hour.
    """
    try:
        news = market_data.get_market_news(limit=limit)
        return {
            "news": news,
            "count": len(news),
            "source": "yfinance (diversified market universe)",
            "cached_hours": 1
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/news/{ticker}")
def get_stock_news(ticker: str, limit: int = 10):
    """
    Get news headlines for a specific stock ticker.
    Uses yfinance - free, no rate limits, cached for 24 hours.
    """
    try:
        news = market_data.get_news(ticker)
        return {
            "ticker": ticker.upper(),
            "news": news[:limit],
            "count": len(news),
            "source": "yfinance",
            "cached_hours": 24
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/sentiment/compare")
def compare_sentiment(request: WatchlistRequest):
    """
    News (FinBERT) sentiment for a ticker.
    """
    if not request.tickers:
        raise HTTPException(status_code=400, detail="No tickers provided")

    ticker = request.tickers[0]

    # Get news headlines from yfinance
    news = market_data.get_news(ticker)
    news_texts = [n.get("title", "") for n in news if n.get("title")]

    # Analyze news with FinBERT
    news_sentiment = {"positive": 0, "negative": 0, "neutral": 0}
    for text in news_texts[:10]:
        inputs = tokenizer(text, return_tensors="pt", padding=True, truncation=True, max_length=512)
        with torch.no_grad():
            outputs = model(**inputs)
        probs = torch.nn.functional.softmax(outputs.logits, dim=-1)
        scores = probs[0].tolist()
        news_sentiment["positive"] += scores[0]
        news_sentiment["negative"] += scores[1]
        news_sentiment["neutral"] += scores[2]

    n = len(news_texts[:10]) or 1
    news_sentiment = {k: round(v/n, 4) for k, v in news_sentiment.items()}

    return {
        "ticker": ticker,
        "news_sentiment": {
            "model": "finbert",
            **news_sentiment,
            "label": max(news_sentiment, key=news_sentiment.get)
        },
    }


# Narrative Generation (LLM-powered)
from narrative import narrative_generator

@app.post("/narrative")
def generate_narrative(request: WatchlistRequest):
    """
    Generate LLM-powered narrative explanation of risk analysis.
    Requires ENABLE_LLM=true and GROQ_API_KEY.
    """
    if not request.tickers:
        raise HTTPException(status_code=400, detail="No tickers provided")

    try:
        safe_tickers = [
            _sanitize_ticker(t)
            for t in request.tickers
            if _sanitize_ticker(t)
        ][:MAX_TICKERS_PER_REQUEST]

        if not safe_tickers:
            raise HTTPException(status_code=400, detail="No valid tickers provided")

        # First get the risk analysis
        returns = market_data.get_returns(safe_tickers)
        vol = calculate_rolling_volatility(returns).iloc[-1].mean()
        var = calculate_var(returns).mean()
        cvar = calculate_cvar(returns).mean()
        mc = monte_carlo_simulation(returns)
        regime_info = detect_regime(returns)
        
        risk_data = {
            "volatility": float(vol) if not np.isnan(vol) else 0.0,
            "var_95": float(var) if not np.isnan(var) else 0.0,
            "cvar_95": float(cvar) if not np.isnan(cvar) else 0.0,
            "loss_probability_30d": mc["loss_probability_30d"],
            "expected_return": mc["expected_return"],
            "regime": regime_info["current_regime"],
            "tickers": safe_tickers
        }
        
        # Generate narrative
        narrative = narrative_generator.explain(risk_data)
        
        return {
            "narrative": narrative,
            "risk_data": risk_data,
            "llm_enabled": narrative_generator.llm_enabled
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Per-Stock Narrative (for EOD analysis)
class StockNarrativeRequest(BaseModel):
    ticker: str
    analysis: Dict[str, Any]  # Contains volatility, sharpe, var, cvar
    news_headlines: List[str] = []

@app.post("/narrative/stock")
def generate_stock_narrative(request: StockNarrativeRequest):
    """
    Generate AI-powered narrative for a single stock.
    Used by EOD job for per-stock analysis.
    """
    try:
        if narrative_generator.llm_enabled:
            ticker = _sanitize_ticker(request.ticker)
            if not ticker:
                raise HTTPException(status_code=400, detail="Invalid ticker")
            analysis = request.analysis
            news = [
                _sanitize_text(h, MAX_NEWS_HEADLINE_LEN)
                for h in request.news_headlines[:3]
                if h
            ]  # Top 3 headlines

            prompt = f"""As a senior equity analyst, provide a concise 2-3 sentence analysis for {ticker}:

Risk Metrics:
- Volatility: {analysis.get('volatility', 0):.2%}
- Sharpe Ratio: {analysis.get('sharpe', 0):.2f}
- VaR (95%): {analysis.get('var_95', 0):.2%}
- CVaR (95%): {analysis.get('cvar_95', 0):.2%}

Recent News:
{chr(10).join([f"- {h}" for h in news]) if news else "No recent news"}

Provide: 1) Risk assessment 2) News impact (if any) 3) Brief outlook"""

            try:
                import groq
                client = groq.Groq(api_key=os.getenv("GROQ_API_KEY"))
                completion = client.chat.completions.create(
                    model="llama-3.3-70b-versatile",
                    messages=[{"role": "user", "content": prompt}],
                    temperature=0.5,
                    max_tokens=256
                )
                narrative_text = completion.choices[0].message.content
            except Exception:
                # Fallback template
                vol = analysis.get('volatility', 0)
                sharpe = analysis.get('sharpe', 0)
                sentiment = "positive" if len(news) > 0 and any(word in " ".join(news).lower() for word in ["growth", "beat", "strong"]) else "neutral"

                narrative_text = f"{ticker} shows {'elevated' if vol > 0.3 else 'moderate' if vol > 0.2 else 'low'} volatility ({vol:.1%}) with a Sharpe ratio of {sharpe:.2f}. Recent news sentiment appears {sentiment}. {'Monitor closely given current volatility levels.' if vol > 0.3 else 'Standard risk profile for the sector.'}"
        else:
            # Template-based fallback
            vol = request.analysis.get('volatility', 0)
            sharpe = request.analysis.get('sharpe', 0)
            narrative_text = f"{_sanitize_ticker(request.ticker) or request.ticker.upper()}: Volatility {vol:.1%}, Sharpe {sharpe:.2f}. Standard risk profile."

        return {
            "ticker": _sanitize_ticker(request.ticker) or request.ticker.upper(),
            "narrative": narrative_text,
            "llm_enabled": narrative_generator.llm_enabled
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Market Synthesis (AI-powered market overview)
@app.post("/market/synthesis")
def generate_market_synthesis():
    """
    Generate AI-powered market synthesis/overview.
    Aggregates major indices, sector ETFs, VIX, news, and generates LLM narrative.
    """
    try:
        import math
        from datetime import datetime

        def _finite_or_none(value):
            try:
                value = float(value)
            except Exception:
                return None
            return value if math.isfinite(value) else None

        def _pct_change(df: "pd.DataFrame", col: str) -> "float | None":
            """Daily % change for a column in a price DataFrame."""
            try:
                series = df[col].dropna()
                if len(series) < 2:
                    return None
                prev, last = float(series.iloc[-2]), float(series.iloc[-1])
                if prev == 0.0:
                    return None
                return _finite_or_none(((last - prev) / prev) * 100)
            except Exception:
                return None

        # ── Fetch all indices + VIX in one batch (avoids per-ticker cache collisions) ──
        INDEX_TICKERS = ["^GSPC", "^DJI", "^IXIC", "^VIX"]
        idx_df = pd.DataFrame()
        try:
            idx_df = market_data.get_prices(INDEX_TICKERS, period="5d")
        except Exception:
            pass

        sp_change = _pct_change(idx_df, "^GSPC") if "^GSPC" in idx_df.columns else None
        dj_change = _pct_change(idx_df, "^DJI")  if "^DJI"  in idx_df.columns else None
        nq_change = _pct_change(idx_df, "^IXIC") if "^IXIC" in idx_df.columns else None

        vix_val: float | None = None
        try:
            if "^VIX" in idx_df.columns:
                vix_series = idx_df["^VIX"].dropna()
                if not vix_series.empty:
                    vix_val = _finite_or_none(float(vix_series.iloc[-1]))
        except Exception:
            pass

        # 5-day trend for S&P 500
        sp_5d: float | None = None
        try:
            if "^GSPC" in idx_df.columns:
                sp_series = idx_df["^GSPC"].dropna()
                if len(sp_series) >= 2:
                    first, last = float(sp_series.iloc[0]), float(sp_series.iloc[-1])
                    if first != 0:
                        sp_5d = _finite_or_none(((last - first) / first) * 100)
        except Exception:
            pass

        # ── Sector ETFs — also fetched as a single batch ───────────────────────
        SECTOR_ETFS = {
            "XLK": "Technology",
            "XLF": "Financials",
            "XLE": "Energy",
            "XLV": "Healthcare",
            "XLY": "Consumer Disc.",
            "XLP": "Consumer Staples",
            "XLI": "Industrials",
            "XLU": "Utilities",
        }
        sector_changes: dict = {}
        try:
            sec_df = market_data.get_prices(list(SECTOR_ETFS.keys()), period="5d")
            for etf in SECTOR_ETFS:
                if etf in sec_df.columns:
                    chg = _pct_change(sec_df, etf)
                    if chg is not None:
                        sector_changes[etf] = chg
        except Exception:
            pass

        # ── Rolling volatility (fallback if VIX unavailable) ──────────────────
        volatility: float = 0.0
        try:
            sp500_returns = market_data.get_returns(["^GSPC"], period="1mo")
            if not sp500_returns.empty:
                v = float(calculate_rolling_volatility(sp500_returns, window=20).iloc[-1].iloc[0])
                if math.isfinite(v):
                    volatility = v
        except Exception:
            pass

        # ── News headlines ─────────────────────────────────────────────────────
        news = market_data.get_market_news(limit=6)
        news_titles = [
            _sanitize_text(n.get("title", ""), MAX_NEWS_HEADLINE_LEN)
            for n in news[:6]
            if n.get("title")
        ]

        # ── Safe defaults for None values used in format strings ─────────────
        sp_change = sp_change or 0.0
        nq_change = nq_change or 0.0
        dj_change = dj_change or 0.0

        # ── Build sector performance lines ────────────────────────────────────
        sector_lines = []
        for etf, name in SECTOR_ETFS.items():
            chg = sector_changes.get(etf)
            if chg is not None:
                sector_lines.append(f"  {etf} ({name}): {chg:+.2f}%")
        sector_text = "\n".join(sector_lines) if sector_lines else "  (sector data unavailable)"

        sectors_sorted = sorted(sector_changes.items(), key=lambda x: x[1], reverse=True)
        top_sector = f"{sectors_sorted[0][0]} ({SECTOR_ETFS.get(sectors_sorted[0][0], '')}) {sectors_sorted[0][1]:+.2f}%" if sectors_sorted else "N/A"
        bot_sector = f"{sectors_sorted[-1][0]} ({SECTOR_ETFS.get(sectors_sorted[-1][0], '')}) {sectors_sorted[-1][1]:+.2f}%" if sectors_sorted else "N/A"
        sectors_up = sum(1 for v in sector_changes.values() if v > 0)

        # ── Generate LLM synthesis ────────────────────────────────────────────
        vix_display = f"{vix_val:.1f}" if vix_val is not None else f"{volatility * 100:.1f}% (computed)"
        sp5d_display = f"{sp_5d:+.2f}%" if sp_5d is not None else "N/A"

        if narrative_generator.llm_enabled:
            prompt = f"""You are a senior market analyst. Write today's market briefing in exactly 3 paragraphs. Use ONLY the numbers provided below — do not invent figures.

=== MARKET DATA ===
Indices (today's session):
  S&P 500: {sp_change:+.2f}% | 5-day trend: {sp5d_display}
  NASDAQ:  {nq_change:+.2f}%
  Dow:     {dj_change:+.2f}%

Sector ETFs:
{sector_text}
  Best sector: {top_sector}
  Worst sector: {bot_sector}
  Sectors advancing: {sectors_up}/{len(sector_changes)}

VIX / Volatility: {vix_display} (historical median ~18)

Top headlines:
{chr(10).join([f"  {i+1}. {t}" for i, t in enumerate(news_titles[:5])])}

=== WRITE EXACTLY 3 PARAGRAPHS ===

§1 — Indices & sectors (3-4 sentences): Open with the S&P 500 and its 5-day context. Name the best and worst sector ETFs with their exact percentages. Comment on NASDAQ vs Dow divergence if meaningful. State how many sectors advanced.

§2 — Volatility & macro regime (2-3 sentences): Interpret VIX {vix_display} vs historical median of 18. State the current regime (complacent/normal/elevated/stressed). Connect to one macro headline from above.

§3 — Forward look (2-3 sentences): Name one specific catalyst and one risk from today's headlines. State which sector rotation to watch tomorrow. End with one concrete positioning signal.

Rules: No bullet points. No disclaimers. Every sentence must reference at least one number from the data."""

            try:
                import groq
                client = groq.Groq(api_key=os.getenv("GROQ_API_KEY"))
                completion = client.chat.completions.create(
                    model="llama-3.3-70b-versatile",
                    messages=[{"role": "user", "content": prompt}],
                    temperature=0.6,
                    max_tokens=1500,
                )
                synthesis_text = completion.choices[0].message.content or ""
            except Exception:
                synthesis_text = ""

            if not synthesis_text.strip():
                # Data-driven fallback
                sp_dir = "gained" if (sp_change or 0) > 0 else "lost"
                synthesis_text = (
                    f"The S&P 500 {sp_dir} {abs(sp_change or 0):.2f}% today, with its 5-day trend at {sp5d_display}. "
                    f"NASDAQ moved {nq_change:+.2f}% while the Dow posted {dj_change:+.2f}%, "
                    f"with {sectors_up} of {len(sector_changes)} sectors advancing. "
                    f"Technology led at {top_sector}, while {bot_sector} lagged.\n\n"
                    f"VIX stands at {vix_display} against a historical median of ~18, "
                    f"indicating {'complacency — hedging is cheap but tail risk is elevated' if (vix_val or 99) < 15 else 'elevated stress — consider reducing risk exposure' if (vix_val or 0) > 25 else 'a normal volatility regime'}. "
                    f"{news_titles[0] + '.' if news_titles else ''}\n\n"
                    f"Watch {sectors_sorted[-1][0] if sectors_sorted else 'lagging sectors'} for potential mean-reversion tomorrow. "
                    f"The divergence between NASDAQ ({nq_change:+.2f}%) and Dow ({dj_change:+.2f}%) suggests "
                    f"{'growth-over-value rotation continues' if (nq_change or 0) > (dj_change or 0) else 'value is regaining ground'}, a trend to monitor into next session."
                )
        else:
            sp_dir = "gained" if (sp_change or 0) > 0 else "lost"
            synthesis_text = (
                f"The S&P 500 {sp_dir} {abs(sp_change or 0):.2f}% today (5-day: {sp5d_display}), "
                f"NASDAQ {nq_change:+.2f}%, Dow {dj_change:+.2f}%. "
                f"Best sector: {top_sector}. Worst: {bot_sector}. "
                f"VIX at {vix_display}. {news_titles[0] if news_titles else ''}"
            )

        return {
            "synthesis": synthesis_text,
            "timestamp": datetime.utcnow().isoformat(),
            "key_stats": {
                "sp500_change": _finite_or_none(sp_change),
                "nasdaq_change": _finite_or_none(nq_change),
                "dow_change": _finite_or_none(dj_change),
                "vix": _finite_or_none(vix_val if vix_val is not None else volatility * 100),
                "sp500_5d": _finite_or_none(sp_5d),
                "sectors_up": sectors_up,
                "sectors_total": len(sector_changes),
            },
            "source": "Groq LLM" if narrative_generator.llm_enabled else "Template",
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Per-ticker commentary for significant watchlist movers
@app.get("/market/ticker-commentary/{symbol}")
def get_ticker_commentary(symbol: str):
    """
    Generate a short analyst paragraph explaining a ticker's price action today.
    Cached in-memory per symbol per UTC date — shared across all users.
    """
    import math
    from datetime import datetime, timezone

    symbol = symbol.upper()[:10]
    if not symbol or not all(c.isalnum() or c in ".-" for c in symbol):
        raise HTTPException(status_code=400, detail="Invalid symbol")

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    cache_key = f"{symbol}:{today}"

    if cache_key in _ticker_commentary_cache:
        return {**_ticker_commentary_cache[cache_key], "cached": True}

    def _finite_or_none(value):
        try:
            value = float(value)
        except Exception:
            return None
        return value if math.isfinite(value) else None

    # Fetch ticker price data
    daily_change: float | None = None
    five_day_change: float | None = None
    try:
        prices = market_data.get_prices([symbol], period="5d")
        if not prices.empty and symbol in prices.columns:
            col = prices[symbol].dropna()
            if len(col) >= 2:
                daily_change = _finite_or_none(((float(col.iloc[-1]) - float(col.iloc[-2])) / float(col.iloc[-2])) * 100)
            if len(col) >= 2:
                five_day_change = _finite_or_none(((float(col.iloc[-1]) - float(col.iloc[0])) / float(col.iloc[0])) * 100)
    except Exception:
        pass

    if daily_change is None:
        raise HTTPException(status_code=404, detail=f"No price data for {symbol}")

    # Fetch S&P 500 for context
    sp_change: float | None = None
    try:
        sp5 = market_data.get_prices(["^GSPC"], period="5d")
        if not sp5.empty and len(sp5) >= 2:
            sp_change = _finite_or_none(((float(sp5.iloc[-1]["^GSPC"]) - float(sp5.iloc[-2]["^GSPC"])) / float(sp5.iloc[-2]["^GSPC"])) * 100)
    except Exception:
        pass

    # Fetch recent ticker news
    ticker_news: list[str] = []
    try:
        news_items = market_data.get_stock_news(symbol, limit=3)
        ticker_news = [
            _sanitize_text(n.get("title", ""), MAX_NEWS_HEADLINE_LEN)
            for n in news_items[:3]
            if n.get("title")
        ]
    except Exception:
        pass

    commentary = ""
    if narrative_generator.llm_enabled:
        sp_ctx = f"S&P 500 moved {sp_change:+.2f}% today" if sp_change is not None else "market context unavailable"
        news_text = "\n".join([f"  - {t}" for t in ticker_news]) if ticker_news else "  (no recent headlines)"
        prompt = f"""You are a senior equity analyst. Write a single paragraph (80-120 words) explaining {symbol}'s price action today.

Data:
  {symbol} daily change: {daily_change:+.2f}%
  {symbol} 5-day change: {five_day_change:+.2f}% {'(N/A)' if five_day_change is None else ''}
  {sp_ctx}

Recent headlines for {symbol}:
{news_text}

Write analytically: Is this move stock-specific or sector/macro-driven? Reference the most relevant headline if applicable. Note whether {symbol} is outperforming or underperforming the broader market today. Use specific numbers. No disclaimers, no bullet points, one paragraph only."""

        try:
            import groq
            client = groq.Groq(api_key=os.getenv("GROQ_API_KEY"))
            completion = client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=[{"role": "user", "content": prompt}],
                temperature=0.5,
                max_tokens=300,
            )
            commentary = (completion.choices[0].message.content or "").strip()
        except Exception:
            commentary = ""

    if not commentary:
        vs_market = ""
        if sp_change is not None:
            if daily_change > sp_change + 1:
                vs_market = f", outperforming the S&P 500 ({sp_change:+.2f}%) by {daily_change - sp_change:.1f}pp"
            elif daily_change < sp_change - 1:
                vs_market = f", underperforming the S&P 500 ({sp_change:+.2f}%) by {abs(daily_change - sp_change):.1f}pp"
            else:
                vs_market = f", broadly in line with the S&P 500 ({sp_change:+.2f}%)"
        news_note = f" {ticker_news[0]}." if ticker_news else ""
        commentary = (
            f"{symbol} moved {daily_change:+.2f}% today{vs_market}. "
            f"Over the past 5 sessions the stock is {five_day_change:+.2f}%."
            f"{news_note}"
        )

    result = {
        "symbol": symbol,
        "commentary": commentary,
        "daily_change": daily_change,
        "five_day_change": five_day_change,
        "date": today,
        "cached": False,
    }
    _ticker_commentary_cache[cache_key] = result
    return result


# Hybrid LLM + Quant Pipeline
from pipeline import generate_watchlist as pipeline_generate

class PromptRequest(BaseModel):
    prompt: str
    deepResearch: bool = False
    userId: Optional[str] = None

@app.post("/generate/watchlist")
async def generate_watchlist_endpoint(request: PromptRequest):
    """
    Generate a watchlist from natural language prompt.
    
    Hybrid pipeline:
    1. LLM extracts intent from prompt
    2. LLM generates candidate tickers
    3. yfinance validates tickers exist
    4. Filter by market cap/volume
    5. Quant models calculate real risk metrics
    6. LLM generates narrative summary
    """
    # Allow short prompts like "ai" or "ev" while still rejecting empty/1-char inputs.
    if not request.prompt or len(request.prompt.strip()) < 2:
        raise HTTPException(status_code=400, detail="Prompt too short")

    if len(request.prompt) > MAX_PROMPT_LEN:
        raise HTTPException(status_code=400, detail="Prompt too long")
    
    try:
        safe_prompt = _sanitize_text(request.prompt, MAX_PROMPT_LEN)
        result = await pipeline_generate(
            safe_prompt,
            deep_research=bool(request.deepResearch),
            user_id=request.userId
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Guardian Forecasts - Real-time market predictions
@app.get("/forecasts")
def get_forecasts():
    """
    Generate real-time market forecasts using yfinance data.
    Returns mean reversion and volatility signals for SPX and VIX.
    """
    import math
    from datetime import datetime
    
    forecasts = []
    
    try:
        # SPX Mean Reversion Analysis
        spx_prices = market_data.get_prices(["^GSPC"], period="3mo")
        if not spx_prices.empty and len(spx_prices) >= 20:
            prices = spx_prices["^GSPC"].dropna()
            current_price = float(prices.iloc[-1])
            
            # Calculate 20-day SMA and Bollinger Bands
            sma_20 = prices.rolling(window=20).mean().iloc[-1]
            std_20 = prices.rolling(window=20).std().iloc[-1]
            upper_band = sma_20 + (2 * std_20)
            lower_band = sma_20 - (2 * std_20)
            
            # Calculate RSI (14-day)
            delta = prices.diff()
            gain = delta.where(delta > 0, 0).rolling(window=14).mean().iloc[-1]
            loss = (-delta.where(delta < 0, 0)).rolling(window=14).mean().iloc[-1]
            rs = gain / loss if loss != 0 else 0
            rsi = 100 - (100 / (1 + rs))
            
            # Mean reversion signal: how far from SMA
            deviation = (current_price - sma_20) / sma_20 * 100
            
            # Confidence based on RSI extremes and BB position
            if rsi > 70:  # Overbought
                target_price = round(sma_20 * 0.99, 0)  # Target 1% below SMA
                confidence = min(85, 50 + (rsi - 70))
                horizon = "5-7 days"
            elif rsi < 30:  # Oversold
                target_price = round(sma_20 * 1.01, 0)  # Target 1% above SMA
                confidence = min(85, 50 + (30 - rsi))
                horizon = "5-7 days"
            else:  # Normal range
                target_price = round(sma_20, 0)
                confidence = max(40, 60 - abs(deviation) * 5)
                horizon = "1-2 weeks"
            
            forecasts.append({
                "label": "Mean Reversion (SPX)",
                "target": f"{target_price:,.0f}",
                "confidence": int(confidence),
                "horizon": horizon,
                "current": round(current_price, 2),
                "rsi": round(rsi, 1),
                "deviation_pct": round(deviation, 2)
            })
    except Exception:
        forecasts.append({
            "label": "Mean Reversion (SPX)",
            "target": "N/A",
            "confidence": 0,
            "horizon": "Unavailable",
            "error": True
        })
    
    try:
        # VIX Volatility Forecast
        vix_prices = market_data.get_prices(["^VIX"], period="1mo")
        if not vix_prices.empty and len(vix_prices) >= 5:
            vix = vix_prices["^VIX"].dropna()
            current_vix = float(vix.iloc[-1])
            avg_vix_5d = vix.tail(5).mean()
            avg_vix_20d = vix.tail(20).mean() if len(vix) >= 20 else vix.mean()
            
            # VIX typically mean reverts to ~15-20
            historical_mean = 18.0
            
            if current_vix > 25:
                # High VIX - likely to decrease
                target_vix = round(max(historical_mean, avg_vix_20d * 0.85), 2)
                confidence = min(75, 50 + (current_vix - 25))
                horizon = "Next session"
                label = "Vol Contraction (VIX)"
            elif current_vix < 14:
                # Low VIX - complacency, may increase
                target_vix = round(min(25, avg_vix_20d * 1.1), 2)
                confidence = min(70, 50 + (14 - current_vix) * 3)
                horizon = "2-5 days"
                label = "Vol Expansion (VIX)"
            else:
                # Normal range
                target_vix = round(historical_mean, 2)
                confidence = 45
                horizon = "Next session"
                label = "Vol Neutral (VIX)"
            
            forecasts.append({
                "label": label,
                "target": f"{target_vix:.2f}",
                "confidence": int(confidence),
                "horizon": horizon,
                "current": round(current_vix, 2),
                "avg_5d": round(avg_vix_5d, 2)
            })
    except Exception:
        forecasts.append({
            "label": "Vol Breakout (VIX)",
            "target": "N/A",
            "confidence": 0,
            "horizon": "Unavailable",
            "error": True
        })
    
    return {
        "forecasts": forecasts,
        "timestamp": datetime.utcnow().isoformat(),
        "source": "yfinance"
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5000)
