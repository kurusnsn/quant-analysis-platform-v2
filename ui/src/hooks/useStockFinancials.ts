"use client";
import { devConsole } from "@/lib/devLog";

import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";

export type FinancialValue = number | string | null;

export interface FinancialTableData {
  columns: string[];
  rows: Array<{
    label: string;
    values: FinancialValue[];
  }>;
}

export interface FinancialStatements {
  income_statement: {
    annual: FinancialTableData;
    quarterly: FinancialTableData;
  };
  balance_sheet: {
    annual: FinancialTableData;
    quarterly: FinancialTableData;
  };
  cash_flow: {
    annual: FinancialTableData;
    quarterly: FinancialTableData;
  };
}

export interface ValuationRatios {
  trailing_pe?: number | null;
  forward_pe?: number | null;
  price_to_sales?: number | null;
  price_to_book?: number | null;
  ev_to_ebitda?: number | null;
  peg_ratio?: number | null;
  dividend_yield?: number | null;
  beta?: number | null;
}

export interface FinancialsResponse {
  ticker: string;
  company_name?: string;
  currency?: string;
  generated_at?: string;
  source?: string;
  key_stats?: Record<string, FinancialValue>;
  valuation_ratios?: ValuationRatios;
  statements: FinancialStatements;
}

const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

async function fetchFinancials(ticker: string, signal?: AbortSignal): Promise<FinancialsResponse | null> {
  const symbol = ticker.toUpperCase();
  try {
    const response = await authFetch(`/api/stocks/${symbol}/financials`, { signal });
    if (!response.ok) {
      devConsole.warn(`Financials unavailable for ${symbol}:`, response.status);
      return null;
    }
    return (await response.json()) as FinancialsResponse;
  } catch (error) {
    if (!(error instanceof Error && error.name === "AbortError")) {
      devConsole.error("Failed to load financials:", error);
    }
    return null;
  }
}

export function useStockFinancials(ticker?: string) {
  const symbol = ticker?.toUpperCase() ?? "";
  const query = useQuery({
    queryKey: ["stockFinancials", symbol],
    enabled: Boolean(symbol),
    queryFn: ({ signal }) => fetchFinancials(symbol, signal),
    staleTime: CACHE_TTL,
    gcTime: CACHE_TTL,
  });

  const financials = query.data ?? null;
  const loading = query.isLoading;
  const error = query.error instanceof Error ? query.error.message : query.error ? "Failed to load financials" : null;

  return { financials, loading, error };
}
