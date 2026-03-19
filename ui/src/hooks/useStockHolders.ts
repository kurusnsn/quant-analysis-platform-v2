"use client";
import { devConsole } from "@/lib/devLog";

import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";

export type HolderValue = number | string | null;

export interface HolderTableData {
  columns: string[];
  rows: Array<{
    label: string;
    values: HolderValue[];
  }>;
}

export interface StockHoldersResponse {
  ticker: string;
  source?: string;
  generated_at?: string;
  holders: {
    major: HolderTableData;
    institutional: HolderTableData;
    mutual_fund: HolderTableData;
  };
}

const CACHE_TTL = 24 * 60 * 60 * 1000;

async function fetchHolders(ticker: string, signal?: AbortSignal): Promise<StockHoldersResponse | null> {
  const symbol = ticker.toUpperCase();
  try {
    const response = await authFetch(`/api/stocks/${symbol}/holders`, { signal });
    if (!response.ok) {
      devConsole.warn(`Holders unavailable for ${symbol}:`, response.status);
      return null;
    }
    return (await response.json()) as StockHoldersResponse;
  } catch (error) {
    if (!(error instanceof Error && error.name === "AbortError")) {
      devConsole.error("Failed to load holders:", error);
    }
    return null;
  }
}

export function useStockHolders(ticker?: string) {
  const symbol = ticker?.toUpperCase() ?? "";
  const query = useQuery({
    queryKey: ["stockHolders", symbol],
    enabled: Boolean(symbol),
    queryFn: ({ signal }) => fetchHolders(symbol, signal),
    staleTime: CACHE_TTL,
    gcTime: CACHE_TTL,
  });

  const holders = query.data ?? null;
  const loading = query.isLoading;
  const error = query.error instanceof Error ? query.error.message : query.error ? "Failed to load holders" : null;

  return { holders, loading, error };
}
