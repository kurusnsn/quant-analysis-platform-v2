"use client";

import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { readApiErrorMessage } from "@/lib/apiError";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

export interface AssetAnalysisResponse {
  ticker: string;
  volatility: number;
  sharpe_ratio: number;
  var_95: number;
  cvar_95: number;
  regime: string;
}

/**
 * Hook to fetch analysis for a single asset
 */
export function useAssetAnalysis(ticker: string) {
  const query = useQuery({
    queryKey: ["assetAnalysis", ticker],
    enabled: Boolean(ticker),
    queryFn: async ({ signal }) => {
      const response = await authFetch(`${API_URL}/analysis/asset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tickers: [ticker] }),
        signal,
      });

      if (!response.ok) {
        const message = await readApiErrorMessage(
          response,
          `Failed to fetch analysis (${response.status}).`
        );
        throw new Error(message);
      }

      return (await response.json()) as AssetAnalysisResponse;
    },
  });

  const analysis = query.data ?? null;
  const loading = query.isLoading;
  const error = query.error instanceof Error ? query.error.message : query.error ? "Failed to fetch analysis" : null;

  return { analysis, loading, error };
}
