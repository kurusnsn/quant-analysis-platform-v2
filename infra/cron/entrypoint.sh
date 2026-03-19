#!/bin/bash
set -e

STOCK_DATA=/app/ui/public

echo "[cron] Setting up stock data directory..."
mkdir -p "$STOCK_DATA"

# Seed initial data files if not present (first deploy or fresh volume)
for f in stock-universe.json stock-logos.json stock-metadata.json stock-prices.json index-quotes.json; do
    if [ ! -f "$STOCK_DATA/$f" ]; then
        echo "[cron] Seeding initial $f from image..."
        cp "/app/seed-data/$f" "$STOCK_DATA/$f"
    fi
done

# Keep live stock logos in sync with image seed additions.
# This preserves existing logos while backfilling new symbols (e.g. ARM/TSM)
# into already-initialized volumes.
echo "[cron] Backfilling missing stock logos from image seed..."
python3 - <<'PY'
import json
from pathlib import Path

seed_file = Path("/app/seed-data/stock-logos.json")
live_file = Path("/app/ui/public/stock-logos.json")

if seed_file.exists() and live_file.exists():
    try:
        seed = json.loads(seed_file.read_text())
        live = json.loads(live_file.read_text())
        added = 0

        for symbol, payload in seed.items():
            if symbol not in live:
                live[symbol] = payload
                added += 1

        if added > 0:
            live_file.write_text(json.dumps(live, indent=2) + "\n")
            print(f"[cron] Added {added} missing logos to live stock-logos.json")
        else:
            print("[cron] Live stock-logos.json already contains all seeded symbols")
    except Exception as exc:
        print(f"[cron] Warning: logo backfill skipped due to error: {exc}")
else:
    print("[cron] Warning: seed or live stock-logos.json missing; skipping backfill")
PY

echo "[cron] Running initial index quote fetch..."
python3 /app/scripts/fetch-index-quotes.py || echo "[cron] Warning: initial index fetch failed, using seeded data"

echo "[cron] Running initial EOD price fetch (5d period for speed)..."
python3 /app/scripts/fetch-eod-prices.py --period 5d || echo "[cron] Warning: initial EOD fetch failed, using seeded data"

echo "[cron] Starting cron daemon..."
cron -f
