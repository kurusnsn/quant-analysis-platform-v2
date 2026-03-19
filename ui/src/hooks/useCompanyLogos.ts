"use client";
import { devConsole } from "@/lib/devLog";

import { useState, useEffect, useCallback } from "react";
import { getCompanyLogo } from "../services/massiveService";

// Client-side localStorage cache
const CACHE_KEY = "quant-platform_company_logos";
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
const NULL_CACHE_TTL = 6 * 60 * 60 * 1000; // retry missing logos more often
const PRELOAD_RETRY_AFTER_MS = 60 * 1000;

// Pre-fetched logos (loaded from static JSON if available)
let preloadedLogos: Record<string, { iconUrl: string | null; logoUrl: string | null }> | null = null;
let preloadFailedAt = 0;

async function loadPreloadedLogos() {
  if (preloadedLogos !== null) return preloadedLogos;
  if (preloadFailedAt > 0 && Date.now() - preloadFailedAt < PRELOAD_RETRY_AFTER_MS) {
    return {};
  }

  try {
    const response = await fetch('/stock-logos.json');
    if (response.ok) {
      const data = await response.json();
      const logos = data || {};
      preloadedLogos = logos;
      preloadFailedAt = 0;
      return logos;
    }
  } catch (error) {
    // No pre-fetched logos available, will fetch on demand
  }

  preloadFailedAt = Date.now();
  return {};
}

interface CachedLogo {
  url: string | null;
  timestamp: number;
}

function getFromLocalStorage(): Record<string, CachedLogo> {
  if (typeof window === "undefined") return {};
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    return cached ? JSON.parse(cached) : {};
  } catch {
    return {};
  }
}

function saveToLocalStorage(cache: Record<string, CachedLogo>) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // localStorage full or unavailable
  }
}

/**
 * Hook to progressively load company logos
 * Uses localStorage caching + rate-limit-aware fetching
 */
export function useCompanyLogos(symbols: string[]) {
  const [logos, setLogos] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!symbols.length) {
      setLoading(false);
      return;
    }

    const loadLogos = async () => {
      const cache = getFromLocalStorage();
      const preloaded = await loadPreloadedLogos();
      const result: Record<string, string | null> = {};
      const toFetch: string[] = [];

      // Check cache and preloaded data first
      for (const symbol of symbols) {
        const upper = symbol.toUpperCase();
        const cached = cache[upper];
        const cachedAgeMs = cached ? Date.now() - cached.timestamp : Number.POSITIVE_INFINITY;
        const cachedHasLogo = typeof cached?.url === "string" && cached.url.length > 0;

        // 1. Keep fresh positive cache entries.
        if (cachedHasLogo && cachedAgeMs < CACHE_TTL) {
          result[upper] = cached!.url;
          continue;
        }

        // 2. Prefer preloaded static logos over stale or null cache entries.
        if (preloaded && preloaded[upper]) {
          const logoUrl = preloaded[upper].iconUrl || preloaded[upper].logoUrl || null;
          if (logoUrl) {
            result[upper] = logoUrl;

            // Save to localStorage for future
            const currentCache = getFromLocalStorage();
            currentCache[upper] = { url: logoUrl, timestamp: Date.now() };
            saveToLocalStorage(currentCache);
            continue;
          }
        }

        // 3. Respect short-lived null cache only when we have no preloaded logo.
        if (cached && !cachedHasLogo && cachedAgeMs < NULL_CACHE_TTL) {
          result[upper] = null;
          continue;
        }

        // 4. Need to fetch from API
        toFetch.push(upper);
      }

      // Set cached/preloaded results immediately
      setLogos(result);

      // Fetch uncached logos progressively in small batches.
      const BATCH_SIZE = 3;
      const BATCH_DELAY_MS = 500;
      for (let i = 0; i < toFetch.length; i += BATCH_SIZE) {
        const batch = toFetch.slice(i, i + BATCH_SIZE);
        await Promise.all(
          batch.map(async (symbol) => {
            try {
              const logoUrl = await getCompanyLogo(symbol);

              // Update state
              setLogos((prev) => ({ ...prev, [symbol]: logoUrl }));

              // Update localStorage cache
              const currentCache = getFromLocalStorage();
              currentCache[symbol] = { url: logoUrl, timestamp: Date.now() };
              saveToLocalStorage(currentCache);
            } catch (error) {
              devConsole.error(`Failed to fetch logo for ${symbol}:`, error);
            }
          })
        );

        if (i + BATCH_SIZE < toFetch.length) {
          await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
        }
      }

      setLoading(false);
    };

    loadLogos();
  }, [symbols.join(",")]); // Re-run if symbols change

  const getLogo = useCallback(
    (symbol: string): string | null => {
      return logos[symbol.toUpperCase()] ?? null;
    },
    [logos]
  );

  return { logos, getLogo, loading };
}
