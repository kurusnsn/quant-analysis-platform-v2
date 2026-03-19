"use client";

import { useEffect, useState } from "react";

export interface StockMetadataEntry {
  market_cap?: number | null;
  sector?: string | null;
  industry?: string | null;
  country?: string | null;
  exchange?: string | null;
  quote_type?: string | null;
  currency?: string | null;
  short_name?: string | null;
  long_name?: string | null;
  yf_ticker?: string | null;
}

export interface StockMetadataFile {
  metadata: {
    generated_at: string;
    total_symbols: number;
    source: string;
  };
  stocks: Record<string, StockMetadataEntry>;
}

let cachedMetadataFile: StockMetadataFile | null = null;
let metadataLoadingPromise: Promise<StockMetadataFile | null> | null = null;

async function loadMetadataFile(): Promise<StockMetadataFile | null> {
  if (cachedMetadataFile) return cachedMetadataFile;
  if (metadataLoadingPromise) return metadataLoadingPromise;

  metadataLoadingPromise = (async () => {
    try {
      const response = await fetch("/stock-metadata.json");
      if (!response.ok) return null;
      const data = (await response.json()) as StockMetadataFile;
      cachedMetadataFile = data;
      return data;
    } catch {
      return null;
    } finally {
      metadataLoadingPromise = null;
    }
  })();

  return metadataLoadingPromise;
}

const MIN_MARKET_CAP_DEFAULT = 100_000_000;
const US_EXCHANGES = new Set([
  // Common Yahoo exchange codes for US-listed equities.
  "NYQ", // NYSE
  "NMS", // NASDAQ Global Select
  "NGM", // NASDAQ Global Market
  "NCM", // NASDAQ Capital Market
  "ASE", // NYSE American
  "PCX", // NYSE Arca
  "BTS", // Cboe BZX / BATS
]);
const USD = "USD";

export function useStockMetadata(minMarketCap: number = MIN_MARKET_CAP_DEFAULT) {
  const [file, setFile] = useState<StockMetadataFile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadMetadataFile().then((data) => {
      setFile(data);
      setLoading(false);
    });
  }, []);

  const stocks = file?.stocks ?? {};

  const getMetadata = (symbol: string): StockMetadataEntry | null => {
    return stocks[symbol.toUpperCase()] ?? null;
  };

  const isEligibleUSStock = (symbol: string): boolean => {
    const entry = getMetadata(symbol);
    if (!entry) return false;

    const marketCap = entry.market_cap ?? null;
    if (typeof marketCap !== "number" || !Number.isFinite(marketCap) || marketCap < minMarketCap) return false;

    const exchange = (entry.exchange ?? "").toString().trim().toUpperCase();
    if (!exchange || !US_EXCHANGES.has(exchange)) return false;

    const currency = (entry.currency ?? "").toString().trim().toUpperCase();
    if (!currency || currency !== USD) return false;

    const quoteType = (entry.quote_type ?? "").toString().trim().toUpperCase();
    if (quoteType && quoteType !== "EQUITY") return false;

    return true;
  };

  return {
    file,
    loading,
    stocks,
    getMetadata,
    isEligibleUSStock,
    minMarketCap,
  };
}
