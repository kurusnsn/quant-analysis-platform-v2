#!/usr/bin/env python3
"""
Fetch stock metadata (market cap + basic listing info) for the UI universe.

Universe source:
  ui/public/stock-logos.json (keys)

Output:
  ui/public/stock-metadata.json

Notes:
  - Uses yfinance (same upstream as stock-prices.json).
  - Intended to support dashboard filters (US-only, market cap thresholds).
"""

import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

import yfinance as yf

SCRIPT_DIR = Path(__file__).parent
UNIVERSE_FILE = (SCRIPT_DIR / ".." / "ui" / "public" / "stock-universe.json").resolve()
LOGOS_FILE = (SCRIPT_DIR / ".." / "ui" / "public" / "stock-logos.json").resolve()
OUTPUT_FILE = (SCRIPT_DIR / ".." / "ui" / "public" / "stock-metadata.json").resolve()


def _to_number(value: Any) -> Optional[float]:
    try:
        if value is None:
            return None
        if isinstance(value, bool):
            return None
        if isinstance(value, (int, float)):
            return float(value)
        s = str(value).strip().replace(",", "")
        if not s:
            return None
        return float(s)
    except Exception:
        return None


def _normalize_for_yfinance(ticker: str) -> str:
    # Yahoo uses "-" for share classes (e.g. BRK-B) but our UI uses dot (BRK.B).
    return ticker.replace(".", "-").upper().strip()


def _safe_info(ticker: str) -> Dict[str, Any]:
    stock = yf.Ticker(ticker)
    try:
        info = stock.info or {}
    except Exception:
        info = {}
    if not isinstance(info, dict):
        return {}
    return info


def main() -> int:
    # Prefer universe file, fall back to logos file
    if UNIVERSE_FILE.exists():
        with open(UNIVERSE_FILE, "r") as f:
            data = json.load(f) or {}
        source_keys = list((data.get("symbols") or {}).keys())
        source_name = str(UNIVERSE_FILE)
    elif LOGOS_FILE.exists():
        with open(LOGOS_FILE, "r") as f:
            data = json.load(f) or {}
        source_keys = list(data.keys())
        source_name = str(LOGOS_FILE)
    else:
        raise SystemExit(f"Missing universe or logos file")

    tickers = sorted([str(k).upper().strip() for k in source_keys if str(k).strip()])
    print(f"Loaded {len(tickers)} tickers from {source_name}")

    stocks: Dict[str, Dict[str, Any]] = {}
    errors: Dict[str, str] = {}

    for i, raw in enumerate(tickers, start=1):
        yf_ticker = _normalize_for_yfinance(raw)
        print(f"[{i}/{len(tickers)}] {raw} (yfinance: {yf_ticker})")
        try:
            info = _safe_info(yf_ticker)
            market_cap = _to_number(info.get("marketCap"))

            stocks[raw] = {
                "market_cap": int(market_cap) if market_cap is not None else None,
                "country": info.get("country"),
                "sector": info.get("sector"),
                "industry": info.get("industry"),
                "exchange": info.get("exchange"),
                "quote_type": info.get("quoteType"),
                "currency": info.get("currency") or info.get("financialCurrency"),
                "short_name": info.get("shortName"),
                "long_name": info.get("longName"),
                "yf_ticker": yf_ticker,
            }
        except Exception as e:
            errors[raw] = str(e)

        # Be polite to Yahoo; fast enough locally, avoids getting throttled.
        time.sleep(0.15)

    payload = {
        "metadata": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "total_symbols": len(stocks),
            "source": "yfinance",
            "universe_source": source_name,
        },
        "stocks": stocks,
        "errors": errors,
    }

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_FILE, "w") as f:
        json.dump(payload, f, indent=2, sort_keys=True)

    print(f"\nSaved metadata for {len(stocks)} symbols to {OUTPUT_FILE}")
    if errors:
        print(f"Errors for {len(errors)} symbols (kept in file under `errors`).")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

