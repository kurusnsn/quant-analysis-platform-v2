"use client";

import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

export interface StockPopularity {
    symbol: string;
    watchlistCount: number;
    updatedAt?: string | null;
}

/**
 * Fetch popularity for a single stock symbol.
 */
export function useStockPopularity(symbol: string) {
    return useQuery<StockPopularity>({
        queryKey: ["stockPopularity", symbol?.toUpperCase()],
        enabled: Boolean(symbol),
        staleTime: 5 * 60 * 1000, // 5 minutes
        queryFn: async ({ signal }) => {
            const response = await fetch(
                `${API_URL}/stockpopularity/${encodeURIComponent(symbol.toUpperCase())}`,
                { signal }
            );
            if (!response.ok) {
                throw new Error("Failed to fetch stock popularity");
            }
            return response.json();
        },
    });
}

/**
 * Fetch popularity for multiple stock symbols in a single request.
 */
export function useBatchStockPopularity(symbols: string[]) {
    const normalizedSymbols = symbols
        .filter(Boolean)
        .map((s) => s.toUpperCase())
        .join(",");

    return useQuery<StockPopularity[]>({
        queryKey: ["stockPopularity", "batch", normalizedSymbols],
        enabled: symbols.length > 0,
        staleTime: 5 * 60 * 1000, // 5 minutes
        queryFn: async ({ signal }) => {
            const response = await fetch(
                `${API_URL}/stockpopularity?symbols=${encodeURIComponent(normalizedSymbols)}`,
                { signal }
            );
            if (!response.ok) {
                throw new Error("Failed to fetch batch stock popularity");
            }
            return response.json();
        },
    });
}

/**
 * Fetch top N most popular stocks across all users' watchlists.
 */
export function useTopPopularStocks(limit = 10) {
    return useQuery<StockPopularity[]>({
        queryKey: ["stockPopularity", "top", limit],
        staleTime: 5 * 60 * 1000, // 5 minutes
        queryFn: async ({ signal }) => {
            const response = await fetch(
                `${API_URL}/stockpopularity/top?limit=${limit}`,
                { signal }
            );
            if (!response.ok) {
                throw new Error("Failed to fetch top popular stocks");
            }
            return response.json();
        },
    });
}
