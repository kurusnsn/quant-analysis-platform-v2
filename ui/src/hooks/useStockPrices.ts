"use client";

import { useState, useEffect } from "react";

export interface PriceData {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface StockPrices {
  [symbol: string]: {
    [date: string]: PriceData;
  };
}

interface PriceResponse {
  metadata: {
    generated_at: string;
    total_symbols: number;
    source: string;
  };
  prices: StockPrices;
}

let cachedPrices: StockPrices | null = null;
let loadingPromise: Promise<StockPrices> | null = null;

async function loadPrices(): Promise<StockPrices> {
  // Return cached if available
  if (cachedPrices) {
    return cachedPrices;
  }

  // Return existing promise if already loading
  if (loadingPromise) {
    return loadingPromise;
  }

  // Start loading
  loadingPromise = (async () => {
    try {
      const response = await fetch('/stock-prices.json');

      if (!response.ok) {
        return {};
      }

      const data: PriceResponse = await response.json();
      cachedPrices = data.prices;
      return cachedPrices;
    } catch (error) {
      return {};
    } finally {
      loadingPromise = null;
    }
  })();

  return loadingPromise;
}

/**
 * Hook to access EOD price data for stocks
 */
export function useStockPrices() {
  const [prices, setPrices] = useState<StockPrices>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPrices().then(data => {
      setPrices(data);
      setLoading(false);
    });
  }, []);

  /**
   * Get all price data for a symbol
   */
  const getPrices = (symbol: string): { [date: string]: PriceData } | null => {
    return prices[symbol.toUpperCase()] || null;
  };

  /**
   * Get latest price for a symbol
   */
  const getLatestPrice = (symbol: string): PriceData | null => {
    const symbolPrices = getPrices(symbol);
    if (!symbolPrices) return null;

    const dates = Object.keys(symbolPrices).sort();
    const latestDate = dates[dates.length - 1];
    return symbolPrices[latestDate];
  };

  /**
   * Get price for a specific date
   */
  const getPriceOnDate = (symbol: string, date: string): PriceData | null => {
    const symbolPrices = getPrices(symbol);
    if (!symbolPrices) return null;
    return symbolPrices[date] || null;
  };

  /**
   * Get price change percentage between two dates
   */
  const getPriceChange = (symbol: string, fromDate: string, toDate: string): number | null => {
    const fromPrice = getPriceOnDate(symbol, fromDate);
    const toPrice = getPriceOnDate(symbol, toDate);

    if (!fromPrice || !toPrice) return null;

    return ((toPrice.close - fromPrice.close) / fromPrice.close) * 100;
  };

  /**
   * Get date range for a symbol
   */
  const getDateRange = (symbol: string): { start: string; end: string } | null => {
    const symbolPrices = getPrices(symbol);
    if (!symbolPrices) return null;

    const dates = Object.keys(symbolPrices).sort();
    return {
      start: dates[0],
      end: dates[dates.length - 1],
    };
  };

  return {
    prices,
    loading,
    getPrices,
    getLatestPrice,
    getPriceOnDate,
    getPriceChange,
    getDateRange,
  };
}
