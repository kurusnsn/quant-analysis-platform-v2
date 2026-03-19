"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useCompanyLogos } from "@/hooks/useCompanyLogos";
import { PriceData, useStockPrices } from "@/hooks/useStockPrices";
import { useFollowedStocks } from "@/hooks/useFollowedStocks";

type UniverseKey = "tracked" | "mega";
type WindowKey = "1D" | "1W" | "1M" | "3M" | "6M" | "1Y";

const WINDOWS: Array<{ key: WindowKey; offsetTradingDays: number }> = [
  { key: "1D", offsetTradingDays: 1 },
  { key: "1W", offsetTradingDays: 5 },
  { key: "1M", offsetTradingDays: 21 },
  { key: "3M", offsetTradingDays: 63 },
  { key: "6M", offsetTradingDays: 126 },
  { key: "1Y", offsetTradingDays: 252 },
];

const MEGA_DEFAULTS: string[] = [
  "AAPL",
  "MSFT",
  "NVDA",
  "AMZN",
  "GOOGL",
  "META",
  "TSLA",
  "AMD",
];

function formatPct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const rounded = Math.round(value * 100) / 100;
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded.toFixed(2)}%`;
}

function formatDateLabel(isoDate: string): string {
  const dt = new Date(`${isoDate}T00:00:00`);
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function getCloseOnOrBefore(params: {
  series: Record<string, PriceData> | null;
  dates: string[];
  startIndex: number;
  maxLookback: number;
}): { date: string; close: number } | null {
  const { series, dates, startIndex, maxLookback } = params;
  if (!series) return null;
  const start = Math.min(startIndex, dates.length - 1);
  if (start < 0) return null;

  const minIndex = Math.max(0, start - maxLookback);
  for (let i = start; i >= minIndex; i--) {
    const date = dates[i];
    const point = date ? series[date] : null;
    if (!point) continue;
    if (typeof point.close !== "number" || !Number.isFinite(point.close) || point.close <= 0) continue;
    return { date, close: point.close };
  }
  return null;
}

function heatStyle(params: { value: number | null; maxAbs: number }): { bg: string; border: string; textClass: string } {
  const { value, maxAbs } = params;
  if (value === null || !Number.isFinite(value)) {
    return {
      bg: "rgba(255,255,255,0.02)",
      border: "rgba(255,255,255,0.06)",
      textClass: "text-white",
    };
  }

  const cap = Math.max(1, maxAbs);
  const clamped = Math.max(-cap, Math.min(cap, value));
  const intensity = Math.min(1, Math.abs(clamped) / cap);
  const isUp = clamped >= 0;

  const rgb = isUp ? "0,255,65" : "255,0,85";
  const bgAlpha = 0.06 + 0.32 * intensity;
  const borderAlpha = 0.08 + 0.45 * intensity;

  return {
    bg: `rgba(${rgb},${bgAlpha})`,
    border: `rgba(${rgb},${borderAlpha})`,
    textClass: "text-white",
  };
}

export default function MarketHeatmapWidget() {
  const { followed } = useFollowedStocks();
  const [universe, setUniverse] = useState<UniverseKey>("tracked");
  const { prices, loading: pricesLoading } = useStockPrices();

  const hasTracked = followed.length > 0;
  const symbols = useMemo(() => {
    const base = universe === "tracked" && hasTracked ? followed : MEGA_DEFAULTS;
    const unique = Array.from(new Set(base.map((s) => s.toUpperCase()).filter(Boolean)));
    return unique.slice(0, 12);
  }, [followed, hasTracked, universe]);

  const { getLogo } = useCompanyLogos(symbols);

  const heatmap = useMemo(() => {
    const dateSet = new Set<string>();
    for (const symbol of symbols) {
      const series = prices[symbol];
      if (!series) continue;
      for (const d of Object.keys(series)) dateSet.add(d);
    }

    const dates = Array.from(dateSet).sort(); // YYYY-MM-DD sort is chronological
    if (dates.length === 0) {
      return {
        toDate: null as string | null,
        rows: [] as Array<{ symbol: string; values: Record<WindowKey, number | null> }>,
        maxAbs: 5,
      };
    }

    const toIndex = dates.length - 1;
    const toDate = dates[toIndex] ?? null;

    const rows = symbols.map((symbol) => {
      const series = prices[symbol] ?? null;
      const to = getCloseOnOrBefore({ series, dates, startIndex: toIndex, maxLookback: 7 });

      const values = {} as Record<WindowKey, number | null>;
      for (const w of WINDOWS) {
        const fromIndex = toIndex - w.offsetTradingDays;
        if (!to || fromIndex < 0) {
          values[w.key] = null;
          continue;
        }

        const from = getCloseOnOrBefore({ series, dates, startIndex: fromIndex, maxLookback: 7 });
        if (!from) {
          values[w.key] = null;
          continue;
        }

        values[w.key] = ((to.close - from.close) / from.close) * 100;
      }

      return { symbol, values };
    });

    const absValues: number[] = [];
    for (const row of rows) {
      for (const w of WINDOWS) {
        const v = row.values[w.key];
        if (typeof v === "number" && Number.isFinite(v)) absValues.push(Math.abs(v));
      }
    }
    const maxAbsFound = absValues.length ? Math.max(...absValues) : 5;
    const maxAbs = Math.max(3, Math.min(12, maxAbsFound || 5));

    return { toDate, rows, maxAbs };
  }, [prices, symbols]);

  const loading = pricesLoading && heatmap.rows.length === 0;

  return (
    <div className="bg-surface border border-border-color rounded-2xl p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex flex-col">
          <h3 className="font-bold text-white text-[11px] uppercase tracking-[0.15em]">Heatmap</h3>
          <p className="text-[10px] text-white/80">
            Performance by window •{" "}
            {heatmap.toDate ? <span>As of {formatDateLabel(heatmap.toDate)} (EOD)</span> : "Date unavailable"}
          </p>
        </div>
        <span className="material-symbols-outlined text-white/70">grid_view</span>
      </div>

      <div className="flex gap-1 mb-3">
        <button
          onClick={() => setUniverse("tracked")}
          disabled={!hasTracked}
          className={`px-3 py-1.5 text-[11px] font-semibold rounded-2xl transition-colors ${
            universe === "tracked"
              ? "bg-primary text-white"
              : "text-muted hover:text-foreground hover:bg-surface-highlight disabled:opacity-50 disabled:cursor-not-allowed"
          }`}
          aria-pressed={universe === "tracked"}
          title={hasTracked ? "Use your followed symbols" : "Follow stocks to enable"}
        >
          Tracked
        </button>
        <button
          onClick={() => setUniverse("mega")}
          className={`px-3 py-1.5 text-[11px] font-semibold rounded-2xl transition-colors ${
            universe === "mega" ? "bg-primary text-white" : "text-muted hover:text-foreground hover:bg-surface-highlight"
          }`}
          aria-pressed={universe === "mega"}
        >
          Mega
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-9 bg-surface-highlight rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : heatmap.rows.length === 0 ? (
        <div className="text-sm text-muted bg-surface-highlight border border-border-color rounded-2xl p-3">
          No price data available for this universe.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-1 min-w-[520px]">
            <thead>
              <tr>
                <th className="text-[10px] font-semibold text-white/80 uppercase tracking-wider text-left pl-1">Ticker</th>
                {WINDOWS.map((w) => (
                  <th key={w.key} className="text-[10px] font-semibold text-white/80 uppercase tracking-wider text-center">
                    {w.key}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {heatmap.rows.map((row) => {
                const logoUrl = getLogo(row.symbol);
                return (
                  <tr key={row.symbol}>
                    <td className="pr-1">
                      <Link href={`/stock/${row.symbol}`} className="flex items-center gap-2 min-w-0">
                        <div className="size-7 rounded-md bg-surface-highlight border border-border-color flex items-center justify-center overflow-hidden">
                          {logoUrl ? (
                            <img
                              src={logoUrl}
                              alt={`${row.symbol} logo`}
                              className="w-5 h-5 object-contain"
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = "none";
                              }}
                            />
                          ) : (
                            <span className="text-[9px] font-bold text-white">{row.symbol.slice(0, 2)}</span>
                          )}
                        </div>
                        <span className="text-[12px] font-bold text-white truncate">{row.symbol}</span>
                      </Link>
                    </td>
                    {WINDOWS.map((w) => {
                      const value = row.values[w.key];
                      const style = heatStyle({ value, maxAbs: heatmap.maxAbs });
                      return (
                        <td key={w.key}>
                          <div
                            className={`h-9 rounded-lg border flex items-center justify-center text-[10px] font-mono font-bold ${style.textClass}`}
                            style={{ backgroundColor: style.bg, borderColor: style.border }}
                            title={value === null ? "Not enough history" : formatPct(value)}
                          >
                            {formatPct(value)}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-3 flex items-center justify-between text-[10px] text-white/80">
        <span>Scale: ±{Math.round(heatmap.maxAbs)}%</span>
        <span className="font-mono">1W≈5d • 1M≈21d • 1Y≈252d</span>
      </div>
    </div>
  );
}
