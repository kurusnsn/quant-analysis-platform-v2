"""
Pipeline: Hybrid LLM + Quant orchestration for watchlist generation.
Combines Groq/Llama-3 for intent extraction and candidate generation
with deterministic quant models for real risk analysis.
"""
import os
import json
from typing import Dict, List, Optional, Any
from dataclasses import dataclass
import numpy as np
import yfinance as yf
from groq import Groq

from market_data import MarketDataProvider
from quant_models import (
    calculate_rolling_volatility,
    calculate_sharpe_ratio,
    calculate_var,
    calculate_cvar,
    monte_carlo_simulation,
    detect_regime
)
from edgar_data import edgar_provider

# FinBERT sentiment – imported lazily to avoid circular imports with main.py
_finbert_tokenizer = None
_finbert_model = None


def _get_finbert():
    global _finbert_tokenizer, _finbert_model
    if _finbert_tokenizer is not None:
        return _finbert_tokenizer, _finbert_model
    try:
        from transformers import AutoTokenizer, AutoModelForSequenceClassification
        import torch  # noqa: F811
        _finbert_tokenizer = AutoTokenizer.from_pretrained("ProsusAI/finbert")
        _finbert_model = AutoModelForSequenceClassification.from_pretrained("ProsusAI/finbert")
        _finbert_model.eval()
        return _finbert_tokenizer, _finbert_model
    except Exception as e:
        print(f"FinBERT load error (pipeline): {e}")
        return None, None

# Initialize providers
groq_client: Optional[Groq] = None
if os.getenv("GROQ_API_KEY"):
    groq_client = Groq(api_key=os.getenv("GROQ_API_KEY"))

market_data = MarketDataProvider()

MAX_PROMPT_LEN = 500
GROQ_BASE_MODEL = os.getenv("GROQ_BASE_MODEL", "llama-3.3-70b-versatile")
GROQ_DEEP_MODEL = os.getenv("GROQ_DEEP_MODEL", "openai/gpt-oss-120b")


