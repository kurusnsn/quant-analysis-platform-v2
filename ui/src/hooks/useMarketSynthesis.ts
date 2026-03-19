"use client";

import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";

export interface MarketSynthesisResponse {
  synthesis: string;
  timestamp: string;
  key_stats: {
    sp500_change?: number;
    nasdaq_change?: number;
    dow_change?: number;
    vix?: number;
  };
  source: string;
}

/**
 * Hook to fetch AI-generated market synthesis
 */
export function useMarketSynthesis() {
  const query = useQuery({
    queryKey: ["marketSynthesis"],
    queryFn: async ({ signal }) => {
      const response = await authFetch("/api/market/synthesis", { signal });
      if (!response.ok) {
        throw new Error(`Failed to fetch synthesis: ${response.statusText}`);
      }
      return (await response.json()) as MarketSynthesisResponse;
    },
    staleTime: 60 * 1000,
  });

  const synthesis = query.data ?? null;
  const loading = query.isFetching;
  const error = query.error instanceof Error ? query.error.message : query.error ? "Failed to fetch synthesis" : null;

  return { synthesis, loading, error, refresh: query.refetch };
}
