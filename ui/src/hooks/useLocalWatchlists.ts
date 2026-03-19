"use client";

import { useEffect } from "react";
import type { Watchlist } from "@/types";
import { useUserStorageKey } from "@/hooks/useUserStorageKey";
import { startWatchlistsStorageSync, useWatchlistsStore } from "@/stores/watchlistsStore";

const BASE_STORAGE_KEY = "quant-platform_watchlists";

export function useLocalWatchlists(options?: { fallback?: Watchlist[] }) {
  const fallback = options?.fallback ?? [];
  const { storageKey } = useUserStorageKey(BASE_STORAGE_KEY);

  const watchlists = useWatchlistsStore((state) => state.watchlists);
  const hydrated = useWatchlistsStore((state) => state.hydrated);
  const setStorageKey = useWatchlistsStore((state) => state.setStorageKey);
  const setWatchlists = useWatchlistsStore((state) => state.setWatchlists);
  const addTickerToWatchlist = useWatchlistsStore((state) => state.addTickerToWatchlist);
  const removeTickerFromWatchlist = useWatchlistsStore((state) => state.removeTickerFromWatchlist);
  const toggleTickerInWatchlist = useWatchlistsStore((state) => state.toggleTickerInWatchlist);
  const isInWatchlist = useWatchlistsStore((state) => state.isInWatchlist);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (storageKey !== BASE_STORAGE_KEY) {
      const legacy = localStorage.getItem(BASE_STORAGE_KEY);
      if (legacy && !localStorage.getItem(storageKey)) {
        localStorage.setItem(storageKey, legacy);
      }
    }
    setStorageKey(storageKey, fallback);
    startWatchlistsStorageSync();
  }, [fallback, setStorageKey, storageKey]);

  return {
    watchlists: hydrated ? watchlists : fallback,
    setWatchlists,
    addTickerToWatchlist,
    removeTickerFromWatchlist,
    toggleTickerInWatchlist,
    isInWatchlist,
  };
}
