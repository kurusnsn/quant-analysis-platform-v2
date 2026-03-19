"use client";
import { devConsole } from "@/lib/devLog";

import { create } from "zustand";
import type { Ticker, Watchlist } from "@/types";
import { authFetch } from "@/lib/authFetch";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

type WatchlistUpdater = Watchlist[] | ((prev: Watchlist[]) => Watchlist[]);

type WatchlistsStore = {
  storageKey: string;
  fallback: Watchlist[];
  watchlists: Watchlist[];
  hydrated: boolean;
  setStorageKey: (storageKey: string, fallback: Watchlist[]) => void;
  setWatchlists: (next: WatchlistUpdater) => void;
  updateWatchlist: (watchlistId: string, updater: (watchlist: Watchlist) => Watchlist) => void;
  addTickerToWatchlist: (watchlistId: string, symbol: string) => void;
  removeTickerFromWatchlist: (watchlistId: string, symbol: string) => void;
  toggleTickerInWatchlist: (watchlistId: string, symbol: string) => void;
  isInWatchlist: (watchlistId: string, symbol: string) => boolean;
};

const normalizeSymbol = (value: unknown) => {
  if (typeof value !== "string") return "";
  return value.trim().toUpperCase();
};

const ensureTicker = (ticker: Partial<Ticker> & { symbol: string }): Ticker => ({
  symbol: ticker.symbol,
  name: ticker.name || ticker.symbol,
  price: ticker.price || "$0.00",
  change: ticker.change || "0.0%",
  isPositive: ticker.isPositive ?? true,
  riskScore: typeof ticker.riskScore === "number" ? ticker.riskScore : 50,
  logoUrl: ticker.logoUrl ?? undefined,
});

const normalizeWatchlists = (raw: unknown, fallback: Watchlist[]): Watchlist[] => {
  if (!Array.isArray(raw)) return fallback;
  const normalized = raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const watchlist = item as Watchlist;
      const id = typeof watchlist.id === "string" ? watchlist.id : "";
      const name = typeof watchlist.name === "string" ? watchlist.name : "";
      if (!id || !name) return null;
      const tickers = Array.isArray(watchlist.tickers) ? watchlist.tickers : [];
      const normalizedTickers = tickers
        .map((ticker) => {
          if (!ticker || typeof ticker !== "object") return null;
          const symbol = normalizeSymbol((ticker as Ticker).symbol);
          if (!symbol) return null;
          return ensureTicker({ ...(ticker as Ticker), symbol });
        })
        .filter((ticker): ticker is Ticker => Boolean(ticker));
      return { ...watchlist, id, name, tickers: normalizedTickers };
    })
    .filter((watchlist): watchlist is Watchlist => Boolean(watchlist));
  return normalized;
};

const readStorage = (storageKey: string, fallback: Watchlist[]) => {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return fallback;
    return normalizeWatchlists(JSON.parse(raw), fallback);
  } catch {
    return fallback;
  }
};

const writeStorage = (storageKey: string, watchlists: Watchlist[]) => {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(storageKey, JSON.stringify(watchlists));
  } catch {
    // ignore storage errors
  }
};

