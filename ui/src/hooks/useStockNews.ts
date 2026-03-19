"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";

export interface NewsArticle {
  title: string;
  publisher: string;
  link: string;
  providerPublishTime?: number | string;
  type?: string;
  thumbnail?: string | null;
}

export interface StockNewsResponse {
  ticker: string;
  news: NewsArticle[];
  count: number;
  source: string;
  cached_hours: number;
}

export interface MarketNewsResponse {
  news: NewsArticle[];
  count: number;
  source: string;
  cached_hours: number;
}

function normalizeArticle(article: NewsArticle): NewsArticle {
  const raw = article as NewsArticle & Record<string, unknown>;
  const rawTimestamp =
    article.providerPublishTime ??
    raw.published_at ??
    raw.publishedAt ??
    raw.timestamp ??
    raw.time;

  let providerPublishTime = (article.providerPublishTime ?? rawTimestamp) as string | number | undefined;

  if (typeof providerPublishTime === "string") {
    const parsed = Number(providerPublishTime);
    if (!Number.isNaN(parsed)) {
      providerPublishTime = parsed > 1e12 ? Math.floor(parsed / 1000) : parsed;
    } else {
      // Handle ISO date strings like "2025-02-10T12:00:00Z"
      const dateMs = Date.parse(providerPublishTime);
      if (!Number.isNaN(dateMs)) {
        providerPublishTime = Math.floor(dateMs / 1000);
      }
    }
  } else if (typeof providerPublishTime === "number" && providerPublishTime > 1e12) {
    providerPublishTime = Math.floor(providerPublishTime / 1000);
  }

  return {
    ...article,
    providerPublishTime,
  };
}

/**
 * Hook to fetch news for a specific stock ticker
 */
export function useStockNews(ticker: string, limit: number = 10) {
  const query = useQuery({
    queryKey: ["stockNews", ticker, limit],
    enabled: Boolean(ticker),
    queryFn: async ({ signal }) => {
      const response = await authFetch(`/api/stocks/${ticker}/news?limit=${limit}`, { signal });
      if (!response.ok) {
        throw new Error(`Failed to fetch news: ${response.statusText}`);
      }
      const data: StockNewsResponse = await response.json();
      return (data.news || []).map(normalizeArticle);
    },
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000,
  });

  const news = query.data ?? [];
  const loading = query.isLoading;
  const fetching = query.isFetching;
  const error = query.error instanceof Error ? query.error.message : query.error ? "Failed to fetch news" : null;

  return { news, loading, fetching, error };
}

/**
 * Hook to fetch general market news
 */
export function useMarketNews(limit: number = 20) {
  const query = useQuery({
    queryKey: ["marketNews", limit],
    queryFn: async ({ signal }) => {
      const response = await authFetch(`/api/stocks/news/market?limit=${limit}`, { signal });
      if (!response.ok) {
        throw new Error(`Failed to fetch market news: ${response.statusText}`);
      }
      const data: MarketNewsResponse = await response.json();
      return (data.news || []).map(normalizeArticle);
    },
    // When the limit changes (load more), keep the old list rendered until the bigger list arrives.
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000,
  });

  const news = query.data ?? [];
  const loading = query.isLoading;
  const fetching = query.isFetching;
  const error = query.error instanceof Error ? query.error.message : query.error ? "Failed to fetch market news" : null;

  return { news, loading, fetching, error };
}
