"use client";
import { devConsole } from "@/lib/devLog";

import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

export interface SentimentSummary {
  model?: string;
  label: string;
  positive: number;
  negative: number;
  neutral: number;
}

export interface StockSentimentResponse {
  ticker: string;
  news_sentiment: SentimentSummary;
}

interface SentimentOptions {
  enabled?: boolean;
}

const CACHE_TTL = 2 * 60 * 60 * 1000;

async function fetchSentiment(ticker: string, signal?: AbortSignal): Promise<StockSentimentResponse | null> {
  const symbol = ticker.toUpperCase();
  try {
    const response = await authFetch(`${API_URL}/stocks/${symbol}/sentiment`, { signal });
    if (!response.ok) {
      devConsole.warn(`Sentiment unavailable for ${symbol}:`, response.status);
      return null;
    }
    return (await response.json()) as StockSentimentResponse;
  } catch (error) {
    if (!(error instanceof Error && error.name === "AbortError")) {
      devConsole.error("Failed to load sentiment:", error);
    }
    return null;
  }
}

export function useStockSentiment(ticker?: string, options: SentimentOptions = {}) {
  const { enabled = true } = options;
  const symbol = ticker?.toUpperCase() ?? "";
  const query = useQuery({
    queryKey: ["stockSentiment", symbol],
    enabled: Boolean(symbol) && enabled,
    queryFn: ({ signal }) => fetchSentiment(symbol, signal),
    staleTime: CACHE_TTL,
    gcTime: CACHE_TTL,
  });

  const sentiment = query.data ?? null;
  const loading = query.isLoading;
  const error = query.error instanceof Error ? query.error.message : query.error ? "Failed to load sentiment" : null;

  return { sentiment, loading, error };
}
