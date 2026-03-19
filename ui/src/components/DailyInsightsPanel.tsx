"use client";
import { devConsole } from "@/lib/devLog";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { authFetch } from "@/lib/authFetch";
import { useDailyInsights } from "@/hooks/useDailyInsights";
import { useStockPrices } from "@/hooks/useStockPrices";
import ShareDownloadButtons from "@/components/ShareDownloadButtons";
import CopyButton from "@/components/CopyButton";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import FeatureGateOverlay from "@/components/FeatureGateOverlay";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

interface DailyInsightsPanelProps {
  watchlistId: string;
  tickers?: string[];
}

type WatchlistSentimentSummary = {
  label: string;
  positive: number;
  negative: number;
  neutral: number;
  covered: number;
  requested: number;
};

type WatchlistHeadline = {
  ticker: string;
  title: string;
  publisher: string;
  link: string;
  providerPublishTime: number | string | null;
};

function toEpochSeconds(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1e12 ? Math.floor(value / 1000) : value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed > 1e12 ? Math.floor(parsed / 1000) : parsed;
    }
  }
  return 0;
}

function formatSignedPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "N/A";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatPublishTime(value: WatchlistHeadline["providerPublishTime"]): string {
  const seconds = toEpochSeconds(value);
  if (!seconds) return "";
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function DailyInsightsPanel({ watchlistId, tickers = [] }: DailyInsightsPanelProps) {
  const { insights, loading, error } = useDailyInsights(watchlistId);
  const { canUseLLM, reason: accessReason, isLoading: accessLoading } = useFeatureAccess();
  const [expandedStocks, setExpandedStocks] = useState<Set<string>>(new Set());
  const { prices } = useStockPrices();

  const symbols = useMemo(() => {
    const deduped = new Set<string>();
    for (const raw of tickers) {
      const symbol = raw?.trim().toUpperCase();
      if (!symbol) continue;
      deduped.add(symbol);
    }
    return Array.from(deduped);
  }, [tickers]);

  const priceMoves = useMemo(() => {
    return symbols.map((symbol) => {
      const series = prices[symbol];
      if (!series) {
        return { symbol, latestClose: null as number | null, dayChangePct: null as number | null };
      }

      const dates = Object.keys(series).sort();
      const latestDate = dates.length ? dates[dates.length - 1] : null;
      const prevDate = dates.length > 1 ? dates[dates.length - 2] : null;
      const latest = latestDate ? series[latestDate] : null;
      const prev = prevDate ? series[prevDate] : null;

      const latestClose = typeof latest?.close === "number" && Number.isFinite(latest.close) ? latest.close : null;
      let dayChangePct: number | null = null;
      if (latest && prev && Number.isFinite(prev.close) && prev.close !== 0 && Number.isFinite(latest.close)) {
        dayChangePct = ((latest.close - prev.close) / prev.close) * 100;
      }

      return { symbol, latestClose, dayChangePct };
    });
  }, [prices, symbols]);

  const priceMoveSummary = useMemo(() => {
    const withMoves = priceMoves.filter(
      (row) => typeof row.dayChangePct === "number" && Number.isFinite(row.dayChangePct)
    );

    const sorted = [...withMoves].sort((a, b) => (b.dayChangePct ?? 0) - (a.dayChangePct ?? 0));
    const topGainer = sorted[0] ?? null;
    const topLaggard = sorted.length ? sorted[sorted.length - 1] : null;

    const avgDayMove = withMoves.length
      ? withMoves.reduce((sum, row) => sum + (row.dayChangePct ?? 0), 0) / withMoves.length
      : null;

    const counts = withMoves.reduce(
      (acc, row) => {
        const pct = row.dayChangePct ?? 0;
        if (pct > 0.1) acc.up += 1;
        else if (pct < -0.1) acc.down += 1;
        else acc.flat += 1;
        return acc;
      },
      { up: 0, down: 0, flat: 0 }
    );

    return {
      pricedCount: withMoves.length,
      requestedCount: symbols.length,
      avgDayMove,
      topGainer,
      topLaggard,
      ...counts,
    };
  }, [priceMoves, symbols.length]);

  const priceMoveBySymbol = useMemo(() => {
    const map = new Map<string, { dayChangePct: number | null; latestClose: number | null }>();
    for (const item of priceMoves) {
      map.set(item.symbol, { dayChangePct: item.dayChangePct, latestClose: item.latestClose });
    }
    return map;
  }, [priceMoves]);

  const newsTickers = useMemo(() => {
    if (!symbols.length) return [] as string[];

    const prioritized = [...priceMoves]
      .filter((row) => typeof row.dayChangePct === "number" && Number.isFinite(row.dayChangePct))
      .sort((a, b) => Math.abs(b.dayChangePct ?? 0) - Math.abs(a.dayChangePct ?? 0))
      .map((row) => row.symbol);

    return Array.from(new Set([...prioritized, ...symbols])).slice(0, 6);
  }, [priceMoves, symbols]);

  const watchlistNews = useQuery({
    queryKey: ["watchlistNewsSummary", watchlistId, newsTickers.join(",")],
    enabled: newsTickers.length > 0,
    queryFn: async ({ signal }) => {
      const newsPromises = newsTickers.map(async (ticker) => {
        try {
          const response = await authFetch(`${API_URL}/stocks/${ticker}/news?limit=3`, { signal });
          if (!response.ok) return [] as WatchlistHeadline[];
          const payload = (await response.json()) as { news?: Array<Record<string, unknown>> };
          const news = Array.isArray(payload.news) ? payload.news : [];
          return news
            .map((article) => {
              const title = typeof article.title === "string" ? article.title : "";
              const publisher = typeof article.publisher === "string" ? article.publisher : "";
              const link = typeof article.link === "string" ? article.link : "";
              const providerPublishTime = (article.providerPublishTime ?? null) as WatchlistHeadline["providerPublishTime"];

              if (!title || !link) return null;
              return { ticker, title, publisher, link, providerPublishTime } satisfies WatchlistHeadline;
            })
            .filter((article): article is WatchlistHeadline => article !== null);
        } catch (err) {
          if (!(err instanceof Error && err.name === "AbortError")) {
            devConsole.warn(`Failed to fetch watchlist news for ${ticker}:`, err);
          }
          return [] as WatchlistHeadline[];
        }
      });

      const rows = await Promise.all(newsPromises);
      const allNews = rows.flat();

      const seen = new Set<string>();
      const unique = allNews.filter((article) => {
        const key = `${article.title}::${article.link}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      unique.sort((a, b) => toEpochSeconds(b.providerPublishTime) - toEpochSeconds(a.providerPublishTime));
      return unique.slice(0, 6);
    },
    staleTime: 60 * 1000,
  });

  const sentimentTickers = useMemo(() => symbols.slice(0, 8), [symbols]);

  const watchlistSentiment = useQuery({
    queryKey: ["watchlistSentimentSummary", watchlistId, sentimentTickers.join(",")],
    enabled: sentimentTickers.length > 0,
    queryFn: async ({ signal }) => {
      type SentimentSummary = { label?: string; positive?: number; negative?: number; neutral?: number };
      type StockSentimentResponse = { ticker: string; news_sentiment?: SentimentSummary };

      const sentimentRows = await Promise.all(
        sentimentTickers.map(async (symbol) => {
          try {
            const response = await authFetch(`${API_URL}/stocks/${symbol}/sentiment`, { signal });
            if (!response.ok) return null;
            return (await response.json()) as StockSentimentResponse;
          } catch (queryError) {
            if (queryError instanceof Error && queryError.name === "AbortError") {
              throw queryError;
            }
            return null;
          }
        })
      );

      const covered = sentimentRows.reduce<StockSentimentResponse[]>((acc, item) => {
        if (!item) return acc;
        const news = item.news_sentiment;
        if (
          typeof news?.positive === "number" &&
          typeof news.negative === "number" &&
          typeof news.neutral === "number"
        ) {
          acc.push(item);
        }
        return acc;
      }, []);

      if (!covered.length) return null as WatchlistSentimentSummary | null;

      const totals = covered.reduce(
        (acc, item) => {
          acc.positive += item.news_sentiment?.positive ?? 0;
          acc.negative += item.news_sentiment?.negative ?? 0;
          acc.neutral += item.news_sentiment?.neutral ?? 0;
          return acc;
        },
        { positive: 0, negative: 0, neutral: 0 }
      );

      const count = covered.length;
      const positive = totals.positive / count;
      const negative = totals.negative / count;
      const neutral = totals.neutral / count;

      const label = (
        [
          { key: "positive", value: positive },
          { key: "negative", value: negative },
          { key: "neutral", value: neutral },
        ].sort((a, b) => b.value - a.value)[0]?.key ?? "neutral"
      ).toLowerCase();

      return {
        label,
        positive,
        negative,
        neutral,
        covered: count,
        requested: sentimentTickers.length,
      } satisfies WatchlistSentimentSummary;
    },
    staleTime: 2 * 60 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
  });

  const toggleStock = (ticker: string) => {
    const newExpanded = new Set(expandedStocks);
    if (newExpanded.has(ticker)) {
      newExpanded.delete(ticker);
    } else {
      newExpanded.add(ticker);
    }
    setExpandedStocks(newExpanded);
  };

  if (loading) {
    return (
      <div className="bg-surface border border-border-color rounded-2xl p-6">
        <div className="flex items-center gap-2 mb-4">
          <span className="material-symbols-outlined text-primary animate-pulse">auto_awesome</span>
          <h2 className="text-lg font-bold text-foreground">Daily Insights</h2>
        </div>
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-20 bg-surface-highlight rounded animate-pulse"></div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-surface border border-border-color rounded-2xl p-6">
        <h2 className="text-lg font-bold text-foreground mb-4">Daily Insights</h2>
        <div className="text-center py-8 text-muted">
          <span className="material-symbols-outlined text-4xl mb-2 opacity-50">error</span>
          <p className="text-sm">Unable to load insights</p>
        </div>
      </div>
    );
  }

  if (!insights) {
    return (
      <div className="bg-surface border border-border-color rounded-2xl p-6">
        <h2 className="text-lg font-bold text-foreground mb-4">Daily Insights</h2>
        <div className="text-center py-8 text-muted">
          <span className="material-symbols-outlined text-4xl mb-2 opacity-50">schedule</span>
          <p className="text-sm">No insights available yet</p>
          <p className="text-xs mt-2">Run analysis to generate an AI summary for this watchlist.</p>
        </div>
      </div>
    );
  }

  const shareableContent = useMemo(() => {
    const lines: string[] = [];
    lines.push("Daily AI Insights");
    lines.push("=".repeat(40));
    if (insights.lastUpdated) {
      lines.push(`Generated: ${new Date(insights.lastUpdated).toLocaleString()}`);
    }
    lines.push("");

    if (symbols.length > 0 && priceMoveSummary.pricedCount > 0) {
      lines.push("MARKET SNAPSHOT");
      lines.push(`Breadth: ${priceMoveSummary.up} up / ${priceMoveSummary.down} down / ${priceMoveSummary.flat} flat`);
      lines.push(`Avg 1D Move: ${formatSignedPercent(priceMoveSummary.avgDayMove)}`);
      if (priceMoveSummary.topGainer?.symbol) {
        lines.push(
          `Top Gainer: ${priceMoveSummary.topGainer.symbol} ${formatSignedPercent(priceMoveSummary.topGainer.dayChangePct)}`
        );
      }
      if (priceMoveSummary.topLaggard?.symbol) {
        lines.push(
          `Top Laggard: ${priceMoveSummary.topLaggard.symbol} ${formatSignedPercent(priceMoveSummary.topLaggard.dayChangePct)}`
        );
      }
      lines.push("");
    }

    if (insights.watchlistNarrative) {
      lines.push("PORTFOLIO OVERVIEW");
      lines.push(insights.watchlistNarrative);
      lines.push("");
    }

    if (watchlistSentiment.data) {
      lines.push("NEWS SENTIMENT");
      lines.push(
        `${watchlistSentiment.data.label.toUpperCase()} (${Math.round(watchlistSentiment.data.positive * 100)}% +, ${Math.round(
          watchlistSentiment.data.neutral * 100
        )}% =, ${Math.round(watchlistSentiment.data.negative * 100)}% -; ${watchlistSentiment.data.covered}/${watchlistSentiment.data.requested
        } covered)`
      );
      lines.push("");
    }

    const headlines = watchlistNews.data ?? [];
    if (headlines.length > 0) {
      lines.push("NEWS PULSE");
      for (const item of headlines) {
        lines.push(`- ${item.ticker}: ${item.title}`);
      }
      lines.push("");
    }

    for (const stock of insights.stockAnalyses) {
      lines.push(`${stock.ticker} (${stock.sentiment || "Neutral"})`);
      if (stock.narrative) {
        lines.push(stock.narrative);
      }
      lines.push(
        `Volatility: ${(stock.volatility * 100).toFixed(2)}% | Sharpe: ${stock.sharpe.toFixed(2)} | VaR95: ${(stock.var95 * 100).toFixed(2)}%`
      );
      lines.push("");
    }

    return lines.join("\n");
  }, [
    insights,
    priceMoveSummary,
    symbols.length,
    watchlistNews.data,
    watchlistSentiment.data,
  ]);

  const getSentimentColor = (sentiment: string | null) => {
    switch (sentiment?.toLowerCase()) {
      case "positive":
        return "text-[#00ff41]";
      case "negative":
        return "text-[#ff0055]";
      default:
        return "text-muted";
    }
  };

  const getSentimentIcon = (sentiment: string | null) => {
    switch (sentiment?.toLowerCase()) {
      case "positive":
        return "trending_up";
      case "negative":
        return "trending_down";
      default:
        return "trending_flat";
    }
  };

  return (
    <div className="bg-gradient-to-br from-primary/5 to-primary/10 border border-primary/30 rounded-xl p-6 relative min-h-[300px]">
      {!canUseLLM && !accessLoading && (
        <FeatureGateOverlay reason={accessReason} featureLabel="Daily AI Insights" />
      )}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-primary">auto_awesome</span>
          <h2 className="text-lg font-bold text-foreground">Daily AI Insights</h2>
        </div>
        <div className="flex items-center gap-2">
          <CopyButton getText={() => shareableContent} label="Copy" />
          <ShareDownloadButtons
            content={shareableContent}
            title="Daily AI Insights"
            filename={`watchlist-insights-${new Date().toISOString().slice(0, 10)}`}
            variant="compact"
          />
          {insights.lastUpdated && (
            <span className="text-xs text-muted">
              {new Date(insights.lastUpdated).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </span>
          )}
        </div>
      </div>

      {/* Market Snapshot */}
      {symbols.length > 0 ? (
        <div className="mb-6 grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-surface-highlight/60 border border-border-color rounded-2xl p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted mb-1">Breadth</p>
            <p className="text-sm font-mono font-semibold text-foreground">
              {priceMoveSummary.pricedCount > 0
                ? `${priceMoveSummary.up}↑ ${priceMoveSummary.down}↓ ${priceMoveSummary.flat}→`
                : "N/A"}
            </p>
            <p className="text-[10px] text-muted mt-1">
              Priced {priceMoveSummary.pricedCount}/{priceMoveSummary.requestedCount}
            </p>
          </div>
          <div className="bg-surface-highlight/60 border border-border-color rounded-2xl p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted mb-1">Avg 1D Move</p>
            <p className="text-sm font-mono font-semibold text-foreground">{formatSignedPercent(priceMoveSummary.avgDayMove)}</p>
          </div>
          <div className="bg-surface-highlight/60 border border-border-color rounded-2xl p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted mb-1">Top Gainer</p>
            <p className="text-sm font-mono font-semibold text-foreground">
              {priceMoveSummary.topGainer
                ? `${priceMoveSummary.topGainer.symbol} ${formatSignedPercent(priceMoveSummary.topGainer.dayChangePct)}`
                : "N/A"}
            </p>
          </div>
          <div className="bg-surface-highlight/60 border border-border-color rounded-2xl p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted mb-1">Top Laggard</p>
            <p className="text-sm font-mono font-semibold text-foreground">
              {priceMoveSummary.topLaggard
                ? `${priceMoveSummary.topLaggard.symbol} ${formatSignedPercent(priceMoveSummary.topLaggard.dayChangePct)}`
                : "N/A"}
            </p>
          </div>
        </div>
      ) : null}

      {/* Watchlist-Level Narrative */}
      {insights.watchlistNarrative ? (
        <div className="mb-6 p-4 bg-surface/50 rounded-2xl border border-border-color/30">
          <div className="flex items-start gap-2 mb-2">
            <span className="material-symbols-outlined text-primary text-sm mt-0.5">analytics</span>
            <p className="text-xs font-semibold text-muted uppercase tracking-wider">Portfolio Overview</p>
          </div>
          <p className="text-sm text-foreground leading-relaxed">{insights.watchlistNarrative}</p>
        </div>
      ) : (
        <div className="mb-6 p-4 bg-surface/50 rounded-2xl border border-border-color/30">
          <p className="text-sm text-muted">
            No watchlist narrative yet. Run analysis to generate an AI summary.
          </p>
        </div>
      )}

      {/* Sentiment + News */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <div className="bg-surface/70 rounded-2xl border border-border-color/30 p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-muted uppercase tracking-wider">News Sentiment</p>
            {watchlistSentiment.isFetching ? (
              <span className="text-[10px] text-muted">Loading...</span>
            ) : watchlistSentiment.data ? (
              <span className="text-[10px] text-muted">
                {watchlistSentiment.data.covered}/{watchlistSentiment.data.requested} covered
              </span>
            ) : (
              <span className="text-[10px] text-muted">Unavailable</span>
            )}
          </div>

          {watchlistSentiment.data ? (
            <>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-foreground capitalize">{watchlistSentiment.data.label}</span>
                <span className="text-xs text-muted">
                  {Math.round(watchlistSentiment.data.positive * 100)}% +{" | "}
                  {Math.round(watchlistSentiment.data.neutral * 100)}% ={" | "}
                  {Math.round(watchlistSentiment.data.negative * 100)}% -
                </span>
              </div>
              <div className="mt-3 h-2 w-full rounded-full overflow-hidden bg-surface-highlight/60 border border-border-color/40">
                <div className="h-full flex">
                  <div
                    className="h-full bg-[#00ff41]/70"
                    style={{ width: `${Math.max(0, Math.min(100, watchlistSentiment.data.positive * 100))}%` }}
                  />
                  <div
                    className="h-full bg-foreground/20"
                    style={{ width: `${Math.max(0, Math.min(100, watchlistSentiment.data.neutral * 100))}%` }}
                  />
                  <div
                    className="h-full bg-[#ff0055]/70"
                    style={{ width: `${Math.max(0, Math.min(100, watchlistSentiment.data.negative * 100))}%` }}
                  />
                </div>
              </div>
              <p className="text-[10px] text-muted mt-2">
                FinBERT sentiment derived from current news feed for up to {sentimentTickers.length} holdings.
              </p>
            </>
          ) : (
            <p className="text-sm text-muted">Sentiment is unavailable from the current news feed.</p>
          )}
        </div>

        <div className="bg-surface/70 rounded-2xl border border-border-color/30 p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-muted uppercase tracking-wider">News Pulse</p>
            {watchlistNews.isFetching ? (
              <span className="text-[10px] text-muted">Loading...</span>
            ) : (
              <span className="text-[10px] text-muted">{(watchlistNews.data ?? []).length} headlines</span>
            )}
          </div>

          {watchlistNews.error ? (
            <p className="text-sm text-muted">Unable to load news right now.</p>
          ) : (watchlistNews.data ?? []).length === 0 ? (
            <p className="text-sm text-muted">No recent headlines found for this watchlist.</p>
          ) : (
            <div className="space-y-2">
              {(watchlistNews.data ?? []).map((article) => (
                <a
                  key={`${article.ticker}:${article.link}`}
                  href={article.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block rounded-2xl border border-border-color/40 bg-surface-highlight/40 hover:bg-surface-highlight/60 transition-colors p-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-primary">{article.ticker}</span>
                    <span className="text-[10px] text-muted">{formatPublishTime(article.providerPublishTime)}</span>
                  </div>
                  <p className="text-xs text-foreground font-semibold leading-snug mt-1 line-clamp-2">{article.title}</p>
                  {article.publisher ? <p className="text-[10px] text-muted mt-1">{article.publisher}</p> : null}
                </a>
              ))}
              <p className="text-[10px] text-muted">Full feed is available in the watchlist News tab.</p>
            </div>
          )}
        </div>
      </div>

      {/* Per-Stock Insights */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">
          Stock Analysis ({insights.stockAnalyses.length})
        </p>

        {insights.stockAnalyses.length === 0 ? (
          <div className="text-sm text-muted border border-border-color/40 bg-surface/60 rounded-2xl p-4">
            <p className="font-semibold text-foreground mb-1">Portfolio overview is available.</p>
            <p>
              Per-stock AI snapshots haven&apos;t been generated yet (they usually populate after the daily run). If you
              just ran analysis, refresh in a moment.
            </p>
          </div>
        ) : null}

        {insights.stockAnalyses.map((stock) => {
          const isExpanded = expandedStocks.has(stock.ticker);
          const move = priceMoveBySymbol.get(stock.ticker.toUpperCase());

          return (
            <div
              key={stock.ticker}
              className="bg-surface/70 rounded-2xl border border-border-color/30 overflow-hidden transition-all"
            >
              {/* Stock Header */}
              <div
                className="flex items-center justify-between p-4 cursor-pointer hover:bg-surface-highlight/50 transition-colors"
                onClick={() => toggleStock(stock.ticker)}
              >
                <div className="flex items-center gap-3 flex-1">
                  <span
                    className={`material-symbols-outlined text-sm transition-transform ${isExpanded ? "rotate-90" : ""}`}
                  >
                    chevron_right
                  </span>
                  <Link
                    href={`/stock/${stock.ticker}`}
                    className="font-mono font-bold text-primary hover:text-primary/80 transition-colors"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {stock.ticker}
                  </Link>

                  {/* Price Change */}
                  {move && move.dayChangePct !== null && Number.isFinite(move.dayChangePct) ? (
                    <span
                      className={`text-xs font-mono font-semibold ${move.dayChangePct >= 0 ? "text-[#00ff41]" : "text-[#ff0055]"
                        }`}
                      title="1D move based on latest available close"
                    >
                      {formatSignedPercent(move.dayChangePct)}
                    </span>
                  ) : null}

                  {/* Sentiment Badge */}
                  <div className="flex items-center gap-1">
                    <span className={`material-symbols-outlined text-sm ${getSentimentColor(stock.sentiment)}`}>
                      {getSentimentIcon(stock.sentiment)}
                    </span>
                    <span className={`text-xs font-medium capitalize ${getSentimentColor(stock.sentiment)}`}>
                      {stock.sentiment || "Neutral"}
                    </span>
                  </div>

                  {/* News Count */}
                  {stock.relatedNewsCount > 0 ? (
                    <div className="flex items-center gap-1 text-xs text-muted">
                      <span className="material-symbols-outlined !text-xs">newspaper</span>
                      <span>{stock.relatedNewsCount}</span>
                    </div>
                  ) : null}
                </div>

                {/* Quick Metrics */}
                <div className="flex items-center gap-4 text-xs">
                  <div>
                    <span className="text-muted">Vol: </span>
                    <span className="font-mono text-foreground">{(stock.volatility * 100).toFixed(1)}%</span>
                  </div>
                  <div>
                    <span className="text-muted">Sharpe: </span>
                    <span className="font-mono text-foreground">{stock.sharpe.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {/* Expanded Content */}
              {isExpanded ? (
                <div className="border-t border-border-color/30 p-4 bg-surface/30">
                  {/* Narrative */}
                  {stock.narrative ? (
                    <div className="mb-4">
                      <p className="text-sm text-foreground leading-relaxed">{stock.narrative}</p>
                    </div>
                  ) : (
                    <p className="text-sm text-muted italic mb-4">No narrative available</p>
                  )}

                  {/* Detailed Metrics Grid */}
                  <div className="grid grid-cols-4 gap-3">
                    <div className="bg-surface-highlight/50 rounded p-2">
                      <p className="text-[10px] text-muted uppercase tracking-wider mb-1">Volatility</p>
                      <p className="text-sm font-mono font-semibold text-foreground">{(stock.volatility * 100).toFixed(2)}%</p>
                    </div>
                    <div className="bg-surface-highlight/50 rounded p-2">
                      <p className="text-[10px] text-muted uppercase tracking-wider mb-1">Sharpe</p>
                      <p className="text-sm font-mono font-semibold text-foreground">{stock.sharpe.toFixed(2)}</p>
                    </div>
                    <div className="bg-surface-highlight/50 rounded p-2">
                      <p className="text-[10px] text-muted uppercase tracking-wider mb-1">VaR 95%</p>
                      <p className="text-sm font-mono font-semibold text-foreground">{(stock.var95 * 100).toFixed(2)}%</p>
                    </div>
                    <div className="bg-surface-highlight/50 rounded p-2">
                      <p className="text-[10px] text-muted uppercase tracking-wider mb-1">CVaR 95%</p>
                      <p className="text-sm font-mono font-semibold text-foreground">{(stock.cvar95 * 100).toFixed(2)}%</p>
                    </div>
                  </div>

                  {/* View Details Link */}
                  <div className="mt-3 pt-3 border-t border-border-color/20">
                    <Link
                      href={`/stock/${stock.ticker}`}
                      className="text-xs text-primary hover:text-primary/80 flex items-center gap-1"
                    >
                      <span>View full details</span>
                      <span className="material-symbols-outlined !text-sm">arrow_forward</span>
                    </Link>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="mt-4 pt-4 border-t border-border-color/30 text-xs text-muted">
        <p>Daily analysis runs automatically at market close</p>
      </div>
    </div>
  );
}
