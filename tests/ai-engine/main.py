from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import numpy as np
from transformers import AutoTokenizer, AutoModelForSequenceClassification
import torch
import os

from market_data import MarketDataProvider
from quant_models import (
    calculate_rolling_volatility,
    calculate_sharpe_ratio,
    calculate_var,
    calculate_cvar,
    monte_carlo_simulation,
    detect_regime
)

# OpenTelemetry Setup
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

otel_endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4317")
service_name = os.getenv("OTEL_SERVICE_NAME", "quant-platform-ai-engine")

resource = Resource.create({"service.name": service_name, "service.namespace": "quant-platform"})
provider = TracerProvider(resource=resource)
processor = BatchSpanProcessor(OTLPSpanExporter(endpoint=otel_endpoint, insecure=True))
provider.add_span_processor(processor)
trace.set_tracer_provider(provider)

app = FastAPI(title="QuantPlatform AI Engine")

# Instrument FastAPI
FastAPIInstrumentor.instrument_app(app)

# Initialize providers
market_data = MarketDataProvider()

# Load FinBERT at startup (News Sentiment)
print("Loading FinBERT model...")
tokenizer = AutoTokenizer.from_pretrained("ProsusAI/finbert")
model = AutoModelForSequenceClassification.from_pretrained("ProsusAI/finbert")
model.eval()
print("FinBERT loaded successfully!")

# Load RoBERTa at startup (Social Sentiment)
print("Loading RoBERTa model...")
roberta_tokenizer = AutoTokenizer.from_pretrained("cardiffnlp/twitter-roberta-base-sentiment-latest")
roberta_model = AutoModelForSequenceClassification.from_pretrained("cardiffnlp/twitter-roberta-base-sentiment-latest")
roberta_model.eval()
print("RoBERTa loaded successfully!")


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


# Social Sentiment (Reddit + RoBERTa)
from reddit_data import reddit_provider

class SocialSentimentRequest(BaseModel):
    ticker: str
    limit: int = 20

@app.post("/social/sentiment")
def get_social_sentiment(request: SocialSentimentRequest):
    """
    Get social sentiment from Reddit using RoBERTa model.
    Feature-flagged: requires REDDIT_CLIENT_ID/SECRET env vars.
    """
    mentions = reddit_provider.get_social_mentions(request.ticker, limit=request.limit)
    
    analyzed = []
    for mention in mentions:
        text = f"{mention.get('title', '')} {mention.get('text', '')}"[:512]
        
        if text.strip():
            inputs = roberta_tokenizer(text, return_tensors="pt", padding=True, truncation=True, max_length=512)
            with torch.no_grad():
                outputs = roberta_model(**inputs)
            
            probs = torch.nn.functional.softmax(outputs.logits, dim=-1)
            # RoBERTa labels: negative, neutral, positive
            labels = ["negative", "neutral", "positive"]
            scores = probs[0].tolist()
            
            mention["sentiment"] = {
                "label": labels[scores.index(max(scores))],
                "negative": round(scores[0], 4),
                "neutral": round(scores[1], 4),
                "positive": round(scores[2], 4),
                "model": "roberta"
            }
        analyzed.append(mention)
    
    # Calculate aggregate sentiment
    positive_count = sum(1 for m in analyzed if m.get("sentiment", {}).get("label") == "positive")
    negative_count = sum(1 for m in analyzed if m.get("sentiment", {}).get("label") == "negative")
    total = len(analyzed) or 1
    
    return {
        "ticker": request.ticker,
        "mentions": analyzed,
        "count": len(analyzed),
        "aggregate": {
            "positive_ratio": round(positive_count / total, 4),
            "negative_ratio": round(negative_count / total, 4),
            "bullish": positive_count > negative_count
        },
        "reddit_enabled": reddit_provider.enabled
    }


@app.post("/sentiment/compare")
def compare_sentiment(request: WatchlistRequest):
    """
    Compare News (FinBERT) vs Social (RoBERTa) sentiment for a ticker.
    Returns both scores for UI comparison bar.
    """
    if not request.tickers:
        raise HTTPException(status_code=400, detail="No tickers provided")
    
    ticker = request.tickers[0]
    
    # Get news headlines from yfinance
    news = market_data.get_news(ticker)
    news_texts = [n.get("title", "") for n in news if n.get("title")]
    
    # Get Reddit mentions
    mentions = reddit_provider.get_social_mentions(ticker, limit=10)
    social_texts = [f"{m.get('title', '')} {m.get('text', '')}"[:200] for m in mentions]
    
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
    
    # Analyze social with RoBERTa
    social_sentiment = {"positive": 0, "negative": 0, "neutral": 0}
    for text in social_texts[:10]:
        if text.strip():
            inputs = roberta_tokenizer(text, return_tensors="pt", padding=True, truncation=True, max_length=512)
            with torch.no_grad():
                outputs = roberta_model(**inputs)
            probs = torch.nn.functional.softmax(outputs.logits, dim=-1)
            scores = probs[0].tolist()
            social_sentiment["negative"] += scores[0]
            social_sentiment["neutral"] += scores[1]
            social_sentiment["positive"] += scores[2]
    
    m = len(social_texts[:10]) or 1
    social_sentiment = {k: round(v/m, 4) for k, v in social_sentiment.items()}
    
    return {
        "ticker": ticker,
        "news_sentiment": {
            "model": "finbert",
            **news_sentiment,
            "label": max(news_sentiment, key=news_sentiment.get)
        },
        "social_sentiment": {
            "model": "roberta",
            **social_sentiment,
            "label": max(social_sentiment, key=social_sentiment.get)
        },
        "reddit_enabled": reddit_provider.enabled
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
        # First get the risk analysis
        returns = market_data.get_returns(request.tickers)
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
            "tickers": request.tickers
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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5000)
