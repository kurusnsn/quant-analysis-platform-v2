"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useCompanyLogos } from "@/hooks/useCompanyLogos";
import { useStockPrices } from "@/hooks/useStockPrices";
import { useStockMetadata } from "@/hooks/useStockMetadata";

type WindowKey = "1D" | "1W" | "1M";

interface MoverRow {
  symbol: string;
  changePct: number;
  fromClose: number;
  toClose: number;
}

function formatPct(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded.toFixed(2)}%`;
}

function formatDateLabel(isoDate: string): string {
  // isoDate: YYYY-MM-DD
  const dt = new Date(`${isoDate}T00:00:00`);
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function computeMoversFromPrices(params: {
  prices: ReturnType<typeof useStockPrices>["prices"];
  eligibleSymbols: Set<string>;
  offsetTradingDays: number;
  limit: number;
}): { fromDate: string | null; toDate: string | null; gainers: MoverRow[]; losers: MoverRow[] } {
  const { prices, eligibleSymbols, offsetTradingDays, limit } = params;
  const allSymbols = Object.keys(prices).map((s) => s.toUpperCase());

  const dateSet = new Set<string>();
  for (const symbol of allSymbols) {
    const series = prices[symbol];
    if (!series) continue;
    for (const d of Object.keys(series)) dateSet.add(d);
  }

  const dates = Array.from(dateSet).sort();
  if (dates.length === 0) return { fromDate: null, toDate: null, gainers: [], losers: [] };

  const toDate = dates[dates.length - 1]!;
  const fromIndex = dates.length - 1 - offsetTradingDays;
  if (fromIndex < 0) return { fromDate: null, toDate, gainers: [], losers: [] };
  const fromDate = dates[fromIndex]!;

  const rows: MoverRow[] = [];
  for (const symbol of allSymbols) {
    if (!eligibleSymbols.has(symbol)) continue;
    const series = prices[symbol];
    if (!series) continue;
    const from = series[fromDate];
    const to = series[toDate];
    if (!from || !to) continue;
    if (typeof from.close !== "number" || typeof to.close !== "number") continue;
    if (!Number.isFinite(from.close) || !Number.isFinite(to.close) || from.close <= 0) continue;

    const changePct = ((to.close - from.close) / from.close) * 100;
    rows.push({ symbol, changePct, fromClose: from.close, toClose: to.close });
  }

  const gainers = rows
    .filter((r) => r.changePct > 0)
    .sort((a, b) => b.changePct - a.changePct)
    .slice(0, limit);

  const losers = rows
    .filter((r) => r.changePct < 0)
    .sort((a, b) => a.changePct - b.changePct)
    .slice(0, limit);

  return { fromDate, toDate, gainers, losers };
}

export default function TopMoversWidget() {
  const [active, setActive] = useState<WindowKey>("1D");
  const [activeType, setActiveType] = useState<"gainers" | "losers">("gainers");
  const { prices, loading: pricesLoading } = useStockPrices();
  const { isEligibleUSStock, loading: metadataLoading } = useStockMetadata(100_000_000);

  const eligibleSymbols = useMemo(() => {
    const set = new Set<string>();
    if (metadataLoading) return set;
    for (const symbol of Object.keys(prices)) {
      const upper = symbol.toUpperCase();
      if (isEligibleUSStock(upper)) set.add(upper);
    }
    return set;
  }, [metadataLoading, prices, isEligibleUSStock]);

  const moversByWindow = useMemo(() => {
    // Trading-day offsets: 1D = 1, 1W ~= 5, 1M ~= 21
    const common = { prices, eligibleSymbols, limit: 5 };
    return {
      "1D": computeMoversFromPrices({ ...common, offsetTradingDays: 1 }),
      "1W": computeMoversFromPrices({ ...common, offsetTradingDays: 5 }),
      "1M": computeMoversFromPrices({ ...common, offsetTradingDays: 21 }),
    } as const;
  }, [prices, eligibleSymbols]);

  const current = moversByWindow[active];

  const displaySymbols = useMemo(() => {
    const symbols = new Set<string>();
    for (const r of current.gainers) symbols.add(r.symbol);
    for (const r of current.losers) symbols.add(r.symbol);
    return Array.from(symbols).sort();
  }, [current.gainers, current.losers]);

  const { getLogo } = useCompanyLogos(displaySymbols);

  const loading = pricesLoading || metadataLoading;

  return (
    <div className="bg-surface border border-border-color rounded-2xl pt-6 px-6 pb-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex flex-col">
          <h3 className="font-bold text-foreground text-[11px] uppercase tracking-[0.15em]">Top Movers</h3>
          <p className="text-[10px] text-muted">
            US stocks • Market cap ≥ $1B •{" "}
            {current.toDate ? (
              <span>
                As of {formatDateLabel(current.toDate)} (EOD)
              </span>
            ) : (
              "Date unavailable"
            )}
          </p>
        </div>
        <span className="material-symbols-outlined text-muted">bolt</span>
      </div>

      <div className="flex items-center justify-between mb-3">
        <div className="flex gap-1">
          {(["1D", "1W", "1M"] as const).map((key) => (
            <button
              key={key}
              onClick={() => setActive(key)}
              className={`px-3 py-1.5 text-[11px] font-semibold rounded-2xl transition-colors ${active === key ? "bg-primary text-white" : "text-muted hover:text-foreground hover:bg-surface-highlight"
                }`}
              aria-pressed={active === key}
            >
              {key}
            </button>
          ))}
        </div>

        <div className="flex bg-surface-highlight rounded-2xl border border-border-color overflow-hidden">
          {(["gainers", "losers"] as const).map((type) => (
            <button
              key={type}
              onClick={() => setActiveType(type)}
              className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-all ${activeType === type
                  ? type === "gainers"
                    ? "bg-neon-green/15 text-neon-green"
                    : "bg-neon-red/15 text-neon-red"
                  : "text-muted hover:text-foreground"
                }`}
            >
              {type}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-3">
        {current.fromDate && current.toDate ? (
          <p className="text-[10px] text-muted">
            Window: {formatDateLabel(current.fromDate)} → {formatDateLabel(current.toDate)}
          </p>
        ) : (
          <p className="text-[10px] text-muted">Not enough price history to compute this window.</p>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-10 bg-surface-highlight rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : current.gainers.length === 0 && current.losers.length === 0 ? (
        <div className="text-sm text-muted bg-surface-highlight border border-border-color rounded-2xl p-3">
          No eligible movers found for this window.
        </div>
      ) : (
        <div className="space-y-2">
          {activeType === "gainers" ? (
            current.gainers.length === 0 ? (
              <div className="text-[11px] text-muted bg-surface-highlight border border-border-color rounded-2xl p-2">
                No gainers found for this period
              </div>
            ) : (
              current.gainers.map((row) => {
                const logoUrl = getLogo(row.symbol);
                return (
                  <Link
                    key={row.symbol}
                    href={`/stock/${row.symbol}`}
                    className="flex items-center justify-between bg-surface-highlight border border-border-color rounded-2xl px-2.5 py-2 hover:border-primary/40 transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="size-7 rounded-md bg-surface border border-border-color flex items-center justify-center overflow-hidden">
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
                          <span className="text-[9px] font-bold text-muted">{row.symbol.slice(0, 2)}</span>
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-[12px] font-bold text-foreground leading-none">{row.symbol}</p>
                        <p className="text-[10px] text-muted leading-none mt-1">
                          ${row.fromClose.toFixed(2)} → ${row.toClose.toFixed(2)}
                        </p>
                      </div>
                    </div>
                    <span className="text-[11px] font-black text-neon-green font-mono">{formatPct(row.changePct)}</span>
                  </Link>
                );
              })
            )
          ) : (
            current.losers.length === 0 ? (
              <div className="text-[11px] text-muted bg-surface-highlight border border-border-color rounded-2xl p-2">
                No losers found for this period
              </div>
            ) : (
              current.losers.map((row) => {
                const logoUrl = getLogo(row.symbol);
                return (
                  <Link
                    key={row.symbol}
                    href={`/stock/${row.symbol}`}
                    className="flex items-center justify-between bg-surface-highlight border border-border-color rounded-2xl px-2.5 py-2 hover:border-primary/40 transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="size-7 rounded-md bg-surface border border-border-color flex items-center justify-center overflow-hidden">
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
                          <span className="text-[9px] font-bold text-muted">{row.symbol.slice(0, 2)}</span>
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-[12px] font-bold text-foreground leading-none">{row.symbol}</p>
                        <p className="text-[10px] text-muted leading-none mt-1">
                          ${row.fromClose.toFixed(2)} → ${row.toClose.toFixed(2)}
                        </p>
                      </div>
                    </div>
                    <span className="text-[11px] font-black text-neon-red font-mono">{formatPct(row.changePct)}</span>
                  </Link>
                );
              })
            )
          )}
        </div>
      )}
    </div>
  );
}
