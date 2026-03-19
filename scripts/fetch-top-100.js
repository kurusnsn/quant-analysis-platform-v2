/**
 * Quick test: Fetch logos for top 100 US stocks by market cap
 * Takes ~20 minutes instead of 16 hours
 */

import fetch from 'node-fetch';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadDotEnv(dotenvPath) {
  // Minimal .env loader (no interpolation). Does not override existing env.
  try {
    const raw = fsSync.readFileSync(dotenvPath, 'utf-8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx === -1) continue;
      const k = trimmed.slice(0, idx).trim();
      let v = trimmed.slice(idx + 1).trim();
      if (!k || process.env[k] !== undefined) continue;
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      process.env[k] = v;
    }
  } catch {
    // ok if missing
  }
}

loadDotEnv(path.join(__dirname, '..', '.env'));

const MASSIVE_API_KEY = process.env.MASSIVE_API_KEY;
if (!MASSIVE_API_KEY) {
  console.error('❌ MASSIVE_API_KEY not set. Add it to .env (repo root) and re-run.');
  process.exit(1);
}
const MASSIVE_BASE_URL = 'https://api.polygon.io';
const OUTPUT_FILE = path.join(__dirname, '..', 'ui', 'public', 'stock-logos.json');
const DELAY_MS = 12000; // 5 req/min

// Top 100 US stocks by market cap (manually curated list)
const TOP_100_SYMBOLS = [
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'BRK.B', 'UNH', 'XOM',
  'LLY', 'JPM', 'JNJ', 'V', 'PG', 'AVGO', 'MA', 'HD', 'CVX', 'MRK',
  'ABBV', 'COST', 'PEP', 'KO', 'ADBE', 'WMT', 'CRM', 'CSCO', 'ACN', 'MCD',
  'TMO', 'LIN', 'NFLX', 'AMD', 'ABT', 'DHR', 'NKE', 'VZ', 'TXN', 'DIS',
  'ORCL', 'CMCSA', 'PM', 'QCOM', 'WFC', 'INTC', 'UPS', 'COP', 'IBM', 'NEE',
  'BMY', 'RTX', 'INTU', 'UNP', 'HON', 'AMGN', 'BA', 'LOW', 'SPGI', 'DE',
  'CAT', 'GE', 'PLD', 'ELV', 'SBUX', 'GILD', 'BLK', 'MS', 'MDLZ', 'AXP',
  'ADI', 'SYK', 'ISRG', 'TJX', 'BKNG', 'ADP', 'MMC', 'VRTX', 'LRCX', 'PGR',
  'AMT', 'REGN', 'C', 'ZTS', 'CB', 'SO', 'CI', 'MO', 'SLB', 'DUK',
  'ETN', 'NOC', 'CME', 'BSX', 'EOG', 'GS', 'ITW', 'MMM', 'PNC', 'APD'
];

async function fetchTickerDetails(ticker) {
  const url = `${MASSIVE_BASE_URL}/v3/reference/tickers/${ticker}?apiKey=${MASSIVE_API_KEY}`;

  try {
    const response = await fetch(url);

    if (!response.ok) {
      console.error(`  ❌ Error fetching ${ticker}: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const results = data.results;

    if (!results || !results.branding) {
      return null;
    }

    return {
      ticker: results.ticker,
      name: results.name,
      iconUrl: results.branding.icon_url
        ? `${results.branding.icon_url}?apiKey=${MASSIVE_API_KEY}`
        : null,
      logoUrl: results.branding.logo_url
        ? `${results.branding.logo_url}?apiKey=${MASSIVE_API_KEY}`
        : null,
    };
  } catch (error) {
    console.error(`  ❌ Exception fetching ${ticker}:`, error.message);
    return null;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('🚀 Fetching logos for top 100 US stocks...\n');
  console.log(`⏱️  Estimated time: ~${Math.ceil((TOP_100_SYMBOLS.length * DELAY_MS) / 60000)} minutes\n`);

  const logos = {};

  for (let i = 0; i < TOP_100_SYMBOLS.length; i++) {
    const symbol = TOP_100_SYMBOLS[i];
    console.log(`[${i + 1}/${TOP_100_SYMBOLS.length}] Fetching ${symbol}...`);

    const details = await fetchTickerDetails(symbol);

    if (details && (details.iconUrl || details.logoUrl)) {
      logos[symbol] = {
        name: details.name,
        iconUrl: details.iconUrl,
        logoUrl: details.logoUrl,
      };
      console.log(`  ✓ Got logo for ${symbol}`);
    } else {
      console.log(`  - No logo for ${symbol}`);
    }

    if (i < TOP_100_SYMBOLS.length - 1) {
      await sleep(DELAY_MS);
    }
  }

  // Save results
  const publicDir = path.join(__dirname, '..', 'ui', 'public');
  await fs.mkdir(publicDir, { recursive: true });
  await fs.writeFile(OUTPUT_FILE, JSON.stringify(logos, null, 2));

  console.log(`\n✅ Saved ${Object.keys(logos).length} logos to ${OUTPUT_FILE}`);
  console.log('🎉 Done!');
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
