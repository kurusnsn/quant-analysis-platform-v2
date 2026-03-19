#!/usr/bin/env python3
"""
Fetch live index/ETF quotes via yfinance.
Designed to run as a cron job every 15 minutes.

Usage:
    python fetch-index-quotes.py

Output:
    ui/public/index-quotes.json

Cron example (every 15 min, market hours Mon-Fri 9:30-16:00 ET):
    */15 9-16 * * 1-5 cd /root/quant-platform-work && python3 scripts/fetch-index-quotes.py
"""

import json
import sys
from pathlib import Path
from datetime import datetime

import yfinance as yf

SCRIPT_DIR = Path(__file__).parent
OUTPUT_FILE = SCRIPT_DIR / ".." / "ui" / "public" / "index-quotes.json"

SYMBOLS = {
    "^GSPC":  "S&P 500",
    "^IXIC":  "NASDAQ",
    "^VIX":   "VIX",
    "QQQ":    "QQQ",
    "^DJI":   "Dow Jones",
    "^RUT":   "Russell 2000",
}


def fetch_quotes():
    tickers = list(SYMBOLS.keys())
    print(f"Fetching quotes for {tickers} ...")

    data = yf.download(
        tickers=tickers,
        period="5d",
        interval="1d",
        group_by="ticker",
        auto_adjust=True,
        progress=False,
    )

    quotes = []
    for symbol, label in SYMBOLS.items():
        try:
            if len(tickers) == 1:
                df = data
            else:
                df = data[symbol]

            df = df.dropna(subset=["Close"])
            if len(df) < 2:
                print(f"  skip {symbol}: not enough data")
                continue

            latest = df.iloc[-1]
            prev = df.iloc[-2]
            price = round(float(latest["Close"]), 2)
            prev_close = round(float(prev["Close"]), 2)

            if prev_close == 0:
                continue

            change_pct = round(((price - prev_close) / prev_close) * 100, 2)

            quotes.append({
                "symbol": symbol,
                "label": label,
                "price": price,
                "previousClose": prev_close,
                "changePct": change_pct,
            })
            print(f"  {label} ({symbol}): ${price}  {change_pct:+.2f}%")

        except Exception as e:
            print(f"  error {symbol}: {e}")
            continue

    return quotes


def main():
    quotes = fetch_quotes()

    if not quotes:
        print("No quotes fetched, keeping existing file.")
        sys.exit(1)

    output = {
        "updatedAt": datetime.utcnow().isoformat() + "Z",
        "quotes": quotes,
    }

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_FILE, "w") as f:
        json.dump(output, f, indent=2)

    print(f"\nWrote {len(quotes)} quotes to {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
