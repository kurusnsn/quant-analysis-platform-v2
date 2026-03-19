"use client";
import { devConsole } from "@/lib/devLog";

import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";

export interface FilingSentiment {
  label: "positive" | "negative" | "neutral";
  positive: number;
  negative: number;
  neutral: number;
}

export interface StockFiling {
  ticker: string;
  form: string;
  filing_date?: string | null;
  accession_number?: string | null;
  description?: string | null;
  url?: string | null;
  sentiment?: FilingSentiment;
}

export interface FilingsResponse {
  filings: StockFiling[];
  count: number;
}

interface FilingsOptions {
  types?: string[];
  analyze?: boolean;
  enabled?: boolean;
}

const CACHE_TTL = 6 * 60 * 60 * 1000;

async function fetchFilings(
  ticker: string,
  types: string[],
  analyze: boolean,
  signal?: AbortSignal
): Promise<FilingsResponse | null> {
  const symbol = ticker.toUpperCase();
  try {
    const typeParam = encodeURIComponent(types.join(","));
    const response = await authFetch(
      `/api/stocks/${symbol}/filings?types=${typeParam}&analyze=${analyze ? "true" : "false"}`,
      { signal }
    );
    if (!response.ok) {
      devConsole.warn(`Filings unavailable for ${symbol}:`, response.status);
      return null;
    }
    return (await response.json()) as FilingsResponse;
  } catch (error) {
    if (!(error instanceof Error && error.name === "AbortError")) {
      devConsole.error("Failed to load filings:", error);
    }
    return null;
  }
}

export function useStockFilings(ticker?: string, options: FilingsOptions = {}) {
  const { types = ["10-K", "10-Q", "8-K"], analyze = true, enabled = true } = options;
  const symbol = ticker?.toUpperCase() ?? "";
  const typeKey = types.join(",");

  const query = useQuery({
    queryKey: ["stockFilings", symbol, typeKey, analyze],
    enabled: Boolean(symbol) && enabled,
    queryFn: ({ signal }) => fetchFilings(symbol, types, analyze, signal),
    staleTime: CACHE_TTL,
    gcTime: CACHE_TTL,
  });

  const filings = query.data?.filings ?? [];
  const loading = query.isLoading;
  const error = query.error instanceof Error ? query.error.message : query.error ? "Failed to load filings" : null;

  return { filings, loading, error };
}
