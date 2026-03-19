"use client";

import Link from "next/link";
import React, { useMemo } from "react";

import { useCompanyLogos } from "@/hooks/useCompanyLogos";
import { useIndexQuotes } from "@/hooks/useIndexQuotes";
import { type PriceData, useStockPrices } from "@/hooks/useStockPrices";
import { useStockMetadata, type StockMetadataEntry } from "@/hooks/useStockMetadata";
import { HoverWrapper } from "@/components/StockHoverCard";

type QuoteSpec = {
  label: string;
  symbol: string;
};

type Quote = QuoteSpec & {
  value: number | null;
  changePct: number | null;
  latestDate: string | null;
};

type Mover = {
  symbol: string;
  changePct: number;
  latestClose: number;
};

const ANCHORS: QuoteSpec[] = [
  { label: "S&P 500", symbol: "^GSPC" },
  { label: "NASDAQ", symbol: "^IXIC" },
  { label: "Dow Jones", symbol: "^DJI" },
  { label: "QQQ", symbol: "QQQ" },
  { label: "VIX", symbol: "^VIX" },
  { label: "Russell 2K", symbol: "^RUT" },
];

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPct(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded.toFixed(2)}%`;
}

function getLastTwo(series: Record<string, PriceData> | null): {
  latestDate: string;
  latestClose: number;
  prevClose: number;
} | null {
  if (!series) return null;
  const dates = Object.keys(series).sort();
  if (dates.length < 2) return null;

  const latestDate = dates[dates.length - 1]!;
  const prevDate = dates[dates.length - 2]!;
  const latest = series[latestDate];
  const prev = series[prevDate];
  if (!latest || !prev) return null;
  if (typeof latest.close !== "number" || typeof prev.close !== "number") return null;
  if (!Number.isFinite(latest.close) || !Number.isFinite(prev.close) || prev.close <= 0) return null;

  return { latestDate, latestClose: latest.close, prevClose: prev.close };
}

function computeDailyMovers(params: {
  prices: ReturnType<typeof useStockPrices>["prices"];
  eligibleSymbols: Set<string>;
  limit: number;
}): { toDate: string | null; gainers: Mover[]; losers: Mover[] } {
  const { prices, eligibleSymbols, limit } = params;
  const symbols = Object.keys(prices).map((s) => s.toUpperCase());

  const dateSet = new Set<string>();
  for (const symbol of symbols) {
    const series = prices[symbol];
    if (!series) continue;
    for (const d of Object.keys(series)) dateSet.add(d);
  }
  const dates = Array.from(dateSet).sort();
  if (dates.length < 2) return { toDate: null, gainers: [], losers: [] };

  const toDate = dates[dates.length - 1]!;
  const fromDate = dates[dates.length - 2]!;

  const rows: Mover[] = [];
  for (const symbol of symbols) {
    if (!eligibleSymbols.has(symbol)) continue;
    const series = prices[symbol];
    if (!series) continue;
    const from = series[fromDate];
    const to = series[toDate];
    if (!from || !to) continue;
    if (typeof from.close !== "number" || typeof to.close !== "number") continue;
    if (!Number.isFinite(from.close) || !Number.isFinite(to.close) || from.close <= 0) continue;

    const changePct = ((to.close - from.close) / from.close) * 100;
    if (!Number.isFinite(changePct)) continue;
    rows.push({ symbol, changePct, latestClose: to.close });
  }

  const gainers = rows
    .filter((r) => r.changePct > 0)
    .sort((a, b) => b.changePct - a.changePct)
    .slice(0, limit);

  const losers = rows
    .filter((r) => r.changePct < 0)
    .sort((a, b) => a.changePct - b.changePct)
    .slice(0, limit);

  return { toDate, gainers, losers };
}

function MiniQuoteCard({
  quote,
  loading,
  prices,
  logoUrl,
  metadata,
}: {
  quote: Quote;
  loading: boolean;
  prices: ReturnType<typeof useStockPrices>["prices"];
  logoUrl: string | null;
  metadata?: StockMetadataEntry | null;
}) {
  const isUp = (quote.changePct ?? 0) >= 0;
  const hasValue = typeof quote.value === "number" && Number.isFinite(quote.value);
  const valueText = loading ? "…" : hasValue ? formatNumber(quote.value!) : "--";
  const pctText =
    loading ? "" : typeof quote.changePct === "number" && Number.isFinite(quote.changePct) ? formatPct(quote.changePct) : "--";

  const content = (
    <div className="flex items-center gap-1.5 rounded-full border border-border-color bg-surface-highlight/50 px-2 py-1 cursor-pointer hover:border-primary/40 transition-colors flex-none">
      <div className="size-4 rounded-full bg-surface border border-border-color flex items-center justify-center overflow-hidden flex-none">
        {logoUrl ? (
          <img
            src={logoUrl}
            alt=""
            className="w-3 h-3 object-contain"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <span className="text-[7px] font-bold text-muted">{quote.symbol.slice(0, 2)}</span>
        )}
      </div>
      <span className="text-[9px] font-black text-foreground leading-none whitespace-nowrap">{quote.label}</span>
      <span className="text-[9px] font-bold text-muted/90 font-mono tabular-nums leading-none">{valueText}</span>
      <span
        className={`text-[9px] font-black font-mono tabular-nums leading-none ${!pctText || pctText === "--" ? "text-muted" : isUp ? "text-neon-green" : "text-neon-red"
          }`}
      >
        {pctText}
      </span>
    </div>
  );

  if (loading) {
    return content;
  }

  return (
    <HoverWrapper
      symbol={quote.symbol}
      label={quote.label}
      price={quote.value}
      changePct={quote.changePct}
      prices={prices}
      logoUrl={logoUrl}
      metadata={metadata}
    >
      <Link href={`/stock/${quote.symbol}`}>{content}</Link>
    </HoverWrapper>
  );
}

function MoverChip({
  symbol,
  changePct,
  price,
  logoUrl,
  prices,
  metadata,
}: {
  symbol: string;
  changePct: number;
  price: number;
  logoUrl: string | null;
  prices: ReturnType<typeof useStockPrices>["prices"];
  metadata?: StockMetadataEntry | null;
}) {
  const isUp = changePct >= 0;
  const pct = formatPct(changePct);

  const content = (
    <Link
      href={`/stock/${symbol}`}
      className="flex items-center gap-1.5 rounded-full border border-border-color bg-surface-highlight/40 px-2 py-1 hover:border-primary/40 transition-colors flex-none"
      aria-label={`${symbol} ${pct}`}
    >
      <div className="size-4 rounded-full bg-surface border border-border-color flex items-center justify-center overflow-hidden flex-none">
        {logoUrl ? (
          <img
            src={logoUrl}
            alt=""
            className="w-3 h-3 object-contain"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <span className="text-[7px] font-bold text-muted">{symbol.slice(0, 2)}</span>
        )}
      </div>
      <span className="text-[9px] font-black text-foreground leading-none whitespace-nowrap">{symbol}</span>
      <span className="text-[9px] font-bold text-muted/90 font-mono tabular-nums leading-none">{formatNumber(price)}</span>
      <span className={`text-[9px] font-black font-mono tabular-nums leading-none ${isUp ? "text-neon-green" : "text-neon-red"}`}>
        {pct}
      </span>
    </Link>
  );

  return (
    <HoverWrapper
      symbol={symbol}
      price={price}
      changePct={changePct}
      prices={prices}
      logoUrl={logoUrl}
      metadata={metadata}
    >
      {content}
    </HoverWrapper>
  );
}

export default function MarketMarquee() {
  const { prices, loading: pricesLoading } = useStockPrices();
  const { quotes: liveIndices, loading: indicesLoading } = useIndexQuotes();
  const { isEligibleUSStock, getMetadata, loading: metadataLoading } = useStockMetadata(100_000_000);

  const eligibleSymbols = useMemo(() => {
    const set = new Set<string>();
    if (metadataLoading) return set;
    for (const symbol of Object.keys(prices)) {
      const upper = symbol.toUpperCase();
      if (isEligibleUSStock(upper)) set.add(upper);
    }
    return set;
  }, [metadataLoading, prices, isEligibleUSStock]);

  const { toDate, gainers, losers } = useMemo(() => {
    return computeDailyMovers({ prices, eligibleSymbols, limit: 10 });
  }, [prices, eligibleSymbols]);

  // Build a map from live index quotes for quick lookup
  const liveIndexMap = useMemo(() => {
    const map = new Map<string, { price: number; changePct: number }>();
    for (const q of liveIndices) {
      map.set(q.symbol, { price: q.price, changePct: q.changePct });
    }
    return map;
  }, [liveIndices]);

  const anchors = useMemo<Quote[]>(() => {
    return ANCHORS.map((spec) => {
      // Prefer live data from the API
      const live = liveIndexMap.get(spec.symbol);
      if (live) {
        return { ...spec, value: live.price, changePct: live.changePct, latestDate: null };
      }
      // Fall back to static EOD data
      const series = prices[spec.symbol];
      const lastTwo = getLastTwo(series ?? null);
      if (!lastTwo) return { ...spec, value: null, changePct: null, latestDate: null };
      const changePct = ((lastTwo.latestClose - lastTwo.prevClose) / lastTwo.prevClose) * 100;
      return { ...spec, value: lastTwo.latestClose, changePct, latestDate: lastTwo.latestDate };
    });
  }, [liveIndexMap, prices]);

  const marqueeSymbols = useMemo(() => {
    const set = new Set<string>();
    for (const r of gainers) set.add(r.symbol);
    for (const r of losers) set.add(r.symbol);
    // Add anchor symbols for logos
    for (const a of ANCHORS) set.add(a.symbol);
    return Array.from(set).sort();
  }, [gainers, losers]);

  const { getLogo } = useCompanyLogos(marqueeSymbols);

  const marqueeItems = useMemo(() => {
    const items: Array<
      | { type: "label"; text: string }
      | { type: "mover"; symbol: string; changePct: number; price: number }
    > = [];

    if (gainers.length) {
      items.push({ type: "label", text: "▲" });
      for (const r of gainers) items.push({ type: "mover", symbol: r.symbol, changePct: r.changePct, price: r.latestClose });
    }
    if (losers.length) {
      items.push({ type: "label", text: "▼" });
      for (const r of losers) items.push({ type: "mover", symbol: r.symbol, changePct: r.changePct, price: r.latestClose });
    }

    return items;
  }, [gainers, losers]);

  const marqueeDuration = useMemo(() => {
    // Keep speed consistent as the list grows.
    const moverCount = gainers.length + losers.length;
    return Math.max(28, Math.min(70, moverCount * 3.2));
  }, [gainers.length, losers.length]);

  const marqueeStyle = useMemo(() => {
    return { ["--marquee-duration" as never]: `${marqueeDuration}s` } as React.CSSProperties;
  }, [marqueeDuration]);

  const loading = (pricesLoading && indicesLoading) || metadataLoading;

  const content = (
    <div className="flex items-center gap-1.5 pr-2">
      {loading ? (
        <>
          <span className="h-5 w-16 rounded-full bg-surface-highlight border border-border-color animate-pulse" />
          <span className="h-5 w-20 rounded-full bg-surface-highlight border border-border-color animate-pulse" />
          <span className="h-5 w-18 rounded-full bg-surface-highlight border border-border-color animate-pulse" />
        </>
      ) : (
        marqueeItems.map((item, idx) => {
          if (item.type === "label") {
            return (
              <span
                key={`label-${idx}-${item.text}`}
                className={`text-[9px] font-black px-1.5 py-0.5 rounded-full border border-border-color bg-surface flex-none ${item.text === "▲" ? "text-neon-green" : "text-neon-red"
                  }`}
              >
                {item.text}
              </span>
            );
          }
          const logoUrl = getLogo(item.symbol);
          return (
            <MoverChip
              key={`mover-${item.symbol}-${idx}`}
              symbol={item.symbol}
              changePct={item.changePct}
              price={item.price}
              logoUrl={logoUrl}
              prices={prices}
              metadata={getMetadata(item.symbol)}
            />
          );
        })
      )}
    </div>
  );

  return (
    <div className="rounded-2xl border border-border-color bg-surface overflow-hidden">
      <div className="flex flex-col md:flex-row">
        <div className="md:w-1/3 p-2 border-b md:border-b-0 md:border-r border-border-color">
          <div className="flex gap-1.5 overflow-x-auto scrollbar-thin">
            {anchors.map((quote) => (
              <MiniQuoteCard
                key={quote.symbol}
                quote={quote}
                loading={pricesLoading}
                prices={prices}
                logoUrl={getLogo(quote.symbol)}
                metadata={getMetadata(quote.symbol)}
              />
            ))}
          </div>
        </div>

        <div className="md:w-2/3 relative">
          {/* Fade edges */}
          <div className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-surface to-transparent z-10" />
          <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-surface to-transparent z-10" />

          <div className="marquee py-2" style={marqueeStyle}>
            <div className="marquee__track">
              {content}
              {content}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
