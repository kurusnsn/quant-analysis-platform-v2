"use server";
import { devConsole } from "@/lib/devLog";

// In-memory cache for server-side (resets on deploy, but persists across requests)
const logoCache = new Map<string, { url: string | null; timestamp: number }>();
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days - logos rarely change

export interface CompanyBranding {
  iconUrl: string | null;
  logoUrl: string | null;
}

export interface TickerDetails {
  ticker: string;
  name: string;
  market: string;
  locale: string;
  description: string | null;
  homepageUrl: string | null;
  branding: CompanyBranding;
}

export interface TickerSearchResult {
  ticker: string;
  name: string;
  market: string;
  locale: string;
  primary_exchange?: string;
}

function normalizeDomain(urlOrHost: string | null | undefined): string | null {
  if (!urlOrHost || typeof urlOrHost !== "string") return null;
  const raw = urlOrHost.trim();
  if (!raw) return null;

  try {
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const parsed = new URL(withProtocol);
    const host = parsed.hostname.replace(/^www\./i, "");
    return host || null;
  } catch {
    return null;
  }
}

async function getWebsiteFavicon(ticker: string): Promise<string | null> {
  try {
    const response = await fetch(`/api/stocks/${ticker}/profile`);
    if (!response.ok) return null;

    const data = (await response.json()) as {
      website?: string | null;
      homepageUrl?: string | null;
      homepage_url?: string | null;
    };

    const domain = normalizeDomain(
      data.website ?? data.homepageUrl ?? data.homepage_url ?? null
    );
    if (!domain) return null;

    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;
  } catch {
    return null;
  }
}

/**
 * Search for tickers using internal API (which proxies to Massive and caches)
 */
export async function searchTickers(query: string): Promise<TickerSearchResult[]> {
  if (!query || query.length < 1) return [];

  try {
    const response = await fetch(
      `/api/tickers/search?q=${encodeURIComponent(query)}`,
      {
        headers: {
          "Accept": "application/json",
        }
      }
    );

    if (!response.ok) {
      devConsole.error(`Internal ticker search error:`, response.status);
      return [];
    }

    return await response.json();
  } catch (error) {
    devConsole.error(`Failed to search tickers for ${query}:`, error);
    return [];
  }
}

/**
 * Fetch ticker details from internal API
 */
export async function getTickerDetails(ticker: string): Promise<any> {
  // This is replaced by specific logo/metadata routes in the backend
  // but keeping signature for compatibility if needed elsewhere
  return null;
}

/**
 * Get company logo URL with caching
 * Returns icon_url (smaller, better for lists) or logo_url as fallback
 */
export async function getCompanyLogo(ticker: string): Promise<string | null> {
  const upperTicker = ticker.toUpperCase();

  // Check cache first
  const cached = logoCache.get(upperTicker);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.url;
  }

  try {
    const response = await fetch(`/api/tickers/${upperTicker}/logo`);
    if (!response.ok) {
      const fallbackLogo = await getWebsiteFavicon(upperTicker);
      logoCache.set(upperTicker, { url: fallbackLogo, timestamp: Date.now() });
      return fallbackLogo;
    }

    const data = await response.json();
    let logoUrl = data.iconUrl || data.logoUrl || null;
    if (!logoUrl) {
      logoUrl = await getWebsiteFavicon(upperTicker);
    }

    // Cache the result (even if null to avoid repeated failed requests)
    logoCache.set(upperTicker, { url: logoUrl, timestamp: Date.now() });

    return logoUrl;
  } catch (error) {
    devConsole.error(`Error fetching logo for ${upperTicker}:`, error);
    return null;
  }
}

/**
 * Batch fetch logos for multiple tickers
 * Processes sequentially to respect rate limits (5 req/min on free tier)
 * Uses cache to minimize API calls
 */
export async function getCompanyLogos(tickers: string[]): Promise<Record<string, string | null>> {
  const results: Record<string, string | null> = {};
  const tickersToFetch: string[] = [];

  // Check cache first for all tickers
  for (const ticker of tickers) {
    const upperTicker = ticker.toUpperCase();
    const cached = logoCache.get(upperTicker);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      results[upperTicker] = cached.url;
    } else {
      tickersToFetch.push(upperTicker);
    }
  }

  // Fetch uncached tickers with delay to respect rate limits
  for (let i = 0; i < tickersToFetch.length; i++) {
    const ticker = tickersToFetch[i];

    // Add delay between requests (12 seconds = 5 req/min)
    if (i > 0) {
      await new Promise(resolve => setTimeout(resolve, 12000));
    }

    results[ticker] = await getCompanyLogo(ticker);
  }

  return results;
}
