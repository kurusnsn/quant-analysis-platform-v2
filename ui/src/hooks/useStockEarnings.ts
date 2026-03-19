"use client";
import { devConsole } from "@/lib/devLog";

import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";

export type EarningsValue = number | string | null;

export interface EarningsTableData {
  columns: string[];
  rows: Array<{
    label: string;
    values: EarningsValue[];
  }>;
}

export interface EarningsResponse {
  ticker: string;
  source?: string;
  generated_at?: string;
  calendar?: EarningsTableData;
  earnings_dates?: EarningsTableData;
}

interface EarningsOptions {
  enabled?: boolean;
}

const CACHE_TTL = 24 * 60 * 60 * 1000;

async function fetchEarnings(ticker: string, signal?: AbortSignal): Promise<EarningsResponse | null> {
  const symbol = ticker.toUpperCase();
  try {
    const response = await authFetch(`/api/stocks/${symbol}/earnings`, { signal });
    if (!response.ok) {
      devConsole.warn(`Earnings unavailable for ${symbol}:`, response.status);
      return null;
    }
    return (await response.json()) as EarningsResponse;
  } catch (error) {
    if (!(error instanceof Error && error.name === "AbortError")) {
      devConsole.error("Failed to load earnings:", error);
    }
    return null;
  }
}

export function useStockEarnings(ticker?: string, options: EarningsOptions = {}) {
  const { enabled = true } = options;
  const symbol = ticker?.toUpperCase() ?? "";
  const query = useQuery({
    queryKey: ["stockEarnings", symbol],
    enabled: Boolean(symbol) && enabled,
    queryFn: ({ signal }) => fetchEarnings(symbol, signal),
    staleTime: CACHE_TTL,
    gcTime: CACHE_TTL,
  });

  const earnings = query.data ?? null;
  const loading = query.isLoading;
  const error = query.error instanceof Error ? query.error.message : query.error ? "Failed to load earnings" : null;

  return { earnings, loading, error };
}
