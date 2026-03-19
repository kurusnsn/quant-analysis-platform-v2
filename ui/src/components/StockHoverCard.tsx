"use client";

import React, { useMemo, useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";

import { IconTrendingDown, IconTrendingUp } from "@/components/Icons";
import { SparklineChart } from "@/components/SparklineChart";
import { useClientNow } from "@/hooks/useClientNow";
import { type PriceData, useStockPrices } from "@/hooks/useStockPrices";
import { type StockMetadataEntry } from "@/hooks/useStockMetadata";
import { useStockNews, type NewsArticle } from "@/hooks/useStockNews";

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

export function StockHoverCard({
  symbol,
  label,
  price,
  changePct,
  priceHistory,
  logoUrl,
  companyName,
  metadata,
  latestNews,
}: {
  symbol: string;
  label?: string;
  price: number | null;
  changePct: number | null;
  priceHistory: number[];
  logoUrl: string | null;
  companyName?: string;
  metadata?: StockMetadataEntry | null;
  latestNews?: NewsArticle | null;
}) {
  const now = useClientNow(60_000);
  const isUp = (changePct ?? 0) >= 0;
  const displayName = label || symbol;
  const sector = metadata?.sector;
  const industry = metadata?.industry;

  const formatTimeAgo = (timestamp: number | string | undefined) => {
    if (!timestamp) return null;
    let ts: number;
    if (typeof timestamp === "string") {
      const num = Number(timestamp);
      if (!Number.isNaN(num)) {
        ts = num > 1e12 ? Math.floor(num / 1000) : num;
      } else {
        const dateMs = Date.parse(timestamp);
        if (Number.isNaN(dateMs)) return null;
        ts = Math.floor(dateMs / 1000);
      }
    } else {
      ts = timestamp > 1e12 ? Math.floor(timestamp / 1000) : timestamp;
    }
    if (!ts || isNaN(ts)) return null;
    if (now === null) return "recently";
    const seconds = Math.floor(now / 1000 - ts);
    if (seconds < 60) return "just now";
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  };

  return (
    <div className="w-80 bg-surface border border-border-color rounded-2xl shadow-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-border-color bg-surface-highlight/30">
        <div className="flex items-center gap-3">
          <div className="size-8 rounded-md bg-surface border border-border-color flex items-center justify-center overflow-hidden flex-none">
            {logoUrl ? (
              <img src={logoUrl} alt="" className="w-6 h-6 object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
            ) : (
              <span className="text-[10px] font-bold text-muted">{symbol.slice(0, 2)}</span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-foreground truncate">{displayName}</p>
            {companyName && companyName !== displayName && (
              <p className="text-[10px] text-muted truncate">{companyName}</p>
            )}
          </div>
        </div>
      </div>

      {(sector || industry) && (
        <div className="px-4 py-2 border-b border-border-color bg-surface-highlight/20">
          <div className="flex items-center gap-2 text-[10px]">
            {sector && <span className="px-2 py-0.5 rounded-md bg-primary/10 text-primary font-semibold">{sector}</span>}
            {industry && <span className="text-muted truncate">{industry}</span>}
          </div>
        </div>
      )}

      {priceHistory.length > 2 && (
        <div className="px-3 py-2 h-20">
          <SparklineChart data={priceHistory} isPositive={isUp} color={isUp ? "var(--neon-green)" : "var(--neon-red)"} />
        </div>
      )}

      <div className="px-4 py-3 border-t border-border-color flex items-center justify-between">
        <div>
          <p className="text-[10px] font-semibold text-muted uppercase tracking-wider">Price</p>
          <p className="text-base font-black text-foreground tabular-nums">{price !== null ? `$${formatNumber(price)}` : "--"}</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-semibold text-muted uppercase tracking-wider">Change</p>
          <p className={`text-base font-black tabular-nums flex items-center justify-end gap-1 ${isUp ? "text-neon-green" : "text-neon-red"}`}>
            {isUp ? <IconTrendingUp className="w-4 h-4" /> : <IconTrendingDown className="w-4 h-4" />}
            {changePct !== null ? formatPct(changePct) : "--"}
          </p>
        </div>
      </div>

      {latestNews && (
        <div className="px-4 py-3 border-t border-border-color">
          <p className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-1.5">Latest News</p>
          <a href={latestNews.link} target="_blank" rel="noopener noreferrer" className="block hover:bg-surface-highlight/50 -mx-1 px-1 py-1 rounded transition-colors" onClick={(e) => e.stopPropagation()}>
            <p className="text-[11px] font-semibold text-foreground line-clamp-2 leading-snug">{latestNews.title}</p>
            <p className="text-[9px] text-muted mt-1">
              {latestNews.publisher}
              {latestNews.providerPublishTime && <span> · {formatTimeAgo(latestNews.providerPublishTime)}</span>}
            </p>
          </a>
        </div>
      )}

      <div className="px-4 py-2 border-t border-border-color">
        <p className="text-[9px] text-muted text-center">Click to view details</p>
      </div>
    </div>
  );
}

export function HoverCardContent({
  symbol,
  label,
  price,
  changePct,
  priceHistory,
  logoUrl,
  companyName,
  metadata,
}: {
  symbol: string;
  label?: string;
  price: number | null;
  changePct: number | null;
  priceHistory: number[];
  logoUrl: string | null;
  companyName?: string;
  metadata?: StockMetadataEntry | null;
}) {
  const { news } = useStockNews(symbol, 1);
  const latestNews = news.length > 0 ? news[0] : null;

  return (
    <StockHoverCard
      symbol={symbol}
      label={label}
      price={price}
      changePct={changePct}
      priceHistory={priceHistory}
      logoUrl={logoUrl}
      companyName={companyName}
      metadata={metadata}
      latestNews={latestNews}
    />
  );
}

export function HoverWrapper({
  children,
  symbol,
  label,
  price,
  changePct,
  prices,
  logoUrl,
  companyName,
  metadata,
}: {
  children: React.ReactNode;
  symbol: string;
  label?: string;
  price: number | null;
  changePct: number | null;
  prices: ReturnType<typeof useStockPrices>["prices"];
  logoUrl: string | null;
  companyName?: string;
  metadata?: StockMetadataEntry | null;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const hoverTimeout = useRef<NodeJS.Timeout | null>(null);

  const priceHistory = useMemo(() => {
    const series = prices[symbol];
    if (!series) return [];
    const dates = Object.keys(series).sort();
    const recentDates = dates.slice(-20);
    return recentDates.map((d) => series[d]?.close ?? 0).filter((v) => v > 0);
  }, [prices, symbol]);

  const handleMouseEnter = () => {
    if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
    hoverTimeout.current = setTimeout(() => {
      if (ref.current) {
        const rect = ref.current.getBoundingClientRect();
        setPosition({
          top: rect.bottom + 8,
          left: Math.max(8, rect.left - 100),
        });
      }
      setIsHovered(true);
    }, 300);
  };

  const handleMouseLeave = () => {
    if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
    hoverTimeout.current = setTimeout(() => {
      setIsHovered(false);
    }, 100);
  };

  useEffect(() => {
    return () => {
      if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
    };
  }, []);

  return (
    <span
      ref={ref}
      className="relative inline-flex"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {children}
      {isHovered && position && typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed z-[9999] animate-in fade-in zoom-in-95 duration-150"
            style={{ top: position.top, left: position.left }}
            onMouseEnter={() => { if (hoverTimeout.current) clearTimeout(hoverTimeout.current); }}
            onMouseLeave={handleMouseLeave}
          >
            <HoverCardContent
              symbol={symbol}
              label={label}
              price={price}
              changePct={changePct}
              priceHistory={priceHistory}
              logoUrl={logoUrl}
              companyName={companyName}
              metadata={metadata}
            />
          </div>,
          document.body
        )}
    </span>
  );
}
