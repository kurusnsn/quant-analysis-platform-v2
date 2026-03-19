import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/stocks/{ticker}/chart?range=1d&interval=15m
 *
 * Proxies Yahoo Finance v8 chart API with server-side caching.
 * No auth required — chart data is public.
 */

const VALID_INTERVALS = new Set(["15m", "1h", "1d", "1wk", "1mo"]);
const VALID_RANGES = new Set([
  "1d", "5d", "1mo", "3mo", "6mo", "ytd", "1y", "2y", "5y", "10y", "max",
]);

// Cache TTLs per interval (ms)
const CACHE_TTL: Record<string, number> = {
  "15m": 2 * 60 * 1000,
  "1h": 5 * 60 * 1000,
  "1d": 15 * 60 * 1000,
  "1wk": 60 * 60 * 1000,
  "1mo": 6 * 60 * 60 * 1000,
};

interface CacheEntry {
  data: ChartDataPoint[];
  expiresAt: number;
}

interface ChartDataPoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const cache = new Map<string, CacheEntry>();

// Evict expired entries periodically to prevent memory leaks
let lastEviction = 0;
function evictStale() {
  const now = Date.now();
  if (now - lastEviction < 60_000) return; // at most once per minute
  lastEviction = now;
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
}

function formatDate(
  ts: number,
  interval: string,
  range: string,
): string {
  const d = new Date(ts * 1000);

  if (interval === "15m") {
    const time = d.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "America/New_York",
    });
    if (range === "1d") return time;
    const date = d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "America/New_York",
    });
    return `${date} ${time}`;
  }

  if (interval === "1h") {
    const date = d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "America/New_York",
    });
    const time = d.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "America/New_York",
    });
    return `${date} ${time}`;
  }

  if (interval === "1mo") {
    return d.toLocaleDateString("en-US", {
      month: "short",
      year: "numeric",
      timeZone: "America/New_York",
    });
  }

  // 1d, 1wk
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });
}

async function fetchYahooChart(
  ticker: string,
  range: string,
  interval: string,
): Promise<ChartDataPoint[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=${range}&interval=${interval}&includePrePost=false`;

  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Yahoo Finance returned ${res.status}`);
  }

  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error("No chart data in Yahoo response");

  const timestamps: number[] = result.timestamp ?? [];
  const quote = result.indicators?.quote?.[0];
  if (!quote || !timestamps.length) return [];

  const opens: (number | null)[] = quote.open ?? [];
  const highs: (number | null)[] = quote.high ?? [];
  const lows: (number | null)[] = quote.low ?? [];
  const closes: (number | null)[] = quote.close ?? [];
  const volumes: (number | null)[] = quote.volume ?? [];

  const points: ChartDataPoint[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const o = opens[i];
    const h = highs[i];
    const l = lows[i];
    const c = closes[i];
    const v = volumes[i];

    // Skip entries with null values (gaps, pre/post market)
    if (o == null || h == null || l == null || c == null) continue;

    points.push({
      date: formatDate(timestamps[i], interval, range),
      open: Math.round(o * 100) / 100,
      high: Math.round(h * 100) / 100,
      low: Math.round(l * 100) / 100,
      close: Math.round(c * 100) / 100,
      volume: v ?? 0,
    });
  }

  return points;
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ ticker: string }> },
) {
  const { ticker } = await context.params;
  if (!ticker) {
    return NextResponse.json({ error: "Ticker is required" }, { status: 400 });
  }

  const { searchParams } = req.nextUrl;
  const range = searchParams.get("range") ?? "1y";
  const interval = searchParams.get("interval") ?? "1d";

  if (!VALID_RANGES.has(range)) {
    return NextResponse.json({ error: `Invalid range: ${range}` }, { status: 400 });
  }
  if (!VALID_INTERVALS.has(interval)) {
    return NextResponse.json({ error: `Invalid interval: ${interval}` }, { status: 400 });
  }

  const upperTicker = ticker.toUpperCase();
  const cacheKey = `${upperTicker}:${range}:${interval}`;

  evictStale();

  // Check cache
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(
      { ticker: upperTicker, interval, range, data: cached.data },
      { headers: { "X-Cache": "HIT" } },
    );
  }

  try {
    const data = await fetchYahooChart(upperTicker, range, interval);

    const ttl = CACHE_TTL[interval] ?? 15 * 60 * 1000;
    cache.set(cacheKey, { data, expiresAt: Date.now() + ttl });

    return NextResponse.json(
      { ticker: upperTicker, interval, range, data },
      {
        headers: {
          "X-Cache": "MISS",
          "Cache-Control": `public, s-maxage=${Math.floor(ttl / 1000)}, stale-while-revalidate=60`,
        },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Failed to fetch chart data", details: message },
      { status: 502 },
    );
  }
}
