"use client";

import { create } from "zustand";

type FollowedStocksStore = {
  storageKey: string;
  fallback: string[];
  followed: string[];
  setStorageKey: (storageKey: string, fallback?: string[]) => void;
  setFollowed: (
    symbols: string[],
    options?: { sync?: boolean; write?: boolean }
  ) => void;
  update: (updater: (prev: string[]) => string[]) => void;
  follow: (symbol: string) => void;
  unfollow: (symbol: string) => void;
  toggleFollow: (symbol: string) => void;
  isFollowed: (symbol?: string) => boolean;
};

const normalizeSymbols = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) return [];
  const unique = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const symbol = item.trim().toUpperCase();
    if (!symbol) continue;
    unique.add(symbol);
  }
  return Array.from(unique);
};

const readStorage = (storageKey: string, fallback: string[]) => {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return fallback;
    return normalizeSymbols(JSON.parse(raw));
  } catch {
    return fallback;
  }
};

const writeStorage = (storageKey: string, symbols: string[]) => {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(storageKey, JSON.stringify(symbols));
  } catch {
    // ignore storage errors
  }
};

export const useFollowedStocksStore = create<FollowedStocksStore>((set, get) => ({
  storageKey: "quant-platform_followed_stocks",
  fallback: [],
  followed: [],
  setStorageKey: (storageKey, fallback = []) => {
    const normalizedFallback = normalizeSymbols(fallback);
    if (typeof window === "undefined") {
      set({ storageKey, fallback: normalizedFallback, followed: normalizedFallback });
      return;
    }
    const next = readStorage(storageKey, normalizedFallback);
    set({ storageKey, fallback: normalizedFallback, followed: next });
  },
  setFollowed: (symbols, options) => {
    const normalized = normalizeSymbols(symbols);
    set({ followed: normalized });
    if (options?.write ?? true) {
      writeStorage(get().storageKey, normalized);
    }
  },
  update: (updater) => {
    const next = normalizeSymbols(updater(get().followed));
    get().setFollowed(next);
  },
  follow: (symbol) => {
    const normalized = symbol.trim().toUpperCase();
    if (!normalized) return;
    get().update((prev) => (prev.includes(normalized) ? prev : [...prev, normalized]));
  },
  unfollow: (symbol) => {
    const normalized = symbol.trim().toUpperCase();
    if (!normalized) return;
    get().update((prev) => prev.filter((s) => s !== normalized));
  },
  toggleFollow: (symbol) => {
    const normalized = symbol.trim().toUpperCase();
    if (!normalized) return;
    get().update((prev) =>
      prev.includes(normalized)
        ? prev.filter((s) => s !== normalized)
        : [...prev, normalized]
    );
  },
  isFollowed: (symbol) => {
    if (!symbol) return false;
    const normalized = symbol.trim().toUpperCase();
    return get().followed.includes(normalized);
  },
}));

let followedStocksStorageSyncStarted = false;

export function startFollowedStocksStorageSync() {
  if (followedStocksStorageSyncStarted || typeof window === "undefined") return;
  followedStocksStorageSyncStarted = true;

  window.addEventListener("storage", (event) => {
    if (!event.key) return;
    const { storageKey, fallback } = useFollowedStocksStore.getState();
    if (event.key !== storageKey) return;
    const next = readStorage(storageKey, fallback);
    useFollowedStocksStore.getState().setFollowed(next, { sync: false, write: false });
  });
}

export async function hydrateFollowedStocksFromSession(_storageKey: string) {
  // No-op: followed stocks are now stored in localStorage only.
  // Supabase user_metadata sync has been removed.
}