def _safe_int_env(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except (TypeError, ValueError):
        return default


RAG_STORE_URI = os.getenv("RAG_STORE_URI") or os.getenv("POSTGRES_URL") or "local://"
RAG_K_WATCHLIST_DEEP = _safe_int_env("RAG_K_WATCHLIST_DEEP", 6)
RAG_CONTEXT_MAX_CHUNKS = _safe_int_env("RAG_CONTEXT_MAX_CHUNKS", 4)
RAG_CONTEXT_MAX_CHARS = _safe_int_env("RAG_CONTEXT_MAX_CHARS", 700)
WATCHLIST_MIN_MARKET_CAP = float(os.getenv("WATCHLIST_MIN_MARKET_CAP", "100000000"))
WATCHLIST_MIN_VOLUME = _safe_int_env("WATCHLIST_MIN_VOLUME", 100000)
WATCHLIST_MAX_TICKERS = _safe_int_env("WATCHLIST_MAX_TICKERS", 8)
WATCHLIST_MAX_TICKER_EXPLANATIONS = _safe_int_env("WATCHLIST_MAX_TICKER_EXPLANATIONS", 8)

rag_store: Any = None
rag_init_failed = False

def _sanitize_prompt(prompt: str) -> str:
    cleaned = prompt.replace("\n", " ").replace("\r", " ").replace("\t", " ")
    cleaned = "".join(ch for ch in cleaned if ch.isprintable())
    cleaned = cleaned.strip()
    return cleaned[:MAX_PROMPT_LEN]


@dataclass
class StrategyIntent:
    """Extracted intent from user prompt."""
    sector: Optional[str] = None
    risk_level: str = "medium"
    region: str = "US"
    theme: Optional[str] = None
    market_cap: str = "any"
    time_horizon: str = "medium"


def _call_groq(
    system_prompt: str,
    user_prompt: str,
    model: Optional[str] = None,
    temperature: float = 0.7,
    max_tokens: int = 1024
) -> Optional[str]:
    """Make a Groq API call with error handling."""
    if not groq_client:
        return None
    
    try:
        response = groq_client.chat.completions.create(
            model=model or GROQ_BASE_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            temperature=temperature,
            max_tokens=max_tokens
        )
        return response.choices[0].message.content
    except Exception as e:
        print(f"Groq API error: {e}")
        return None


def _call_groq_with_fallback(
    system_prompt: str,
    user_prompt: str,
    models: List[str],
    temperature: float = 0.5,
    max_tokens: int = 768
) -> tuple[Optional[str], Optional[str]]:
    seen = set()
    for model in models:
        if not model or model in seen:
            continue
        seen.add(model)
        response = _call_groq(
            system_prompt,
            user_prompt,
            model=model,
            temperature=temperature,
            max_tokens=max_tokens
        )
        if response:
            return response, model
    return None, None


def _get_rag_store():
    global rag_store
    global rag_init_failed

    if rag_store is not None:
        return rag_store

    if rag_init_failed:
        return None

    try:
        # Imported lazily so environments without LlamaIndex can still run non-deep flows.
        from src.rag import VectorStore

        rag_store = VectorStore(connection_string=RAG_STORE_URI)
        return rag_store
    except Exception as e:
        print(f"RAG initialization unavailable: {e}")
        rag_init_failed = True
        return None


def extract_intent(prompt: str) -> StrategyIntent:
    """Step 1: Router - Extract structured intent from natural language."""
    prompt = _sanitize_prompt(prompt)
    system_prompt = """Extract trading strategy intent from the user's prompt.
Return ONLY valid JSON with these fields:
{
  "sector": "string or null",
  "risk_level": "low" | "medium" | "high",
  "region": "US" | "EU" | "ASIA" | "GLOBAL",
  "theme": "string or null",
  "market_cap": "small" | "mid" | "large" | "any",
  "time_horizon": "short" | "medium" | "long"
}
No markdown, no explanation, just JSON."""

    response = _call_groq(system_prompt, prompt)
    
    if not response:
        # Default intent if LLM fails
        return StrategyIntent(theme=prompt[:50])
    
    try:
        # Clean up response
        json_str = response.strip()
        if json_str.startswith("```"):
            json_str = json_str.replace("```json", "").replace("```", "").strip()
        
        data = json.loads(json_str)
        # Defensive parsing: LLMs occasionally emit null/invalid values even when instructed.
        risk_level_raw = data.get("risk_level") if isinstance(data, dict) else None
        risk_level = str(risk_level_raw).strip().lower() if risk_level_raw else "medium"
        if risk_level not in {"low", "medium", "high"}:
            risk_level = "medium"

        region_raw = data.get("region") if isinstance(data, dict) else None
        region = str(region_raw).strip().upper() if region_raw else "US"
        if region not in {"US", "EU", "ASIA", "GLOBAL"}:
            region = "US"

        market_cap_raw = data.get("market_cap") if isinstance(data, dict) else None
        market_cap = str(market_cap_raw).strip().lower() if market_cap_raw else "any"
        if market_cap not in {"small", "mid", "large", "any"}:
            market_cap = "any"

        horizon_raw = data.get("time_horizon") if isinstance(data, dict) else None
        time_horizon = str(horizon_raw).strip().lower() if horizon_raw else "medium"
        if time_horizon not in {"short", "medium", "long"}:
            time_horizon = "medium"

        return StrategyIntent(
            sector=data.get("sector"),
            risk_level=risk_level,
            region=region,
            theme=data.get("theme"),
            market_cap=market_cap,
            time_horizon=time_horizon
        )
    except json.JSONDecodeError:
        return StrategyIntent(theme=prompt[:50])


def generate_candidates(intent: StrategyIntent) -> List[str]:
    """Step 2: Generator - Generate candidate tickers from intent."""
    system_prompt = """You are a financial analyst specializing in thematic stock screening.
Generate a list of 10-15 US stock tickers that DIRECTLY express the investment theme.

Rules:
- Only include stocks where the theme is a CORE part of their business model — not adjacent exposure.
  Example: "AI stocks" → NVDA, MSFT, META, GOOGL, AMD, ORCL, CRM, PLTR ✓
  Example: "AI stocks" → GE (uses AI internally), XOM (not AI), TSLA (EV brand) ✗
  Example: "cybersecurity" → CRWD, PANW, ZS, FTNT, S, CYBR ✓
  Example: "cybersecurity" → MSFT (peripheral), GOOGL (peripheral) ✗
- Prefer pure-plays and companies deriving meaningful revenue from the theme.
- Only include real, actively traded NYSE/NASDAQ tickers with ticker length ≤ 5 chars.
Return ONLY valid JSON: {"candidates": ["TICK1", "TICK2", ...]}
No markdown, no explanation, just JSON."""

    user_prompt = f"""Investment theme: "{intent.theme or intent.sector or 'General market'}"
Strategy criteria:
- Sector: {intent.sector or 'Any'}
- Risk Level: {intent.risk_level}
- Market Cap: {intent.market_cap}
- Time Horizon: {intent.time_horizon}

Generate 10-15 tickers that are clear, direct expressions of this theme."""

    response = _call_groq(system_prompt, user_prompt)
    
    if not response:
        # Fallback to popular tickers
        return ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA", "AMD"]
    
    try:
        json_str = response.strip()
        if json_str.startswith("```"):
            json_str = json_str.replace("```json", "").replace("```", "").strip()
        
        data = json.loads(json_str)
        candidates = data.get("candidates", [])
        
        # Sanitize: uppercase, remove special chars
        return [c.upper().strip() for c in candidates if isinstance(c, str) and len(c) <= 5]
    except json.JSONDecodeError:
        return ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA"]


def validate_tickers(candidates: List[str]) -> List[Dict[str, Any]]:
    """Step 3: Validator - Check tickers exist via yfinance."""
    valid = []
    
    for ticker in candidates[:15]:  # Limit to prevent API abuse
        try:
            stock = yf.Ticker(ticker)
            info = stock.info
            
            price = info.get("regularMarketPrice") or info.get("currentPrice")
            if not price:
                continue
            
            valid.append({
                "symbol": ticker,
                "name": info.get("shortName", info.get("longName", ticker)),
                "price": price,
                "market_cap": info.get("marketCap"),
                "volume": info.get("averageVolume"),
                "sector": info.get("sector", "Unknown")
            })
        except Exception:
            pass  # Skip invalid tickers
    
    return valid


def filter_tickers(
    valid: List[Dict],
    min_market_cap: float = 1e8,
    min_volume: int = 100000,
    max_tickers: int = 8
) -> List[Dict]:
    """Step 4: Filter - Remove low-quality tickers."""
    filtered = []
    
    for t in valid:
        cap = t.get("market_cap") or 0
        vol = t.get("volume") or 0
        
        if cap >= min_market_cap and vol >= min_volume:
            filtered.append(t)
    
    # Sort by market cap descending, take top N
    filtered.sort(key=lambda x: x.get("market_cap", 0), reverse=True)
    return filtered[:max_tickers]


def calculate_risk_score(
    volatility: float,
    var_95: float,
    sharpe: float
) -> int:
    """
    Composite risk score 0-100 (higher = riskier).
    
    Formula:
    - Volatility component (40%): Scaled 0-60% annualized → 0-40
    - VaR component (40%): Scaled 0-10% daily loss → 0-40
    - Sharpe penalty (20%): Negative Sharpe adds risk
    """
    # Volatility: 0-60% annualized → 0-40 points
    vol_score = min(40, (volatility / 0.60) * 40) if volatility else 0

    # VaR: 0-10% daily loss → 0-40 points (VaR is negative, so abs)
    var_score = min(40, (abs(var_95) / 0.10) * 40) if var_95 else 0

    # Sharpe: negative Sharpe adds 0-20 points
    sharpe_penalty = 0
    if sharpe and sharpe < 0:
        sharpe_penalty = min(20, abs(sharpe) * 10)
    elif sharpe and sharpe > 1:
        sharpe_penalty = -10  # Bonus for good Sharpe
    
    total = vol_score + var_score + sharpe_penalty
    return max(0, min(100, int(total)))


def run_quant_analysis(tickers: List[str]) -> Dict[str, Any]:
    """Step 5: Quant - Run real risk analysis on validated tickers."""
    if not tickers:
        return {}
    
    try:
        # Fetch market data
        prices = market_data.get_prices(tickers, period="1y")
        returns = market_data.get_returns(tickers, period="1y")

        if returns.empty:
            print(f"Quant analysis: returns DataFrame is empty for {tickers}")
            return {}

        print(f"Quant analysis: returns shape={returns.shape}, columns={list(returns.columns)}")

        # Calculate metrics
        volatility = calculate_rolling_volatility(returns)
        sharpe = calculate_sharpe_ratio(returns)
        var = calculate_var(returns)
        cvar = calculate_cvar(returns)
        simulation = monte_carlo_simulation(returns)
        regime = detect_regime(returns)

        # Get latest volatility values
        latest_vol = volatility.iloc[-1] if not volatility.empty else {}

        vol_dict = latest_vol.to_dict() if hasattr(latest_vol, 'to_dict') else {}
        sharpe_dict = sharpe.to_dict() if hasattr(sharpe, 'to_dict') else {}
        var_dict = var.to_dict() if hasattr(var, 'to_dict') else {}
        cvar_dict = cvar.to_dict() if hasattr(cvar, 'to_dict') else {}

        print(f"Quant analysis: vol keys={list(vol_dict.keys())}, sharpe keys={list(sharpe_dict.keys())}")
        # Log a sample value for debugging
        if vol_dict:
            sample_key = next(iter(vol_dict))
            print(f"Quant analysis sample: {sample_key} vol={vol_dict[sample_key]}, "
                  f"sharpe={sharpe_dict.get(sample_key)}, var={var_dict.get(sample_key)}")

        return {
            "volatility": vol_dict,
            "sharpe": sharpe_dict,
            "var_95": var_dict,
            "cvar_95": cvar_dict,
            "simulation": simulation,
            "regime": regime
        }
    except Exception as e:
        import traceback
        print(f"Quant analysis error: {e}")
        traceback.print_exc()
        return {}


def compose_results(
    filtered_tickers: List[Dict],
    quant_data: Dict[str, Any]
) -> List[Dict[str, Any]]:
    """Combine ticker info with quant metrics."""
    results = []
    
    for t in filtered_tickers:
        symbol = t["symbol"]

        vol = _coerce_float(quant_data.get("volatility", {}).get(symbol))
        var = _coerce_float(quant_data.get("var_95", {}).get(symbol))
        sharpe = _coerce_float(quant_data.get("sharpe", {}).get(symbol))
        cvar = _coerce_float(quant_data.get("cvar_95", {}).get(symbol))
        quant_available = any(metric is not None for metric in (vol, var, sharpe, cvar))

        if quant_available:
            # Only use actual values – never substitute hardcoded defaults
            risk_score = calculate_risk_score(
                vol if vol is not None else 0.0,
                var if var is not None else 0.0,
                sharpe if sharpe is not None else 0.0
            )
        else:
            # No quant metrics available for this ticker in this run.
            # Use neutral provisional score instead of a misleading default.
            risk_score = 50
        
        results.append({
            "symbol": symbol,
            "name": t.get("name", symbol),
            "sector": t.get("sector", "Unknown"),
            "price": t.get("price"),
            "riskScore": risk_score,
            "quant_data_available": quant_available,
            "volatility_30d": round(vol, 4) if vol is not None else None,
            "sharpe_ratio": round(sharpe, 2) if sharpe is not None else None,
            "var_95": round(var, 4) if var is not None else None,
            "cvar_95": round(cvar, 4) if cvar is not None else None
        })
    
    # Sort by risk score descending
    results.sort(key=lambda x: x["riskScore"], reverse=True)
    return results


def _json_safe(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: _json_safe(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_json_safe(v) for v in value]
    if isinstance(value, tuple):
        return [_json_safe(v) for v in value]
    if isinstance(value, (np.integer, np.floating)):
        return float(value)
    return value


def _coerce_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, (np.integer, np.floating)):
        value = float(value)
    if isinstance(value, (int, float)):
        if not np.isfinite(value):
            return None
        return float(value)
    if isinstance(value, str):
        try:
            parsed = float(value)
            if not np.isfinite(parsed):
                return None
            return parsed
        except ValueError:
            return None
    return None


def _format_compact_currency(value: Optional[float]) -> str:
    if value is None:
        return "N/A"
    abs_value = abs(value)
    if abs_value >= 1_000_000_000_000:
        return f"${value / 1_000_000_000_000:.2f}T"
    if abs_value >= 1_000_000_000:
        return f"${value / 1_000_000_000:.2f}B"
    if abs_value >= 1_000_000:
        return f"${value / 1_000_000:.2f}M"
    return f"${value:,.0f}"


def _extract_financial_highlights(ticker: str) -> Dict[str, Optional[float]]:
    try:
        financials = market_data.get_financials(ticker)
        key_stats = financials.get("key_stats", {}) if isinstance(financials, dict) else {}
        valuation = financials.get("valuation_ratios", {}) if isinstance(financials, dict) else {}
    except Exception:
        key_stats = {}
        valuation = {}

    return {
        "marketCap": _coerce_float(key_stats.get("market_cap")),
        "totalRevenue": _coerce_float(key_stats.get("total_revenue")),
        "netIncome": _coerce_float(key_stats.get("net_income")),
        "totalDebt": _coerce_float(key_stats.get("total_debt")),
        "epsDiluted": _coerce_float(key_stats.get("eps_diluted")),
        "trailingPE": _coerce_float(valuation.get("trailing_pe")),
        "forwardPE": _coerce_float(valuation.get("forward_pe")),
        "priceToSales": _coerce_float(valuation.get("price_to_sales")),
        "priceToBook": _coerce_float(valuation.get("price_to_book")),
        "evToEbitda": _coerce_float(valuation.get("ev_to_ebitda")),
        "pegRatio": _coerce_float(valuation.get("peg_ratio")),
    }


def _extract_filing_summaries(ticker: str) -> List[Dict[str, Optional[str]]]:
    try:
        filings = edgar_provider.get_recent_filings(
            ticker,
            filing_types=["10-K", "10-Q", "8-K"],
            limit=3
        )
    except Exception:
        filings = []

    summaries: List[Dict[str, Optional[str]]] = []
    for filing in filings:
        if not isinstance(filing, dict):
            continue
        summaries.append({
            "form": filing.get("form"),
            "filingDate": filing.get("filing_date"),
            "description": filing.get("description"),
            "url": filing.get("url"),
        })
    return summaries


def _analyze_news_sentiment(ticker: str) -> Dict[str, Any]:
    """Fetch recent news for a ticker and run FinBERT sentiment analysis."""
    try:
        import torch
        tok, mdl = _get_finbert()
        if tok is None or mdl is None:
            return {"articles": [], "aggregate": None}

        headlines = market_data.get_news(ticker)
        if not headlines:
            return {"articles": [], "aggregate": None}

        analyzed = []
        pos_sum = neg_sum = neu_sum = 0.0

        for article in headlines[:5]:  # Limit to 5 most recent
            title = (article.get("title") or "").strip()
            if not title:
                continue

            inputs = tok(title, return_tensors="pt", padding=True, truncation=True, max_length=512)
            with torch.no_grad():
                outputs = mdl(**inputs)
            probs = torch.nn.functional.softmax(outputs.logits, dim=-1)
            scores = probs[0].tolist()
            labels = ["positive", "negative", "neutral"]
            label = labels[scores.index(max(scores))]

            pos_sum += scores[0]
            neg_sum += scores[1]
            neu_sum += scores[2]

            analyzed.append({
                "title": title,
                "publisher": article.get("publisher", ""),
                "providerPublishTime": article.get("providerPublishTime"),
                "sentiment": label,
                "positive": round(scores[0], 4),
                "negative": round(scores[1], 4),
                "neutral": round(scores[2], 4),
            })

        n = len(analyzed) or 1
        aggregate = {
            "positive": round(pos_sum / n, 4),
            "negative": round(neg_sum / n, 4),
            "neutral": round(neu_sum / n, 4),
            "label": "positive" if pos_sum >= neg_sum and pos_sum >= neu_sum
                     else "negative" if neg_sum >= pos_sum
                     else "neutral",
            "count": len(analyzed),
        }

        return {"articles": analyzed, "aggregate": aggregate}
    except Exception as e:
        print(f"News sentiment error for {ticker}: {e}")
        return {"articles": [], "aggregate": None}


def _extract_income_change(ticker: str) -> Dict[str, Any]:
    """Extract recent income/revenue change from quarterly financials."""
    try:
        financials = market_data.get_financials(ticker)
        statements = financials.get("statements", {}) if isinstance(financials, dict) else {}
        income_q = statements.get("income_statement", {}).get("quarterly", {})

        rows = income_q.get("rows", [])
        columns = income_q.get("columns", [])

        if len(columns) < 2:
            return {}

        def _find_row(label_candidates):
            for row in rows:
                label = (row.get("label") or "").strip()
                for candidate in label_candidates:
                    if candidate.lower() in label.lower():
                        return row
            return None

        result = {}

        revenue_row = _find_row(["Total Revenue", "Revenue"])
        if revenue_row:
            vals = revenue_row.get("values", [])
            if len(vals) >= 2 and vals[-1] is not None and vals[-2] is not None:
                try:
                    latest = float(vals[-1])
                    prev = float(vals[-2])
                    if prev != 0:
                        result["revenueChange"] = round(((latest - prev) / abs(prev)) * 100, 2)
                        result["latestRevenue"] = latest
                        result["prevRevenue"] = prev
                        result["revenuePeriods"] = [columns[-2], columns[-1]] if len(columns) >= 2 else []
                except (ValueError, TypeError):
                    pass

        income_row = _find_row(["Net Income", "Net Income Common"])
        if income_row:
            vals = income_row.get("values", [])
            if len(vals) >= 2 and vals[-1] is not None and vals[-2] is not None:
                try:
                    latest = float(vals[-1])
                    prev = float(vals[-2])
                    if prev != 0:
                        result["netIncomeChange"] = round(((latest - prev) / abs(prev)) * 100, 2)
                        result["latestNetIncome"] = latest
                        result["prevNetIncome"] = prev
                except (ValueError, TypeError):
                    pass

        return result
    except Exception as e:
        print(f"Income change error for {ticker}: {e}")
        return {}


def _build_ticker_rationale(
    ticker_data: Dict[str, Any],
    financials: Dict[str, Optional[float]],
    filings: List[Dict[str, Optional[str]]],
    news_sentiment: Optional[Dict[str, Any]] = None,
    income_change: Optional[Dict[str, Any]] = None,
) -> str:
    symbol = ticker_data.get("symbol", "N/A")
    risk_score = ticker_data.get("riskScore", "N/A")
    volatility = ticker_data.get("volatility_30d")
    sharpe = ticker_data.get("sharpe_ratio")
    var_95 = ticker_data.get("var_95")
    cvar_95 = ticker_data.get("cvar_95")
    quant_available = bool(ticker_data.get("quant_data_available", False))

    sentences = []

    market_cap = financials.get("marketCap")
    ticker_name = ticker_data.get("name", "")
    ticker_sector = ticker_data.get("sector", "")
    name_suffix = f" ({ticker_name})" if ticker_name and ticker_name != symbol else ""
    sector_tag = f" {ticker_sector}" if ticker_sector and ticker_sector.lower() != "unknown" else ""
    if market_cap is not None:
        if market_cap >= 200_000_000_000:
            size_label = "mega-cap"
        elif market_cap >= 10_000_000_000:
            size_label = "large-cap"
        elif market_cap >= 2_000_000_000:
            size_label = "mid-cap"
        else:
            size_label = "small-cap"
        cap_note = (
            f"{symbol}{name_suffix} is a {size_label}{sector_tag} company "
            f"(market cap {_format_compact_currency(market_cap)})."
        )
        sentences.append(cap_note)
    else:
        sentences.append(
            f"{symbol}{name_suffix} was included for theme and liquidity fit; market cap data unavailable at generation time."
        )

    revenue = financials.get("totalRevenue")
    net_income = financials.get("netIncome")
    debt = financials.get("totalDebt")
    eps = financials.get("epsDiluted")
    fundamentals_bits = []
    if revenue is not None:
        fundamentals_bits.append(f"revenue {_format_compact_currency(revenue)}")
    if net_income is not None:
        fundamentals_bits.append(f"net income {_format_compact_currency(net_income)}")
    if debt is not None:
        fundamentals_bits.append(f"debt {_format_compact_currency(debt)}")
    if eps is not None:
        fundamentals_bits.append(f"EPS {eps:.2f}")
    if fundamentals_bits:
        sentences.append("Financial profile snapshot: " + ", ".join(fundamentals_bits) + ".")

    # Valuation multiples
    valuation_bits = []
    trailing_pe = financials.get("trailingPE")
    forward_pe = financials.get("forwardPE")
    if trailing_pe is not None and forward_pe is not None:
        valuation_bits.append(f"P/E {trailing_pe:.1f} (fwd {forward_pe:.1f})")
    elif trailing_pe is not None:
        valuation_bits.append(f"P/E {trailing_pe:.1f}")
    ps = financials.get("priceToSales")
    if ps is not None:
        valuation_bits.append(f"P/S {ps:.1f}")
    pb = financials.get("priceToBook")
    if pb is not None:
        valuation_bits.append(f"P/B {pb:.1f}")
    ev_ebitda = financials.get("evToEbitda")
    if ev_ebitda is not None:
        valuation_bits.append(f"EV/EBITDA {ev_ebitda:.1f}")
    peg = financials.get("pegRatio")
    if peg is not None:
        valuation_bits.append(f"PEG {peg:.2f}")
    if valuation_bits:
        sentences.append("Valuation: " + ", ".join(valuation_bits) + ".")

    # Income/revenue change (QoQ)
    if income_change:
        change_bits = []
        rev_chg = income_change.get("revenueChange")
        ni_chg = income_change.get("netIncomeChange")
        if rev_chg is not None:
            direction = "up" if rev_chg > 0 else "down"
            change_bits.append(f"revenue {direction} {abs(rev_chg):.1f}% QoQ")
        if ni_chg is not None:
            direction = "up" if ni_chg > 0 else "down"
            change_bits.append(f"net income {direction} {abs(ni_chg):.1f}% QoQ")
        if change_bits:
            sentences.append("Quarterly change: " + ", ".join(change_bits) + ".")

    if filings:
        form_hints = {
            "8-K": "current report (material events like earnings, guidance, deals, litigation)",
            "10-Q": "quarterly report (quarterly financials + management discussion)",
            "10-K": "annual report (full-year financials, risks, and business overview)",
        }
        filing_labels = []
        for filing in filings:
            form = (filing.get("form") or "Filing").strip().upper()
            filing_date = filing.get("filingDate")
            description = (filing.get("description") or "").strip()
            label = f"{form}{f' ({filing_date})' if filing_date else ''}"
            hint = form_hints.get(form)
            if hint:
                label = f"{label} - {hint}"
            # Append the EDGAR filing description if it provides extra info
            if description and description.lower() not in (form.lower(), f"{form.lower()} annual report", f"{form.lower()} quarterly report"):
                label = f"{label}. Summary: \"{description}\""
            filing_labels.append(label)
        sentences.append(
            "Recent SEC filings: "
            + "; ".join(filing_labels)
            + "."
        )
    else:
        sentences.append("Recent SEC filings were not available in this pass.")

    if quant_available:
        quant_bits = [f"risk score {risk_score}"]
        if isinstance(volatility, (int, float)):
            quant_bits.append(f"30d vol {volatility:.2%}")
        if isinstance(var_95, (int, float)):
            quant_bits.append(f"VaR95 {var_95:.2%}")
        if isinstance(cvar_95, (int, float)):
            quant_bits.append(f"CVaR95 {cvar_95:.2%}")
        if isinstance(sharpe, (int, float)):
            quant_bits.append(f"Sharpe {sharpe:.2f}")
        sentences.append("Quant fit: " + ", ".join(quant_bits) + ".")
    else:
        sentences.append(
            "Quant metrics were unavailable for this name in the current run; risk score is provisional."
        )

    # News sentiment (FinBERT)
    if news_sentiment:
        agg = news_sentiment.get("aggregate")
        articles = news_sentiment.get("articles", [])
        if agg and agg.get("count", 0) > 0:
            label = agg.get("label", "neutral")
            pos_pct = round(agg.get("positive", 0) * 100)
            neg_pct = round(agg.get("negative", 0) * 100)
            sentences.append(
                f"News sentiment (FinBERT, {agg['count']} articles): "
                f"{label} (positive {pos_pct}%, negative {neg_pct}%)."
            )
            # Include top headline summaries
            for art in articles[:3]:
                title = art.get("title", "")
                sent = art.get("sentiment", "")
                if title and sent:
                    sentences.append(f"  • \"{title}\" — {sent}")

    return " ".join(sentences)


def _generate_ticker_rationales_batch(
    results: List[Dict[str, Any]],
    financials_map: Dict[str, Dict],
    income_map: Dict[str, Dict],
    theme: str,
) -> Dict[str, str]:
    """Single LLM call to generate distinct rationale paragraphs for all tickers."""
    if not groq_client or not results:
        return {}

    lines = []
    for td in results:
        sym = td.get("symbol", "?")
        name = td.get("name", sym)
        sector = td.get("sector", "Unknown")
        risk = td.get("riskScore", "N/A")
        vol = td.get("volatility_30d")
        sharpe = td.get("sharpe_ratio")
        var = td.get("var_95")

        fin = financials_map.get(sym, {})
        market_cap = fin.get("marketCap")
        revenue = fin.get("totalRevenue")
        net_income = fin.get("netIncome")
        trailing_pe = fin.get("trailingPE")
        forward_pe = fin.get("forwardPE")

        inc = income_map.get(sym, {})
        rev_chg = inc.get("revenueChange")

        parts = [f"{sym} ({name}, {sector})"]
        if market_cap:
            parts.append(f"mktcap={_format_compact_currency(market_cap)}")
        parts.append(f"risk={risk}/100")
        if vol is not None:
            parts.append(f"vol={vol:.1%}")
        if sharpe is not None:
            parts.append(f"Sharpe={sharpe:.2f}")
        if var is not None:
            parts.append(f"VaR={var:.2%}")
        if revenue is not None:
            parts.append(f"rev={_format_compact_currency(revenue)}")
        if net_income is not None:
            parts.append(f"ni={_format_compact_currency(net_income)}")
        if trailing_pe is not None and forward_pe is not None:
            parts.append(f"P/E={trailing_pe:.1f}(fwd {forward_pe:.1f})")
        elif trailing_pe is not None:
            parts.append(f"P/E={trailing_pe:.1f}")
        if rev_chg is not None:
            sign = "+" if rev_chg > 0 else ""
            parts.append(f"rev_chg={sign}{rev_chg:.1f}%QoQ")
        lines.append("  " + ", ".join(parts))

    system_prompt = """You are a senior equity analyst writing a one-paragraph rationale for each stock in a thematic watchlist.

For each ticker write exactly 2–3 sentences:
- Sentence 1: Why this stock fits the theme — its specific business model and direct role in the theme.
- Sentence 2: One or two quant signals, characterized accurately (see metric guide below).
- Sentence 3 (optional): One fundamental standout — revenue trend, QoQ change, PE, or notable margin.

Metric interpretation (do NOT get these backwards):
- risk score: 0–35 = low risk, 36–60 = moderate risk, 61–100 = HIGH risk
- vol: <20% = low, 20–35% = moderate, >35% = elevated/high volatility
- Sharpe: >1 = strong, 0–1 = acceptable, <0 = poor risk-adjusted return
- VaR: more negative = HIGHER potential daily loss (VaR=-7% means up to 7% daily loss — this is HIGH risk, not stability)

Style rules:
- Each rationale must open differently — vary the subject and construction across all tickers.
- Do NOT start multiple rationales with "As a", "The AI theme", or "With a".
- Write like a briefing note, not a definition. Assume a financially literate reader.
- Use only numbers from the provided data. Do not invent figures.

Return ONLY valid JSON: {"SYMBOL": "rationale text", ...}
No markdown, no extra keys, no explanation."""

    user_prompt = (
        f"Investment theme: \"{theme}\"\n\n"
        "Tickers:\n" + "\n".join(lines)
    )

    response = _call_groq(
        system_prompt,
        user_prompt,
        model=GROQ_BASE_MODEL,
        temperature=0.55,
        max_tokens=1400,
    )

    if not response:
        return {}

    try:
        json_str = response.strip()
        if json_str.startswith("```"):
            json_str = json_str.replace("```json", "").replace("```", "").strip()
        data = json.loads(json_str)
        if isinstance(data, dict):
            return {k.upper(): str(v) for k, v in data.items()}
    except Exception as e:
        print(f"Ticker rationale batch parse error: {e}")
    return {}


def build_ticker_explanations(results: List[Dict[str, Any]], theme: str = "") -> List[Dict[str, Any]]:
    tickers_to_process = results[:WATCHLIST_MAX_TICKER_EXPLANATIONS]

    # First pass: collect all structured data
    raw_data = []
    for ticker_data in tickers_to_process:
        symbol = ticker_data.get("symbol")
        if not symbol:
            continue
        financials = _extract_financial_highlights(symbol)
        filings = _extract_filing_summaries(symbol)
        news_sentiment = _analyze_news_sentiment(symbol)
        income_change = _extract_income_change(symbol)
        raw_data.append((ticker_data, financials, filings, news_sentiment, income_change))

    if not raw_data:
        return []

    # Single LLM call for all rationales
    financials_map = {td.get("symbol"): fin for td, fin, _, _, _ in raw_data}
    income_map = {td.get("symbol"): inc for td, _, _, _, inc in raw_data}
    llm_rationales = _generate_ticker_rationales_batch(
        [td for td, _, _, _, _ in raw_data],
        financials_map,
        income_map,
        theme,
    )

    # Second pass: assemble explanations, fall back to template if LLM failed
    explanations = []
    for ticker_data, financials, filings, news_sentiment, income_change in raw_data:
        symbol = ticker_data.get("symbol")
        rationale = llm_rationales.get(symbol) or _build_ticker_rationale(
            ticker_data, financials, filings,
            news_sentiment=news_sentiment,
            income_change=income_change,
        )
        explanations.append({
            "symbol": symbol,
            "rationale": rationale,
            "financialHighlights": financials,
            "filings": filings,
            "newsSentiment": news_sentiment,
            "incomeChange": income_change,
        })
    return explanations


def _build_summary(
    results: List[Dict[str, Any]],
    intent: StrategyIntent,
    quant_data: Dict[str, Any]
) -> Dict[str, Any]:
    if not results:
        return {
            "strategy": intent.theme or intent.sector or "General",
            "risk_level": intent.risk_level,
            "tickers_analyzed": 0,
            "avg_risk_score": 0.0,
            "risk_score_std": 0.0,
            "risk_score_uniform": True,
            "quant_coverage": 0.0,
            "highest_risk": {},
            "lowest_risk": {},
            "regime": quant_data.get("regime", {}),
            "loss_probability_30d": quant_data.get("simulation", {}).get("loss_probability_30d")
        }

    risk_scores = [
        float(r.get("riskScore", 0.0))
        for r in results
        if isinstance(r.get("riskScore"), (int, float, np.integer, np.floating))
    ]
    avg_risk = sum(risk_scores) / len(risk_scores) if risk_scores else 0.0
    risk_score_std = float(np.std(risk_scores)) if len(risk_scores) > 1 else 0.0
    risk_score_uniform = risk_score_std < 8.0

    quant_available_count = sum(1 for r in results if r.get("quant_data_available"))
    quant_coverage = quant_available_count / len(results)

    high_sorted = sorted(
        results,
        key=lambda x: (
            x.get("riskScore", -1),
            abs(_coerce_float(x.get("volatility_30d")) or -1),
            abs(_coerce_float(x.get("var_95")) or -1),
            str(x.get("symbol", ""))
        ),
        reverse=True
    )
    low_sorted = sorted(
        results,
        key=lambda x: (
            x.get("riskScore", 10_000),
            abs(_coerce_float(x.get("volatility_30d")) or 10_000),
            abs(_coerce_float(x.get("var_95")) or 10_000),
            str(x.get("symbol", ""))
        )
    )

    highest_risk = high_sorted[0]
    lowest_risk = low_sorted[0]
    if len(results) > 1 and highest_risk.get("symbol") == lowest_risk.get("symbol"):
        for candidate in low_sorted:
            if candidate.get("symbol") != highest_risk.get("symbol"):
                lowest_risk = candidate
                break

    return {
        "strategy": intent.theme or intent.sector or "General",
        "risk_level": intent.risk_level,
        "tickers_analyzed": len(results),
        "avg_risk_score": avg_risk,
        "risk_score_std": risk_score_std,
        "risk_score_uniform": risk_score_uniform,
        "quant_coverage": quant_coverage,
        "highest_risk": highest_risk,
        "lowest_risk": lowest_risk,
        "regime": quant_data.get("regime", {}),
        "loss_probability_30d": quant_data.get("simulation", {}).get("loss_probability_30d")
    }


def _build_rag_documents(
    prompt: str,
    intent: StrategyIntent,
    summary: Dict[str, Any],
    quant_data: Dict[str, Any],
    results: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    top_assets = results[:min(len(results), 8)]
    top_asset_lines = []
    for asset in top_assets:
        top_asset_lines.append(
            f"{asset.get('symbol', 'N/A')}: riskScore={asset.get('riskScore', 'N/A')}, "
            f"vol30d={asset.get('volatility_30d', 'N/A')}, var95={asset.get('var_95', 'N/A')}, "
            f"cvar95={asset.get('cvar_95', 'N/A')}, sharpe={asset.get('sharpe_ratio', 'N/A')}"
        )

    regime = quant_data.get("regime", {}) or {}
    simulation = quant_data.get("simulation", {}) or {}
    highest = summary.get("highest_risk") or {}
    lowest = summary.get("lowest_risk") or {}
    quant_coverage = summary.get("quant_coverage")
    quant_coverage_text = (
        f"{quant_coverage:.0%}" if isinstance(quant_coverage, (int, float)) else "N/A"
    )

    return [
        {
            "title": "Watchlist Prompt & Intent",
            "source": "watchlist-generator",
            "url": None,
            "content": (
                f"User prompt: {prompt}\n"
                f"Theme: {intent.theme or 'N/A'}\n"
                f"Sector: {intent.sector or 'N/A'}\n"
                f"Risk level: {intent.risk_level}\n"
                f"Region: {intent.region}\n"
                f"Market cap preference: {intent.market_cap}\n"
                f"Time horizon: {intent.time_horizon}"
            ),
        },
        {
            "title": "Portfolio Risk Snapshot",
            "source": "watchlist-quant",
            "url": None,
            "content": (
                f"Tickers analyzed: {summary.get('tickers_analyzed')}\n"
                f"Average risk score: {summary.get('avg_risk_score')}\n"
                f"Risk score dispersion (std): {summary.get('risk_score_std')}\n"
                f"Quant coverage: {quant_coverage_text}\n"
                f"Highest risk: {highest.get('symbol', 'N/A')} ({highest.get('riskScore', 'N/A')})\n"
                f"Lowest risk: {lowest.get('symbol', 'N/A')} ({lowest.get('riskScore', 'N/A')})\n"
                "Top assets:\n"
                f"{chr(10).join(top_asset_lines)}"
            ),
        },
        {
            "title": "Regime & Simulation Summary",
            "source": "watchlist-regime",
            "url": None,
            "content": (
                f"Regime current: {regime.get('current_regime', 'N/A')}\n"
                f"Regime persistence probability: {regime.get('persistence_probability', 'N/A')}\n"
                f"Loss probability 30d: {simulation.get('loss_probability_30d', 'N/A')}\n"
                f"Expected return: {simulation.get('expected_return', 'N/A')}"
            ),
        },
    ]


def _format_context_for_prompt(context_chunks: Optional[List[str]]) -> str:
    if not context_chunks:
        return ""

    lines = []
    for idx, chunk in enumerate(context_chunks[:RAG_CONTEXT_MAX_CHUNKS], start=1):
        cleaned = (chunk or "").replace("\n", " ").strip()
        if not cleaned:
            continue
        clipped = cleaned[:RAG_CONTEXT_MAX_CHARS]
        lines.append(f"[Context {idx}] {clipped}")
    return "\n".join(lines)


def _ingest_and_retrieve_rag_context(
    prompt: str,
    user_id: Optional[str],
    deep_research: bool,
    intent: StrategyIntent,
    summary: Dict[str, Any],
    quant_data: Dict[str, Any],
    results: List[Dict[str, Any]]
) -> tuple[List[str], List[Dict[str, Any]]]:
    if not deep_research or not user_id:
        return [], []

    store = _get_rag_store()
    if store is None:
        return [], []

    try:
        docs = _build_rag_documents(prompt, intent, summary, quant_data, results)
        for doc in docs:
            metadata = {
                "user_id": user_id,
                "source": doc.get("source", "watchlist-rag"),
                "title": doc.get("title", "Watchlist Context"),
                "url": doc.get("url"),
                "strategy": summary.get("strategy"),
                "risk_level": summary.get("risk_level"),
                "ticker_count": summary.get("tickers_analyzed"),
            }
            store.ingest(str(doc.get("content", "")), metadata=metadata)

        retrieved = store.retrieve(
            query=prompt,
            user_id=user_id,
            k=RAG_K_WATCHLIST_DEEP,
            deep=True
        )

        context_chunks: List[str] = []
        citations: List[Dict[str, Any]] = []
        for chunk_text, meta in retrieved:
            text = (chunk_text or "").strip()
            if text:
                context_chunks.append(text)

            clip = text[:180] + "..." if len(text) > 180 else text
            citations.append({
                "source": meta.get("source", "Watchlist Context"),
                "title": meta.get("title", "Watchlist Context"),
                "url": meta.get("url"),
                "chunk": clip,
            })

        return context_chunks, citations
    except Exception as e:
        print(f"RAG ingest/retrieve error: {e}")
        return [], []


def _fallback_narrative(summary: Dict[str, Any], intent: StrategyIntent) -> str:
    avg_score = summary["avg_risk_score"]
    risk_label = "high" if avg_score > 60 else "moderate" if avg_score > 40 else "low"
    return (
        f"This {intent.risk_level}-risk portfolio contains {summary['tickers_analyzed']} assets with "
        f"{risk_label} overall risk (avg score: {avg_score:.0f}/100). "
        f"The current market regime suggests "
        f"{'heightened volatility' if summary.get('regime', {}).get('current_regime') == 'high_vol' else 'stable conditions'}."
    )


def _fallback_reasoning(summary: Dict[str, Any]) -> str:
    highest = summary.get("highest_risk") or {}
    lowest = summary.get("lowest_risk") or {}
    avg_risk = summary.get("avg_risk_score", 0.0)
    risk_std = summary.get("risk_score_std")
    risk_uniform = bool(summary.get("risk_score_uniform"))
    quant_coverage = summary.get("quant_coverage")
    regime = (summary.get("regime") or {}).get("current_regime", "unknown")
    loss_prob = summary.get("loss_probability_30d")
    loss_prob_text = f"{loss_prob:.1%}" if isinstance(loss_prob, (int, float)) else "N/A"
    risk_std_text = f"{risk_std:.2f}" if isinstance(risk_std, (int, float)) else "N/A"
    quant_coverage_text = f"{quant_coverage:.0%}" if isinstance(quant_coverage, (int, float)) else "N/A"

    if risk_uniform:
        evidence_line = (
            f"Risk scores are tightly clustered (std {risk_std_text}); "
            f"no single name is a clear outlier."
        )
    else:
        evidence_line = (
            f"Highest risk is {highest.get('symbol', 'N/A')} ({highest.get('riskScore', 'N/A')}); "
            f"lowest is {lowest.get('symbol', 'N/A')} ({lowest.get('riskScore', 'N/A')})."
        )

    return (
        f"Step 1 - Thesis: Portfolio risk is {summary.get('risk_level', 'medium')} with average score {avg_risk:.0f}/100.\n"
        f"Step 2 - Evidence: {evidence_line}\n"
        f"Step 3 - Risk checks: Regime is {regime}; 30-day loss probability is {loss_prob_text}; quant coverage is {quant_coverage_text}.\n"
        "Step 4 - Trigger: Re-run deep research if regime or top-risk names materially change."
    )


def generate_narrative(
    results: List[Dict],
    intent: StrategyIntent,
    quant_data: Dict[str, Any],
    deep_research: bool = False,
    summary: Optional[Dict[str, Any]] = None,
    rag_context_chunks: Optional[List[str]] = None
) -> tuple[str, Optional[str], Optional[str]]:
    """Step 6: Narrator - Generate human-readable synthesis."""
    if not results:
        return "Unable to generate analysis. No valid tickers found.", None, None
    
    system_prompt = """You are a senior equity analyst writing a synthesis report for an investment theme.
Write exactly 2 paragraphs — no headers, no bullet points.

Paragraph 1 — Investment Thesis: Open with the investment thesis for this basket. Why these stocks, why now, what macro or sector dynamics make the theme compelling or risky. Reference the theme directly. Name specific companies where they add insight. Weave in key quant signals (risk scores, Sharpe, regime, loss probability) to support the thesis — do not just list them.

Paragraph 2 — Risk & Standouts: Identify the highest-risk and lowest-risk names in the basket with a concrete reason for each. Call out specific risk factors — volatility, VaR, negative Sharpe, concentrated exposure. End with one specific catalyst or signal that would materially change the outlook.

Rules:
- Write like an analyst briefing a portfolio manager. Lead with thesis, back it with data.
- Assume a financially literate reader — do NOT define VaR, Sharpe, CVaR, or other standard terms.
- Use the actual numbers provided. Generic statements without data are not acceptable.
- Do not state the same ticker is both highest and lowest risk.
- If risk scores are tightly clustered, say so explicitly instead of naming artificial outliers."""

    # Summarize for LLM
    summary = summary or _build_summary(results, intent, quant_data)
    safe_summary = _json_safe(summary)
    preferred_models = [GROQ_DEEP_MODEL, GROQ_BASE_MODEL] if deep_research else [GROQ_BASE_MODEL]
    context_block = _format_context_for_prompt(rag_context_chunks)

    # Build a compact per-ticker quant table so the LLM has all the context it needs upfront
    ticker_rows = []
    for r in results:
        sym = r.get("symbol", "?")
        name = r.get("name", "")
        risk = r.get("riskScore", "N/A")
        vol = r.get("volatility_30d")
        sharpe = r.get("sharpe_ratio")
        var = r.get("var_95")
        vol_str = f"{vol:.1%}" if isinstance(vol, (int, float)) else "N/A"
        sharpe_str = f"{sharpe:.2f}" if isinstance(sharpe, (int, float)) else "N/A"
        var_str = f"{var:.2%}" if isinstance(var, (int, float)) else "N/A"
        ticker_rows.append(
            f"  {sym} ({name}): risk={risk}/100, vol30d={vol_str}, Sharpe={sharpe_str}, VaR95={var_str}"
        )

    narrative_prompt = (
        f"Investment theme: \"{safe_summary.get('strategy', intent.theme or 'General')}\"\n"
        f"Tickers in basket: {', '.join(r.get('symbol', '') for r in results)}\n\n"
        f"Per-ticker quant snapshot:\n" + "\n".join(ticker_rows) + "\n\n"
        f"Portfolio summary:\n{json.dumps(safe_summary, indent=2)}"
    )
    if context_block:
        narrative_prompt += f"\n\nRetrieved context:\n{context_block}"

    response, narrative_model = _call_groq_with_fallback(
        system_prompt,
        narrative_prompt,
        models=preferred_models,
        temperature=0.45,
        max_tokens=1500
    )

    narrative = response.strip() if response else _fallback_narrative(summary, intent)

    reasoning = None
    reasoning_model = None
    if deep_research:
        reasoning_system_prompt = """You are a portfolio risk reviewer writing a structured reasoning trace.
Return exactly 4 lines — no preamble, no extra text:
Step 1 - Thesis: One sentence on why this basket fits the stated investment theme.
Step 2 - Evidence: Name the highest and lowest risk tickers with their risk scores and one quant fact each. If scores are tightly clustered (std < 8), say so instead.
Step 3 - Risk checks: State the regime, 30-day loss probability, and the single biggest structural risk in the basket.
Step 4 - Trigger: One specific, actionable signal that would prompt re-evaluation of this thesis.
Use only concrete numbers from the data. Do not pad or hedge."""

        # Keep the reasoning prompt compact to avoid input context overflow
        key_summary_fields = {
            "strategy": safe_summary.get("strategy"),
            "risk_level": safe_summary.get("risk_level"),
            "avg_risk_score": safe_summary.get("avg_risk_score"),
            "risk_score_std": safe_summary.get("risk_score_std"),
            "risk_score_uniform": safe_summary.get("risk_score_uniform"),
            "loss_probability_30d": safe_summary.get("loss_probability_30d"),
            "regime": safe_summary.get("regime"),
            "highest_risk": {
                k: safe_summary.get("highest_risk", {}).get(k)
                for k in ("symbol", "riskScore", "volatility_30d", "sharpe_ratio", "var_95")
            },
            "lowest_risk": {
                k: safe_summary.get("lowest_risk", {}).get(k)
                for k in ("symbol", "riskScore", "volatility_30d", "sharpe_ratio")
            },
            "quant_coverage": safe_summary.get("quant_coverage"),
        }
        reasoning_prompt = (
            f"Investment theme: \"{safe_summary.get('strategy', '')}\"\n\n"
            f"Per-ticker quant snapshot:\n" + "\n".join(ticker_rows) + "\n\n"
            f"Key portfolio metrics:\n{json.dumps(key_summary_fields, indent=2)}"
        )

        reasoning_response, reasoning_model = _call_groq_with_fallback(
            reasoning_system_prompt,
            reasoning_prompt,
            models=[GROQ_DEEP_MODEL, narrative_model or GROQ_BASE_MODEL],
            temperature=0.2,
            max_tokens=1200
        )
        reasoning = reasoning_response.strip() if reasoning_response else _fallback_reasoning(summary)

    return narrative, reasoning, reasoning_model or narrative_model


async def generate_watchlist(
    prompt: str,
    deep_research: bool = False,
    user_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    Full pipeline: Generate a watchlist from natural language prompt.
    
    Steps:
    1. Router: Extract intent
    2. Generator: Get candidate tickers
    3. Validator: Check tickers exist
    4. Filter: Quality gate
    5. Quant: Real risk analysis
    6. Narrator: Generate summary
    """
    # Step 1: Extract intent
    safe_prompt = _sanitize_prompt(prompt)
    intent = extract_intent(safe_prompt)
    
    # Step 2: Generate candidates
    candidates = generate_candidates(intent)
    
    # Step 3: Validate tickers
    valid = validate_tickers(candidates)
    
    # Step 4: Filter quality
    filtered = filter_tickers(
        valid,
        min_market_cap=WATCHLIST_MIN_MARKET_CAP,
        min_volume=WATCHLIST_MIN_VOLUME,
        max_tickers=WATCHLIST_MAX_TICKERS
    )
    
    if not filtered:
        return {
            "watchlistName": "No Results",
            "narrative": "Unable to find valid tickers matching your criteria. Try a different strategy.",
            "reasoning": None,
            "model": None,
            "deepResearch": deep_research,
            "citations": [],
            "tickerExplanations": [],
            "tickers": [],
            "meta": {
                "constraints": {
                    "min_market_cap": WATCHLIST_MIN_MARKET_CAP,
                    "min_volume": WATCHLIST_MIN_VOLUME,
                    "max_tickers": WATCHLIST_MAX_TICKERS
                }
            }
        }
    
    # Step 5: Run quant analysis
    ticker_symbols = [t["symbol"] for t in filtered]
    quant_data = run_quant_analysis(ticker_symbols)
    
    # Step 6: Compose results
    results = compose_results(filtered, quant_data)
    ticker_explanations = build_ticker_explanations(
        results,
        theme=intent.theme or intent.sector or safe_prompt,
    )

    # Step 7: Build summary and deep-research context (LlamaIndex RAG)
    summary = _build_summary(results, intent, quant_data)
    rag_context_chunks, rag_citations = _ingest_and_retrieve_rag_context(
        prompt=safe_prompt,
        user_id=user_id,
        deep_research=deep_research,
        intent=intent,
        summary=summary,
        quant_data=quant_data,
        results=results
    )
    
    # Step 8: Generate narrative
    narrative, reasoning, model_used = generate_narrative(
        results,
        intent,
        quant_data,
        deep_research=deep_research,
        summary=summary,
        rag_context_chunks=rag_context_chunks
    )
    
    # Build watchlist name — use original prompt for theme, actual quant score for risk label
    theme_label = prompt.strip().title() if prompt.strip() else (intent.theme or intent.sector or "Strategy")
    avg_risk_score = summary.get("avg_risk_score", 0)
    if avg_risk_score > 60:
        computed_risk_label = "High Risk"
    elif avg_risk_score > 35:
        computed_risk_label = "Moderate Risk"
    else:
        computed_risk_label = "Lower Risk"
    watchlist_name = f"{theme_label} — {computed_risk_label}"
    
    return {
        "watchlistName": watchlist_name,
        "narrative": narrative,
        "reasoning": reasoning,
        "model": model_used,
        "deepResearch": deep_research,
        "citations": rag_citations,
        "tickerExplanations": ticker_explanations,
        "tickers": results,
        "meta": {
            "intent": {
                "sector": intent.sector,
                "risk_level": intent.risk_level,
                "theme": intent.theme
            },
            "regime": quant_data.get("regime", {}),
            "simulation": quant_data.get("simulation", {}),
            "constraints": {
                "min_market_cap": WATCHLIST_MIN_MARKET_CAP,
                "min_volume": WATCHLIST_MIN_VOLUME,
                "max_tickers": WATCHLIST_MAX_TICKERS
            },
            "rag": {
                "enabled": deep_research,
                "context_hits": len(rag_citations)
            }
        }
    }