const syncWatchlistTickers = async (watchlistId: string, symbols: string[]) => {
  if (!API_URL) return;
  try {
    const payload = {
      assets: symbols.map((symbol) => ({ symbol })),
    };
    const response = await authFetch(`${API_URL}/watchlists/${watchlistId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      devConsole.warn("Failed to sync watchlist tickers:", response.status);
    }
  } catch (error) {
    devConsole.warn("Failed to sync watchlist tickers:", error);
  }
};

export const useWatchlistsStore = create<WatchlistsStore>((set, get) => ({
  storageKey: "quant-platform_watchlists",
  fallback: [],
  watchlists: [],
  hydrated: false,
  setStorageKey: (storageKey, fallback) => {
    const normalizedFallback = normalizeWatchlists(fallback, []);
    if (typeof window === "undefined") {
      set({ storageKey, fallback: normalizedFallback, watchlists: normalizedFallback, hydrated: true });
      return;
    }
    const next = readStorage(storageKey, normalizedFallback);
    set({ storageKey, fallback: normalizedFallback, watchlists: next, hydrated: true });
  },
  setWatchlists: (next) => {
    const current = get().watchlists;
    const resolved =
      typeof next === "function" ? (next as (prev: Watchlist[]) => Watchlist[])(current) : next;
    const normalized = normalizeWatchlists(resolved, get().fallback);
    set({ watchlists: normalized, hydrated: true });
    writeStorage(get().storageKey, normalized);
  },
  updateWatchlist: (watchlistId, updater) => {
    const current = get().watchlists;
    let changed = false;
    const next = current.map((watchlist) => {
      if (watchlist.id !== watchlistId) return watchlist;
      const updated = updater(watchlist);
      if (updated !== watchlist) {
        changed = true;
      }
      return updated;
    });

    if (!changed) return;
    const normalized = normalizeWatchlists(next, get().fallback);
    set({ watchlists: normalized, hydrated: true });
    writeStorage(get().storageKey, normalized);
    const updatedWatchlist = normalized.find((watchlist) => watchlist.id === watchlistId);
    if (updatedWatchlist) {
      void syncWatchlistTickers(
        updatedWatchlist.id,
        updatedWatchlist.tickers.map((ticker) => ticker.symbol)
      );
    }
  },
  addTickerToWatchlist: (watchlistId, symbol) => {
    const normalizedSymbol = normalizeSymbol(symbol);
    if (!normalizedSymbol) return;
    get().updateWatchlist(watchlistId, (watchlist) => {
      if (watchlist.tickers.some((ticker) => ticker.symbol === normalizedSymbol)) {
        return watchlist;
      }
      const nextTicker = ensureTicker({ symbol: normalizedSymbol, name: normalizedSymbol });
      return { ...watchlist, tickers: [...watchlist.tickers, nextTicker] };
    });
  },
  removeTickerFromWatchlist: (watchlistId, symbol) => {
    const normalizedSymbol = normalizeSymbol(symbol);
    if (!normalizedSymbol) return;
    get().updateWatchlist(watchlistId, (watchlist) => {
      const nextTickers = watchlist.tickers.filter((ticker) => ticker.symbol !== normalizedSymbol);
      if (nextTickers.length === watchlist.tickers.length) {
        return watchlist;
      }
      return {
        ...watchlist,
        tickers: nextTickers,
      };
    });
  },
  toggleTickerInWatchlist: (watchlistId, symbol) => {
    const normalizedSymbol = normalizeSymbol(symbol);
    if (!normalizedSymbol) return;
    get().updateWatchlist(watchlistId, (watchlist) => {
      const exists = watchlist.tickers.some((ticker) => ticker.symbol === normalizedSymbol);
      if (exists) {
        return {
          ...watchlist,
          tickers: watchlist.tickers.filter((ticker) => ticker.symbol !== normalizedSymbol),
        };
      }
      const nextTicker = ensureTicker({ symbol: normalizedSymbol, name: normalizedSymbol });
      return { ...watchlist, tickers: [...watchlist.tickers, nextTicker] };
    });
  },
  isInWatchlist: (watchlistId, symbol) => {
    const normalizedSymbol = normalizeSymbol(symbol);
    if (!normalizedSymbol) return false;
    return get().watchlists.some(
      (watchlist) =>
        watchlist.id === watchlistId &&
        watchlist.tickers.some((ticker) => ticker.symbol === normalizedSymbol)
    );
  },
}));

let watchlistsStorageSyncStarted = false;

export function startWatchlistsStorageSync() {
  if (watchlistsStorageSyncStarted || typeof window === "undefined") return;
  watchlistsStorageSyncStarted = true;

  window.addEventListener("storage", (event) => {
    if (!event.key) return;
    const { storageKey, fallback } = useWatchlistsStore.getState();
    if (event.key !== storageKey) return;
    const next = readStorage(storageKey, fallback);
    useWatchlistsStore.setState({ watchlists: next, hydrated: true });
  });
}
