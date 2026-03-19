#!/usr/bin/env python3
"""
Fetch End-of-Day OHLCV price data for all stocks with logos
Uses yfinance - no rate limits, free forever

Usage:
    python fetch-eod-prices.py [--period 1y]

Output:
    ui/public/stock-prices.json
"""

import json
import sys
from pathlib import Path
from datetime import datetime
import yfinance as yf
import argparse

# Paths
SCRIPT_DIR = Path(__file__).parent
UNIVERSE_FILE = SCRIPT_DIR / ".." / "ui" / "public" / "stock-universe.json"
LOGOS_FILE = SCRIPT_DIR / ".." / "ui" / "public" / "stock-logos.json"
OUTPUT_FILE = SCRIPT_DIR / ".." / "ui" / "public" / "stock-prices.json"


# Index / ETF symbols always included for the market marquee
ANCHOR_SYMBOLS = ["^GSPC", "^IXIC", "QQQ"]


def load_stock_symbols():
    """Load stock symbols from universe file (preferred) or logo file (fallback), plus index anchors"""
    if UNIVERSE_FILE.exists():
        with open(UNIVERSE_FILE, 'r') as f:
            data = json.load(f)
        symbols = list(data.get('symbols', {}).keys())
        print(f"📋 Using universe file ({len(symbols)} symbols)")
    elif LOGOS_FILE.exists():
        with open(LOGOS_FILE, 'r') as f:
            logos = json.load(f)
        symbols = list(logos.keys())
        print(f"📋 Falling back to logos file ({len(symbols)} symbols)")
    else:
        print("❌ No universe or logos file found!")
        sys.exit(1)

    for s in ANCHOR_SYMBOLS:
        if s not in symbols:
            symbols.append(s)
    return symbols


def fetch_prices(symbols, period='1y'):
    """
    Fetch OHLCV data for all symbols

    Args:
        symbols: List of ticker symbols
        period: Time period (1d, 5d, 1mo, 3mo, 6mo, 1y, 2y, 5y, 10y, ytd, max)

    Returns:
        Dict with structure:
        {
            "AAPL": {
                "2024-01-01": {"open": 123.45, "high": 124.50, "low": 122.00, "close": 123.80, "volume": 50000000},
                ...
            }
        }
    """
    print(f"\n📊 Fetching {period} of price data for {len(symbols)} stocks...")
    print("⏳ This will take ~10-20 seconds...\n")

    # Download all tickers at once (yfinance batches automatically)
    data = yf.download(
        tickers=symbols,
        period=period,
        group_by='ticker',
        auto_adjust=True,  # Use adjusted prices
        progress=True
    )

    # Convert to our format
    result = {}

    for symbol in symbols:
        try:
            # Handle single vs multi-ticker response structure
            if len(symbols) == 1:
                ticker_data = data
            else:
                ticker_data = data[symbol]

            # Skip if no data
            if ticker_data.empty:
                print(f"  ⚠️  No data for {symbol}")
                continue

            # Convert DataFrame to dict
            symbol_prices = {}
            for date, row in ticker_data.iterrows():
                # Skip rows with NaN values
                if row.isna().any():
                    continue

                date_str = date.strftime('%Y-%m-%d')
                symbol_prices[date_str] = {
                    'open': round(float(row['Open']), 2),
                    'high': round(float(row['High']), 2),
                    'low': round(float(row['Low']), 2),
                    'close': round(float(row['Close']), 2),
                    'volume': int(row['Volume'])
                }

            if symbol_prices:
                result[symbol] = symbol_prices
                latest_date = max(symbol_prices.keys())
                latest_close = symbol_prices[latest_date]['close']
                print(f"  ✓ {symbol}: {len(symbol_prices)} days (latest: ${latest_close})")

        except Exception as e:
            print(f"  ❌ Error processing {symbol}: {e}")
            continue

    return result


def save_prices(prices):
    """Save prices to JSON file"""
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)

    # Add metadata
    output = {
        'metadata': {
            'generated_at': datetime.now().isoformat(),
            'total_symbols': len(prices),
            'source': 'yfinance'
        },
        'prices': prices
    }

    with open(OUTPUT_FILE, 'w') as f:
        json.dump(output, f, indent=2)

    print(f"\n✅ Saved price data to {OUTPUT_FILE}")

    # Print file size
    size_mb = OUTPUT_FILE.stat().st_size / (1024 * 1024)
    print(f"📦 File size: {size_mb:.2f} MB")


def main():
    parser = argparse.ArgumentParser(description='Fetch EOD price data for stocks')
    parser.add_argument('--period', default='1y',
                       help='Time period: 1d, 5d, 1mo, 3mo, 6mo, 1y, 2y, 5y, 10y, ytd, max')
    args = parser.parse_args()

    print("🚀 Starting EOD price fetch...")

    # Load symbols
    symbols = load_stock_symbols()
    print(f"📋 Loaded {len(symbols)} symbols from {LOGOS_FILE}")

    # Fetch prices
    prices = fetch_prices(symbols, period=args.period)

    if not prices:
        print("\n❌ No price data fetched!")
        sys.exit(1)

    # Save results
    save_prices(prices)

    print("\n🎉 Done!")
    print(f"📊 Successfully fetched data for {len(prices)}/{len(symbols)} stocks")


if __name__ == '__main__':
    main()
