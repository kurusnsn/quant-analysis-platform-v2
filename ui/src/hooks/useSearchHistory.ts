"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "quant-platform_search_history";
const MAX_ITEMS = 5;

export type SearchHistoryItem = {
  prompt: string;
  timestamp: string;
  deepResearch: boolean;
  watchlistName?: string;
};

function load(): SearchHistoryItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_ITEMS) : [];
  } catch {
    return [];
  }
}

function persist(items: SearchHistoryItem[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_ITEMS)));
}

export function useSearchHistory() {
  const [history, setHistory] = useState<SearchHistoryItem[]>([]);

  useEffect(() => {
    setHistory(load());
  }, []);

  const addSearch = useCallback(
    (prompt: string, deepResearch: boolean, watchlistName?: string) => {
      setHistory((prev) => {
        // Remove duplicate if same prompt exists
        const filtered = prev.filter((item) => item.prompt !== prompt);
        const next: SearchHistoryItem[] = [
          { prompt, timestamp: new Date().toISOString(), deepResearch, watchlistName },
          ...filtered,
        ].slice(0, MAX_ITEMS);
        persist(next);
        return next;
      });
    },
    []
  );

  const clearHistory = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setHistory([]);
  }, []);

  return { history, addSearch, clearHistory };
}
