"use client";

import { useState, useEffect, useCallback } from "react";

export interface IndexQuote {
  symbol: string;
  label: string;
  price: number;
  previousClose: number;
  changePct: number;
}

interface IndexQuotesState {
  quotes: IndexQuote[];
  loading: boolean;
}

// Re-fetch the static file every 15 min to pick up cron updates
const POLL_INTERVAL_MS = 15 * 60 * 1000;

let sharedState: IndexQuotesState = { quotes: [], loading: true };
let listeners: Array<() => void> = [];
let fetchPromise: Promise<void> | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;

function notify() {
  for (const fn of listeners) fn();
}

async function fetchQuotes() {
  try {
    const res = await fetch("/index-quotes.json");
    if (!res.ok) return;
    const data = await res.json();
    sharedState = { quotes: data.quotes ?? [], loading: false };
  } catch {
    sharedState = { ...sharedState, loading: false };
  }
  notify();
}

function ensureFetching() {
  if (!fetchPromise) {
    fetchPromise = fetchQuotes().finally(() => {
      fetchPromise = null;
    });
  }
  if (!pollTimer) {
    pollTimer = setInterval(fetchQuotes, POLL_INTERVAL_MS);
  }
}

/**
 * Hook that returns index quotes from the static JSON written by the cron job.
 * Shared across all consumers with 15-minute polling.
 */
export function useIndexQuotes(): IndexQuotesState {
  const [, setTick] = useState(0);

  const rerender = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    listeners.push(rerender);
    ensureFetching();

    return () => {
      listeners = listeners.filter((fn) => fn !== rerender);
      if (listeners.length === 0 && pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };
  }, [rerender]);

  return sharedState;
}
