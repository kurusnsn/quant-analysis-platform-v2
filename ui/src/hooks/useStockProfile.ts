"use client";
import { devConsole } from "@/lib/devLog";

import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";

export interface StockProfile {
  ticker: string;
  name: string;
  description: string;
  sector: string;
  industry: string;
  exchange: string;
  website: string;
  country: string;
  employees: number | null;
  marketCap: number | null;
}

const CACHE_TTL = 24 * 60 * 60 * 1000;
const LS_PREFIX = "stockProfile:";

function readLocalCache(symbol: string): StockProfile | null {
  try {
    const raw = localStorage.getItem(`${LS_PREFIX}${symbol}`);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL) {
      localStorage.removeItem(`${LS_PREFIX}${symbol}`);
      return null;
    }
    return data as StockProfile;
  } catch {
    return null;
  }
}

function writeLocalCache(symbol: string, data: StockProfile) {
  try {
    localStorage.setItem(`${LS_PREFIX}${symbol}`, JSON.stringify({ data, ts: Date.now() }));
  } catch {
    // storage full – ignore
  }
}

async function fetchProfile(ticker: string, signal?: AbortSignal): Promise<StockProfile | null> {
  const symbol = ticker.toUpperCase();
  const cached = readLocalCache(symbol);

  try {
    const response = await authFetch(`/api/stocks/${symbol}/profile`, { signal });
    if (!response.ok) return cached;
    const profile = (await response.json()) as StockProfile;
    if (profile?.description) {
      writeLocalCache(symbol, profile);
    }
    return profile;
  } catch (error) {
    if (!(error instanceof Error && error.name === "AbortError")) {
      devConsole.error("Failed to load profile:", error);
    }
    return cached;
  }
}

export function useStockProfile(ticker?: string) {
  const symbol = ticker?.toUpperCase() ?? "";
  const cached = symbol ? readLocalCache(symbol) : null;
  const query = useQuery({
    queryKey: ["stockProfile", symbol],
    enabled: Boolean(symbol),
    queryFn: ({ signal }) => fetchProfile(symbol, signal),
    placeholderData: cached,
    staleTime: 5 * 60 * 1000,
    gcTime: CACHE_TTL,
  });

  return {
    profile: query.data ?? null,
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
  };
}
