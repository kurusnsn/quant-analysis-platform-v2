"use client";

import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

export interface StockAnalysis {
  ticker: string;
  calculatedAt: string;
  volatility: number;
  sharpe: number;
  var95: number;
  cvar95: number;
  narrative: string | null;
  relatedNewsCount: number;
  sentiment: string | null;
}

export interface DailyInsightsResponse {
  watchlistId: string;
  watchlistName: string;
  stockAnalyses: StockAnalysis[];
  watchlistNarrative: string | null;
  lastUpdated: string | null;
}

/**
 * Hook to fetch daily insights for a watchlist
 */
export function useDailyInsights(watchlistId: string) {
  const query = useQuery({
    queryKey: ["dailyInsights", watchlistId],
    enabled: Boolean(watchlistId),
    queryFn: async ({ signal }) => {
      const response = await authFetch(`${API_URL}/analysis/watchlist/${watchlistId}/daily`, { signal });
      if (!response.ok) {
        throw new Error(`Failed to fetch insights: ${response.statusText}`);
      }
      return (await response.json()) as DailyInsightsResponse;
    },
  });

  const insights = query.data ?? null;
  const loading = query.isLoading;
  const error = query.error instanceof Error ? query.error.message : query.error ? "Failed to fetch insights" : null;

  return { insights, loading, error };
}
