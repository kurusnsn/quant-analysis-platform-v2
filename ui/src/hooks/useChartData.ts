"use client";

import { useQuery } from "@tanstack/react-query";

export type ChartTimeframe =
  | "1D"
  | "5D"
  | "1M"
  | "3M"
  | "6M"
  | "YTD"
  | "1Y"
  | "5Y"
  | "MAX";

export type CandleInterval = "15m" | "1h" | "1d" | "1wk" | "1mo";

export interface ChartDataPoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Yahoo range string for each timeframe */
const TIMEFRAME_TO_RANGE: Record<ChartTimeframe, string> = {
  "1D": "1d",
  "5D": "5d",
  "1M": "1mo",
  "3M": "3mo",
  "6M": "6mo",
  YTD: "ytd",
  "1Y": "1y",
  "5Y": "5y",
  MAX: "max",
};

/** Default interval per timeframe (used when no explicit interval is set) */
const DEFAULT_INTERVAL: Record<ChartTimeframe, CandleInterval> = {
  "1D": "15m",
  "5D": "15m",
  "1M": "1h",
  "3M": "1d",
  "6M": "1d",
  YTD: "1d",
  "1Y": "1d",
  "5Y": "1wk",
  MAX: "1mo",
};

/**
 * Valid intervals per timeframe.
 * Yahoo has data-availability limits:
 *   15m → max ~60 days, 1h → max ~730 days
 */
const VALID_INTERVALS: Record<ChartTimeframe, CandleInterval[]> = {
  "1D": ["15m"],
  "5D": ["15m", "1h"],
  "1M": ["15m", "1h", "1d"],
  "3M": ["1h", "1d"],
  "6M": ["1d", "1wk"],
  YTD: ["1d", "1wk"],
  "1Y": ["1d", "1wk"],
  "5Y": ["1wk", "1mo"],
  MAX: ["1wk", "1mo"],
};

export const INTERVAL_LABELS: Record<CandleInterval, string> = {
  "15m": "15m",
  "1h": "1H",
  "1d": "1D",
  "1wk": "1W",
  "1mo": "1M",
};

export const ALL_INTERVALS: CandleInterval[] = ["15m", "1h", "1d", "1wk", "1mo"];

/** Which intervals are available for the given timeframe */
export function getValidIntervals(timeframe: ChartTimeframe): CandleInterval[] {
  return VALID_INTERVALS[timeframe];
}

/** Default interval for a timeframe */
export function getDefaultInterval(timeframe: ChartTimeframe): CandleInterval {
  return DEFAULT_INTERVAL[timeframe];
}

const STALE_TIMES: Record<string, number> = {
  "15m": 2 * 60 * 1000,
  "1h": 5 * 60 * 1000,
  "1d": 15 * 60 * 1000,
  "1wk": 60 * 60 * 1000,
  "1mo": 6 * 60 * 60 * 1000,
};

interface ChartResponse {
  ticker: string;
  interval: string;
  range: string;
  data: ChartDataPoint[];
}

/**
 * Hook that fetches OHLCV chart data for a given ticker, timeframe, and candle interval.
 * If no interval is provided, it defaults based on the timeframe.
 */
export function useChartData(
  ticker: string,
  timeframe: ChartTimeframe,
  interval?: CandleInterval,
) {
  const range = TIMEFRAME_TO_RANGE[timeframe];
  const resolvedInterval = interval ?? DEFAULT_INTERVAL[timeframe];

  const query = useQuery<ChartDataPoint[]>({
    queryKey: ["chartData", ticker.toUpperCase(), range, resolvedInterval],
    enabled: Boolean(ticker),
    queryFn: async ({ signal }) => {
      const res = await fetch(
        `/api/stocks/${encodeURIComponent(ticker)}/chart?range=${range}&interval=${resolvedInterval}`,
        { signal },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Chart fetch failed: ${res.statusText}`);
      }
      const json: ChartResponse = await res.json();
      return json.data;
    },
    staleTime: STALE_TIMES[resolvedInterval] ?? 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  return {
    data: query.data ?? [],
    loading: query.isLoading,
    fetching: query.isFetching,
    error: query.error?.message ?? null,
  };
}
