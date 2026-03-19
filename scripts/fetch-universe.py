#!/usr/bin/env python3
"""
Discover all US-listed stocks with market cap >= $100M using yfinance screener.

Usage:
    python fetch-universe.py [--min-cap 100000000]

Output:
    ui/public/stock-universe.json
"""

import json
import sys
import argparse
from datetime import datetime, timezone
from pathlib import Path

import yfinance as yf
from yfinance import EquityQuery

SCRIPT_DIR = Path(__file__).parent
OUTPUT_FILE = (SCRIPT_DIR / ".." / "ui" / "public" / "stock-universe.json").resolve()

# Index / ETF symbols always included for the market marquee
ANCHOR_SYMBOLS = ["^GSPC", "^IXIC", "^DJI", "^VIX", "^RUT", "QQQ"]

# Sector SPDR ETFs always included
SECTOR_ETFS = ["XLB", "XLC", "XLE", "XLF", "XLI", "XLK", "XLP", "XLRE", "XLU", "XLV", "XLY"]


def fetch_universe(min_market_cap: int) -> list[dict]:
    """Fetch all US stocks meeting market cap threshold via yfinance screener."""
    query = EquityQuery("and", [
        EquityQuery("is-in", ["exchange", "NMS", "NYQ", "NGM", "NCM", "ASE", "PCX", "BTS"]),
        EquityQuery("gte", ["intradaymarketcap", min_market_cap]),
    ])

    all_stocks = []
    offset = 0
    page_size = 250

    print(f"Fetching US stocks with market cap >= ${min_market_cap:,.0f}...")

    while True:
        try:
            result = yf.screen(query, offset=offset, size=page_size)
        except Exception as e:
            print(f"  Error at offset {offset}: {e}")
            break

        quotes = result.get("quotes", [])
        if not quotes:
            break

        for q in quotes:
            symbol = q.get("symbol", "")
            if not symbol:
                continue
            all_stocks.append({
                "symbol": symbol,
                "name": q.get("shortName") or q.get("longName") or "",
                "market_cap": q.get("marketCap"),
                "exchange": q.get("exchange", ""),
            })

        print(f"  Fetched {len(all_stocks)} stocks so far (offset={offset})...")

        if len(quotes) < page_size:
            break

        offset += page_size

    print(f"Total stocks found: {len(all_stocks)}")
    return all_stocks


def main():
    parser = argparse.ArgumentParser(description="Discover US stock universe")
    parser.add_argument(
        "--min-cap",
        type=int,
        default=100_000_000,
        help="Minimum market cap in USD (default: 100000000 = $100M)",
    )
    args = parser.parse_args()

    stocks = fetch_universe(args.min_cap)

    if not stocks:
        print("No stocks found!")
        sys.exit(1)

    # Build output: keyed by symbol for easy lookup
    symbols = {}
    for s in stocks:
        symbols[s["symbol"]] = {
            "name": s["name"],
            "market_cap": s["market_cap"],
            "exchange": s["exchange"],
        }

    # Add anchors and ETFs (they won't have market_cap from screener but that's fine)
    for sym in ANCHOR_SYMBOLS + SECTOR_ETFS:
        if sym not in symbols:
            symbols[sym] = {"name": sym, "market_cap": None, "exchange": ""}

    payload = {
        "metadata": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "total_symbols": len(symbols),
            "min_market_cap": args.min_cap,
            "source": "yfinance_screener",
        },
        "symbols": symbols,
    }

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_FILE, "w") as f:
        json.dump(payload, f, indent=2, sort_keys=True)

    print(f"\nSaved {len(symbols)} symbols to {OUTPUT_FILE}")
    size_kb = OUTPUT_FILE.stat().st_size / 1024
    print(f"File size: {size_kb:.1f} KB")


if __name__ == "__main__":
    main()
