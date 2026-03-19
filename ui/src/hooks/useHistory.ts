"use client";

import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";

const rawApiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api";
const normalizedApiUrl = rawApiUrl.replace(/\/+$/, "");
const API_URL = normalizedApiUrl.endsWith("/api")
  ? normalizedApiUrl
  : `${normalizedApiUrl}/api`;

export type HistoryItem = {
  id: string;
  kind: string;
  createdAt: string;
  title?: string | null;
  prompt?: string | null;
  watchlistId?: string | null;
  watchlistName?: string | null;
  tickers: string[];
  payload: string;
};

export type HistoryListResponse = {
  page: number;
  pageSize: number;
  total: number;
  items: HistoryItem[];
};

export type HistoryFilters = {
  from?: string;
  to?: string;
  watchlistId?: string;
  ticker?: string;
  kind?: string;
  page?: number;
  pageSize?: number;
};

const CACHE_TTL = 30 * 1000;

async function fetchHistory(filters: HistoryFilters, signal?: AbortSignal) {
  const params = new URLSearchParams();

  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.watchlistId) params.set("watchlistId", filters.watchlistId);
  if (filters.ticker) params.set("ticker", filters.ticker);
  if (filters.kind) params.set("kind", filters.kind);
  if (filters.page) params.set("page", String(filters.page));
  if (filters.pageSize) params.set("pageSize", String(filters.pageSize));

  const response = await authFetch(`${API_URL}/history?${params.toString()}`, { signal });
  if (!response.ok) {
    throw new Error(`Failed to load history (${response.status})`);
  }

  return (await response.json()) as HistoryListResponse;
}

export function useHistory(filters: HistoryFilters) {
  const query = useQuery({
    queryKey: ["history", filters],
    queryFn: ({ signal }) => fetchHistory(filters, signal),
    staleTime: CACHE_TTL,
    gcTime: CACHE_TTL,
  });

  return {
    data: query.data ?? null,
    loading: query.isFetching,
    error:
      query.error instanceof Error
        ? query.error.message
        : query.error
          ? "Failed to load history"
          : null,
    refetch: query.refetch,
  };
}

