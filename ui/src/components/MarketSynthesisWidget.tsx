"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import MarketSynthesis from "@/components/MarketSynthesis";
import ShareDownloadButtons from "@/components/ShareDownloadButtons";
import { useMarketSynthesis } from "@/hooks/useMarketSynthesis";
import { useFollowedStocks } from "@/hooks/useFollowedStocks";
import { useCompanyLogos } from "@/hooks/useCompanyLogos";
import { useStockPrices } from "@/hooks/useStockPrices";
import { authFetch } from "@/lib/authFetch";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import FeatureGateOverlay from "@/components/FeatureGateOverlay";
import type { Watchlist } from "@/types";

type MarketSynthesisWidgetProps = {
  watchlists?: Watchlist[];
};

interface SentimentSummary {
  label?: string;
  positive?: number;
  negative?: number;
  neutral?: number;
}

interface StockSentimentResponse {
  ticker: string;
  news_sentiment?: SentimentSummary;
}

interface AggregatedSentiment {
  label: string;
  positive: number;
  negative: number;
  neutral: number;
  covered: number;
  requested: number;
}

interface NewsHeadline {
  ticker: string;
  title: string;
  publisher: string;
  link: string;
  providerPublishTime: number | string | null;
  sentiment?: string;
  sentimentScore?: number;
}

interface WatchlistOverviewData {
  id: string;
  name: string;
  holdings: number;
  upCount: number;
  downCount: number;
  flatCount: number;
  pricedCount: number;
  avgRisk: number | null;
  avgIntraday: number | null;
  highestRisk: string | null;
  lowestRisk: string | null;
  topGainer: { symbol: string; changePct: number } | null;
  topLaggard: { symbol: string; changePct: number } | null;
}

interface MoverRow {
  symbol: string;
  changePct: number;
  latestClose: number;
}

const API_URL = "/api";
const MAX_SENTIMENT_SYMBOLS = 8;

const getRiskLevelLabel = (score: number | null) => {
  if (score === null || !Number.isFinite(score)) return "Unscored";
  if (score >= 70) return "High";
  if (score >= 45) return "Moderate";
  return "Low";
};

const getSentimentToneClass = (label: string) => {
  const normalized = label.toLowerCase();
  if (normalized === "positive") return "text-[#00ff41]";
  if (normalized === "negative") return "text-[#ff0055]";
  return "text-foreground";
};

const formatSignedPct = (value: number | null) => {
  if (value === null || !Number.isFinite(value)) return "N/A";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
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

function formatPublishTime(value: unknown): string {
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

export default function MarketSynthesisWidget({ watchlists = [] }: MarketSynthesisWidgetProps) {
  const { synthesis, loading, error, refresh } = useMarketSynthesis();
  const { canUseLLM, reason: accessReason, isLoading: accessLoading } = useFeatureAccess();
  const { followed } = useFollowedStocks();

  // Collect ALL watchlist symbols for sentiment
  const allWatchlistSymbols = useMemo(() => {
    const symbols = new Set<string>();
    for (const wl of watchlists) {
      if (!Array.isArray(wl.tickers)) continue;
      for (const t of wl.tickers) {
        const s = t.symbol?.toUpperCase();
        if (s) symbols.add(s);
      }
    }
    return Array.from(symbols);
  }, [watchlists]);

  const sentimentSymbols = useMemo(
    () => allWatchlistSymbols.slice(0, MAX_SENTIMENT_SYMBOLS),
    [allWatchlistSymbols]
  );

  // Fetch FinBERT sentiment for watchlist universe
  const watchlistSentiment = useQuery({
    queryKey: ["watchlistNewsSentiment", sentimentSymbols],
    enabled: sentimentSymbols.length > 0,
    queryFn: async ({ signal }) => {
      const rows = await Promise.all(
        sentimentSymbols.map(async (symbol) => {
          try {
            const response = await authFetch(`${API_URL}/stocks/${symbol}/sentiment`, { signal });
            if (!response.ok) return null;
            return (await response.json()) as StockSentimentResponse;
          } catch (e) {
            if (e instanceof Error && e.name === "AbortError") throw e;
            return null;
          }
        })
      );

      const covered = rows.filter((item): item is StockSentimentResponse => {
        if (!item) return false;
        const s = item.news_sentiment;
        return typeof s?.positive === "number" && typeof s.negative === "number" && typeof s.neutral === "number";
      });

      if (!covered.length) return null;

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
      );

      return { label, positive, negative, neutral, covered: count, requested: sentimentSymbols.length } as AggregatedSentiment;
    },
    staleTime: 2 * 60 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
  });

  // Fetch market news headlines for watchlist stocks
  const newsSymbols = useMemo(() => allWatchlistSymbols.slice(0, 6), [allWatchlistSymbols]);

  const marketNews = useQuery({
    queryKey: ["marketOverviewNews", newsSymbols.join(",")],
    enabled: newsSymbols.length > 0,
    queryFn: async ({ signal }) => {
      const results = await Promise.all(
        newsSymbols.map(async (ticker) => {
          try {
            const response = await authFetch(`${API_URL}/stocks/${ticker}/news?limit=2`, { signal });
            if (!response.ok) return [];
            const payload = (await response.json()) as { news?: Array<Record<string, unknown>> };
            const news = Array.isArray(payload.news) ? payload.news : [];
            return news
              .map((article) => {
                const title = typeof article.title === "string" ? article.title : "";
                const publisher = typeof article.publisher === "string" ? article.publisher : "";
                const link = typeof article.link === "string" ? article.link : "";
                const providerPublishTime = (article.providerPublishTime ?? null) as NewsHeadline["providerPublishTime"];
                if (!title || !link) return null;
                return { ticker, title, publisher, link, providerPublishTime } as NewsHeadline;
              })
              .filter((a): a is NewsHeadline => a !== null);
          } catch (e) {
            if (e instanceof Error && e.name === "AbortError") throw e;
            return [];
          }
        })
      );

      const all = results.flat();
      const seen = new Set<string>();
      const unique = all.filter((a) => {
        const key = `${a.title}::${a.link}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      unique.sort((a, b) => toEpochSeconds(b.providerPublishTime) - toEpochSeconds(a.providerPublishTime));
      return unique.slice(0, 6);
    },
    staleTime: 5 * 60 * 1000,
  });

  const followedSymbols = useMemo(() => followed.slice(0, 8), [followed]);
  const allLogoSymbols = useMemo(
    () => Array.from(new Set([...followedSymbols, ...allWatchlistSymbols.slice(0, 20)])),
    [followedSymbols, allWatchlistSymbols]
  );
  const { getLogo } = useCompanyLogos(allLogoSymbols);
  const { prices, getLatestPrice } = useStockPrices();

  const synthesisDate = (() => {
    if (!synthesis?.timestamp) return null;
    const parsed = new Date(synthesis.timestamp);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString().slice(0, 10);
  })();

  // Compute daily change for a symbol
  const getDailyChange = (symbol: string): number | null => {
    const series = prices[symbol];
    if (!series) return null;
    const dates = Object.keys(series).sort();
    if (dates.length < 2) return null;
    const latest = series[dates[dates.length - 1]];
    const prev = series[dates[dates.length - 2]];
    if (!latest || !prev || !Number.isFinite(prev.close) || prev.close === 0) return null;
    return ((latest.close - prev.close) / prev.close) * 100;
  };

  // Compute overview for EACH watchlist
  const watchlistOverviews = useMemo(() => {
    const result: WatchlistOverviewData[] = [];

    for (const wl of watchlists) {
      if (!Array.isArray(wl.tickers) || wl.tickers.length === 0) continue;

      const symbols = Array.from(
        new Set(wl.tickers.map((t) => t.symbol?.toUpperCase()).filter((s): s is string => Boolean(s)))
      );
      if (!symbols.length) continue;

      let upCount = 0;
      let downCount = 0;
      let flatCount = 0;
      const changes: Array<{ symbol: string; pct: number }> = [];

      for (const symbol of symbols) {
        const pct = getDailyChange(symbol);
        if (pct === null) continue;
        changes.push({ symbol, pct });
        if (pct > 0.1) upCount += 1;
        else if (pct < -0.1) downCount += 1;
        else flatCount += 1;
      }

      const scoredTickers = wl.tickers
        .filter((t) => typeof t.riskScore === "number" && Number.isFinite(t.riskScore))
        .sort((a, b) => b.riskScore - a.riskScore);

      const avgRisk =
        scoredTickers.length > 0
          ? scoredTickers.reduce((sum, t) => sum + t.riskScore, 0) / scoredTickers.length
          : null;

      const avgIntraday =
        changes.length > 0
          ? changes.reduce((sum, c) => sum + c.pct, 0) / changes.length
          : null;

      const sorted = [...changes].sort((a, b) => b.pct - a.pct);
      const topGainer = sorted[0] ? { symbol: sorted[0].symbol, changePct: sorted[0].pct } : null;
      const topLaggard = sorted.length ? { symbol: sorted[sorted.length - 1].symbol, changePct: sorted[sorted.length - 1].pct } : null;

      result.push({
        id: wl.id,
        name: wl.name,
        holdings: symbols.length,
        upCount,
        downCount,
        flatCount,
        pricedCount: changes.length,
        avgRisk,
        avgIntraday,
        highestRisk: scoredTickers[0]?.symbol || null,
        lowestRisk: scoredTickers[scoredTickers.length - 1]?.symbol || null,
        topGainer,
        topLaggard,
      });
    }

    return result;
  }, [prices, watchlists]);

  // Significant movers in watchlist (|change| >= 2%) — used for per-ticker commentary
  const MOVER_THRESHOLD = 2.0;
  const significantMovers = useMemo(() => {
    const movers: Array<{ symbol: string; changePct: number }> = [];
    for (const symbol of allWatchlistSymbols) {
      const pct = getDailyChange(symbol);
      if (pct !== null && Math.abs(pct) >= MOVER_THRESHOLD) {
        movers.push({ symbol, changePct: pct });
      }
    }
    movers.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
    return movers.slice(0, 5);
  }, [allWatchlistSymbols, prices]);

  // Per-ticker commentary for significant movers (cached server-side per symbol per day)
  const tickerCommentaries = useQuery({
    queryKey: ["tickerCommentary", significantMovers.map((m) => m.symbol).join(",")],
    enabled: significantMovers.length > 0,
    staleTime: 60 * 60 * 1000, // 1 hour — matches server cache
    queryFn: async ({ signal }) => {
      const results = await Promise.all(
        significantMovers.map(async ({ symbol }) => {
          try {
            const res = await authFetch(`${API_URL}/market/ticker-commentary/${symbol}`, { signal });
            if (!res.ok) return null;
            const data = await res.json() as {
              symbol: string;
              commentary: string;
              daily_change: number;
              five_day_change: number | null;
              date: string;
            };
            return data;
          } catch (e) {
            if (e instanceof Error && e.name === "AbortError") throw e;
            return null;
          }
        })
      );
      return results.filter((r): r is NonNullable<typeof r> => r !== null);
    },
  });

  // Top movers / losers across ALL watchlist stocks
  const universalMovers = useMemo(() => {
    const movers: MoverRow[] = [];
    for (const symbol of allWatchlistSymbols) {
      const pct = getDailyChange(symbol);
      if (pct === null) continue;
      const latest = getLatestPrice(symbol);
      movers.push({ symbol, changePct: pct, latestClose: latest?.close ?? 0 });
    }
    movers.sort((a, b) => b.changePct - a.changePct);
    const gainers = movers.filter((m) => m.changePct > 0).slice(0, 5);
    const losers = movers.filter((m) => m.changePct < 0).sort((a, b) => a.changePct - b.changePct).slice(0, 5);
    return { gainers, losers };
  }, [allWatchlistSymbols, prices]);

  // Insights from key stats
  const insights = useMemo(() => {
    if (!synthesis) return [];
    const items: Array<{ label: string; value: string; icon: string }> = [];

    const stats = synthesis.key_stats || {};
    const changes = [stats.sp500_change, stats.nasdaq_change, stats.dow_change].filter(
      (v): v is number => typeof v === "number"
    );

    if (changes.length) {
      const upCount = changes.filter((v) => v >= 0).length;
      const avg = changes.reduce((s, v) => s + v, 0) / changes.length;
      const bias = avg >= 0 ? "Risk-on tilt" : "Risk-off tilt";
      const breadth =
        upCount === changes.length ? "broad gains" : upCount === 0 ? "broad declines" : "mixed breadth";
      items.push({
        label: "Momentum",
        icon: "speed",
        value: `${bias} with ${upCount}/${changes.length} indices up (${avg >= 0 ? "+" : ""}${avg.toFixed(2)}% avg, ${breadth}).`,
      });
    }

    if (typeof stats.vix === "number" && stats.vix > 0) {
      const vix = stats.vix;
      const regime =
        vix >= 30 ? "Stress" : vix >= 25 ? "High" : vix >= 20 ? "Elevated" : vix >= 15 ? "Normal" : "Low";
      items.push({
        label: "Volatility",
        icon: "show_chart",
        value: `${regime} regime (VIX ${vix.toFixed(2)}). ${vix >= 25 ? "Consider hedging exposure." : vix < 15 ? "Markets are complacent, watch for surprises." : "Standard conditions for active positioning."}`,
      });
    }

    // Add watchlist breadth insight
    if (watchlistOverviews.length > 0) {
      const totalUp = watchlistOverviews.reduce((s, w) => s + w.upCount, 0);
      const totalDown = watchlistOverviews.reduce((s, w) => s + w.downCount, 0);
      const totalPriced = watchlistOverviews.reduce((s, w) => s + w.pricedCount, 0);
      if (totalPriced > 0) {
        const pctUp = ((totalUp / totalPriced) * 100).toFixed(0);
        items.push({
          label: "Portfolio Breadth",
          icon: "pie_chart",
          value: `${totalUp} of ${totalPriced} watchlist stocks up (${pctUp}%), ${totalDown} declining across ${watchlistOverviews.length} watchlist${watchlistOverviews.length > 1 ? "s" : ""}.`,
        });
      }
    }

    // Add sentiment insight if available
    if (watchlistSentiment.data) {
      const s = watchlistSentiment.data;
      items.push({
        label: "FinBERT Sentiment",
        icon: "psychology",
        value: `News sentiment across your holdings is ${s.label} (${(s.positive * 100).toFixed(0)}% positive, ${(s.negative * 100).toFixed(0)}% negative; ${s.covered}/${s.requested} stocks covered).`,
      });
    }

    return items;
  }, [synthesis, watchlistOverviews, watchlistSentiment.data]);

  // Build verbose export content
  const overviewMarkdown = useMemo(() => {
    const lines: string[] = [];
    lines.push("# Market Overview");
    if (synthesisDate) lines.push(`Generated: ${synthesisDate}`);
    lines.push("");

    // Key stats
    const stats = synthesis?.key_stats;
    if (stats) {
      lines.push("## Market Indices");
      if (typeof stats.sp500_change === "number") lines.push(`- S&P 500: ${stats.sp500_change >= 0 ? "+" : ""}${stats.sp500_change.toFixed(2)}%`);
      if (typeof stats.nasdaq_change === "number") lines.push(`- NASDAQ: ${stats.nasdaq_change >= 0 ? "+" : ""}${stats.nasdaq_change.toFixed(2)}%`);
      if (typeof stats.dow_change === "number") lines.push(`- DOW: ${stats.dow_change >= 0 ? "+" : ""}${stats.dow_change.toFixed(2)}%`);
      if (typeof stats.vix === "number") lines.push(`- VIX: ${stats.vix.toFixed(2)}`);
      lines.push("");
    }

    // Insights
    if (insights.length > 0) {
      lines.push("## Insights");
      for (const item of insights) lines.push(`- **${item.label}**: ${item.value}`);
      lines.push("");
    }

    // Sentiment
    if (watchlistSentiment.data) {
      const s = watchlistSentiment.data;
      lines.push("## FinBERT News Sentiment");
      lines.push(`Overall tone: **${s.label}** (${(s.positive * 100).toFixed(0)}% positive, ${(s.neutral * 100).toFixed(0)}% neutral, ${(s.negative * 100).toFixed(0)}% negative). Coverage: ${s.covered}/${s.requested} stocks.`);
      lines.push("");
    }

    // Watchlist-by-watchlist
    if (watchlistOverviews.length > 0) {
      lines.push("## Watchlist Breakdown");
      for (const wl of watchlistOverviews) {
        lines.push(`### ${wl.name}`);
        lines.push(`${wl.holdings} holdings, ${wl.pricedCount} with price data.`);

        if (wl.pricedCount > 0) {
          lines.push(`- Breadth: ${wl.upCount} up, ${wl.downCount} down${wl.flatCount > 0 ? `, ${wl.flatCount} flat` : ""}`);
          if (wl.avgIntraday !== null) lines.push(`- Avg daily move: ${formatSignedPct(wl.avgIntraday)}`);
          if (wl.avgRisk !== null) lines.push(`- Avg risk score: ${wl.avgRisk.toFixed(0)} (${getRiskLevelLabel(wl.avgRisk)})`);
        }

        // Noteworthy stocks
        const noteworthy: string[] = [];
        if (wl.topGainer && wl.topGainer.changePct > 1) {
          noteworthy.push(`**${wl.topGainer.symbol}** led gains at ${formatSignedPct(wl.topGainer.changePct)}`);
        } else if (wl.topGainer) {
          noteworthy.push(`Top gainer: ${wl.topGainer.symbol} (${formatSignedPct(wl.topGainer.changePct)})`);
        }
        if (wl.topLaggard && wl.topLaggard.changePct < -1) {
          noteworthy.push(`**${wl.topLaggard.symbol}** underperformed at ${formatSignedPct(wl.topLaggard.changePct)}`);
        } else if (wl.topLaggard && wl.topLaggard.changePct < 0) {
          noteworthy.push(`Weakest: ${wl.topLaggard.symbol} (${formatSignedPct(wl.topLaggard.changePct)})`);
        }

        if (noteworthy.length > 0) {
          lines.push(`- Noteworthy: ${noteworthy.join("; ")}`);
        } else {
          lines.push("- No standout movers today — the watchlist traded in a narrow range.");
        }

        if (wl.highestRisk && wl.lowestRisk && wl.highestRisk !== wl.lowestRisk) {
          lines.push(`- Risk range: ${wl.highestRisk} (highest) to ${wl.lowestRisk} (lowest)`);
        }
        lines.push("");
      }
    }

    // Top movers / losers
    if (universalMovers.gainers.length > 0 || universalMovers.losers.length > 0) {
      lines.push("## Top Movers Across Your Stocks");

      if (universalMovers.gainers.length > 0) {
        lines.push("### Top Gainers");
        for (const m of universalMovers.gainers) {
          lines.push(`- ${m.symbol}: $${m.latestClose.toFixed(2)} (${formatSignedPct(m.changePct)})`);
        }
        lines.push("");
      }
      if (universalMovers.losers.length > 0) {
        lines.push("### Top Losers");
        for (const m of universalMovers.losers) {
          lines.push(`- ${m.symbol}: $${m.latestClose.toFixed(2)} (${formatSignedPct(m.changePct)})`);
        }
        lines.push("");
      }
    }

    // Followed stocks
    if (followedSymbols.length > 0) {
      lines.push("## Followed Stocks");
      for (const symbol of followedSymbols) {
        const price = getLatestPrice(symbol);
        const changePct = getDailyChange(symbol);
        const priceStr = price ? `$${price.close.toFixed(2)}` : "N/A";
        const changeStr = changePct !== null && Number.isFinite(changePct) ? ` (${formatSignedPct(changePct)})` : "";
        lines.push(`- ${symbol}: ${priceStr}${changeStr}`);
      }
      lines.push("");
    }

    // News headlines
    const headlines = marketNews.data ?? [];
    if (headlines.length > 0) {
      lines.push("## Recent Headlines");
      for (const article of headlines) {
        const time = formatPublishTime(article.providerPublishTime);
        lines.push(`- **${article.ticker}**: ${article.title}${article.publisher ? ` (${article.publisher})` : ""}${time ? ` — ${time}` : ""}`);
      }
      lines.push("");
    }

    // AI narrative
    if (synthesis?.synthesis?.trim()) {
      lines.push("## AI Synthesis");
      lines.push(synthesis.synthesis.trim());
      lines.push("");
    }

    return lines.join("\n").trim() + "\n";
  }, [synthesis, synthesisDate, insights, watchlistSentiment.data, watchlistOverviews, universalMovers, followedSymbols, marketNews.data, prices]);

  // Plain-text version (strip markdown bold markers)
  const overviewPlainText = useMemo(
    () => overviewMarkdown.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/^#{1,3} /gm, ""),
    [overviewMarkdown]
  );

  return (
    <div className="bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/30 rounded-xl p-6 relative min-h-[400px]">
      {!canUseLLM && !accessLoading && (
        <FeatureGateOverlay reason={accessReason} featureLabel="Market Synthesis" />
      )}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-primary text-2xl">insights</span>
          <h2 className="text-lg font-bold text-foreground">Market Overview</h2>
        </div>
        <div className="flex items-center gap-1">
          {synthesis?.synthesis && (
            <ShareDownloadButtons
              content={overviewPlainText}
              markdownContent={overviewMarkdown}
              pdfContent={overviewMarkdown}
              title="Market Overview"
              filename={synthesisDate ? `market-overview-${synthesisDate}` : "market-overview"}
              variant="compact"
              enableMarkdownExport
              enablePdfExport
            />
          )}
          <button
            onClick={() => void refresh()}
            disabled={loading}
            className="p-2 text-muted hover:text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="Refresh"
          >
            <span className={`material-symbols-outlined text-lg ${loading ? "animate-spin" : ""}`}>refresh</span>
          </button>
        </div>
      </div>

      {loading && !synthesis ? (
        <div className="space-y-3">
          <div className="h-4 bg-surface-highlight rounded animate-pulse"></div>
          <div className="h-4 bg-surface-highlight rounded animate-pulse w-5/6"></div>
          <div className="h-4 bg-surface-highlight rounded animate-pulse w-4/6"></div>
        </div>
      ) : error ? (
        <div className="text-center py-6">
          <span className="material-symbols-outlined text-4xl mb-2 opacity-50 text-muted">error</span>
          <p className="text-sm text-muted">Unable to generate market overview</p>
          <button onClick={() => void refresh()} className="mt-3 text-xs text-primary hover:text-primary/80">
            Try again
          </button>
        </div>
      ) : synthesis ? (
        <>
          {/* Key Stats */}
          {synthesis.key_stats && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              {synthesis.key_stats.sp500_change !== undefined && (
                <div className="bg-surface/50 rounded-2xl p-3">
                  <p className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-1">S&P 500</p>
                  <p className={`text-lg font-bold ${synthesis.key_stats.sp500_change >= 0 ? "text-[#00ff41]" : "text-[#ff0055]"}`}>
                    {synthesis.key_stats.sp500_change >= 0 ? "+" : ""}{synthesis.key_stats.sp500_change?.toFixed(2)}%
                  </p>
                </div>
              )}
              {synthesis.key_stats.nasdaq_change !== undefined && (
                <div className="bg-surface/50 rounded-2xl p-3">
                  <p className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-1">NASDAQ</p>
                  <p className={`text-lg font-bold ${synthesis.key_stats.nasdaq_change >= 0 ? "text-[#00ff41]" : "text-[#ff0055]"}`}>
                    {synthesis.key_stats.nasdaq_change >= 0 ? "+" : ""}{synthesis.key_stats.nasdaq_change?.toFixed(2)}%
                  </p>
                </div>
              )}
              {synthesis.key_stats.dow_change !== undefined && (
                <div className="bg-surface/50 rounded-2xl p-3">
                  <p className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-1">DOW</p>
                  <p className={`text-lg font-bold ${synthesis.key_stats.dow_change >= 0 ? "text-[#00ff41]" : "text-[#ff0055]"}`}>
                    {synthesis.key_stats.dow_change >= 0 ? "+" : ""}{synthesis.key_stats.dow_change?.toFixed(2)}%
                  </p>
                </div>
              )}
              {synthesis.key_stats.vix !== undefined && (
                <div className="bg-surface/50 rounded-2xl p-3">
                  <p className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-1">VIX</p>
                  <p className="text-lg font-bold text-foreground">{synthesis.key_stats.vix?.toFixed(2)}</p>
                </div>
              )}
            </div>
          )}

          {/* Insights Grid */}
          {insights.length > 0 && (
            <div className="mb-4">
              <p className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-2">Insights</p>
              <div className="grid gap-3 md:grid-cols-2">
                {insights.map((item) => (
                  <div key={item.label} className="bg-surface/60 border border-border-color/40 rounded-2xl p-3">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="material-symbols-outlined text-primary text-sm">{item.icon}</span>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">{item.label}</p>
                    </div>
                    <p className="text-xs text-foreground leading-relaxed">{item.value}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* FinBERT Sentiment Bar */}
          {watchlistSentiment.data && (
            <div className="mb-4 rounded-2xl border border-border-color/50 bg-surface/60 p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">FinBERT News Sentiment</p>
                <span className="text-[10px] text-muted">
                  {watchlistSentiment.data.covered}/{watchlistSentiment.data.requested} stocks covered
                </span>
              </div>
              <div className="flex items-center gap-3 mb-2">
                <span className={`text-sm font-bold capitalize ${getSentimentToneClass(watchlistSentiment.data.label)}`}>
                  {watchlistSentiment.data.label}
                </span>
                <span className="text-[10px] text-muted">
                  {(watchlistSentiment.data.positive * 100).toFixed(0)}% positive |{" "}
                  {(watchlistSentiment.data.neutral * 100).toFixed(0)}% neutral |{" "}
                  {(watchlistSentiment.data.negative * 100).toFixed(0)}% negative
                </span>
              </div>
              <div className="h-2 w-full rounded-full overflow-hidden bg-surface-highlight/60 border border-border-color/40">
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
            </div>
          )}

          {/* Watchlist-by-Watchlist Overviews */}
          {watchlistOverviews.length > 0 && (
            <div className="mb-4 space-y-3">
              <p className="text-[10px] font-semibold text-muted uppercase tracking-wider">
                Your Watchlists ({watchlistOverviews.length})
              </p>
              {watchlistOverviews.map((wl) => (
                <div key={wl.id} className="rounded-2xl border border-border-color/50 bg-surface/70 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-primary text-sm">bookmark</span>
                      <Link
                        href={`/watchlist/${wl.id}`}
                        className="text-sm font-semibold text-foreground hover:text-primary transition-colors"
                      >
                        {wl.name}
                      </Link>
                      <span className="text-[10px] text-muted">{wl.holdings} stocks</span>
                    </div>
                    <Link
                      href={`/watchlist/${wl.id}`}
                      className="text-[10px] font-semibold uppercase tracking-wider text-primary hover:underline"
                    >
                      Open
                    </Link>
                  </div>

                  {/* Watchlist summary text */}
                  <p className="text-xs leading-relaxed text-foreground mb-2">
                    {wl.pricedCount > 0 ? (
                      <>
                        <span className="text-neon-green font-semibold">{wl.upCount} up</span>,{" "}
                        <span className="text-neon-red font-semibold">{wl.downCount} down</span>
                        {wl.flatCount > 0 && <>, {wl.flatCount} flat</>}
                        {" out of "}
                        {wl.pricedCount} priced.
                        {wl.avgIntraday !== null && (
                          <> Avg daily move{" "}
                            <span className={wl.avgIntraday >= 0 ? "text-neon-green font-semibold" : "text-neon-red font-semibold"}>
                              {formatSignedPct(wl.avgIntraday)}
                            </span>.
                          </>
                        )}
                        {wl.avgRisk !== null && (
                          <> Avg risk score {wl.avgRisk.toFixed(0)} ({getRiskLevelLabel(wl.avgRisk)}).</>
                        )}
                      </>
                    ) : (
                      <>Price data unavailable for this watchlist.</>
                    )}
                  </p>

                  {/* Compact stat pills */}
                  <div className="flex flex-wrap gap-2">
                    {wl.topGainer && (
                      <span className="inline-flex items-center gap-1 rounded-md border border-[#00ff41]/30 bg-[#00ff41]/10 px-2 py-1 text-[10px] font-semibold text-neon-green">
                        <span className="material-symbols-outlined text-[11px]">trending_up</span>
                        {wl.topGainer.symbol} {formatSignedPct(wl.topGainer.changePct)}
                      </span>
                    )}
                    {wl.topLaggard && wl.topLaggard.changePct < 0 && (
                      <span className="inline-flex items-center gap-1 rounded-md border border-[#ff0055]/30 bg-[#ff0055]/10 px-2 py-1 text-[10px] font-semibold text-neon-red">
                        <span className="material-symbols-outlined text-[11px]">trending_down</span>
                        {wl.topLaggard.symbol} {formatSignedPct(wl.topLaggard.changePct)}
                      </span>
                    )}
                    {wl.avgRisk !== null && (
                      <span className="inline-flex items-center gap-1 rounded-md border border-border-color/40 bg-surface/60 px-2 py-1 text-[10px] font-semibold text-muted">
                        Risk: {wl.avgRisk.toFixed(0)}
                      </span>
                    )}
                    {wl.highestRisk && wl.lowestRisk && wl.highestRisk !== wl.lowestRisk && (
                      <span className="inline-flex items-center gap-1 rounded-md border border-border-color/40 bg-surface/60 px-2 py-1 text-[10px] font-semibold text-muted">
                        {wl.highestRisk} &rarr; {wl.lowestRisk}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Top Movers / Losers across watchlists */}
          {(universalMovers.gainers.length > 0 || universalMovers.losers.length > 0) && (
            <div className="mb-4 grid grid-cols-1 md:grid-cols-2 gap-3">
              {universalMovers.gainers.length > 0 && (
                <div className="rounded-2xl border border-border-color/50 bg-surface/60 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-2">
                    <span className="text-neon-green">Top Gainers</span> (Your Stocks)
                  </p>
                  <div className="space-y-1.5">
                    {universalMovers.gainers.map((m) => {
                      const logo = getLogo(m.symbol);
                      return (
                        <div key={m.symbol} className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {logo ? (
                              <img src={logo} alt="" className="w-4 h-4 rounded-full object-cover bg-white/80 p-0.5" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                            ) : (
                              <div className="w-4 h-4 rounded bg-surface-highlight flex items-center justify-center text-[7px] font-bold text-muted">{m.symbol.slice(0, 2)}</div>
                            )}
                            <Link href={`/stock/${m.symbol}`} className="text-xs font-semibold text-foreground hover:text-primary">
                              {m.symbol}
                            </Link>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-muted font-mono">${m.latestClose.toFixed(2)}</span>
                            <span className="text-xs font-bold text-neon-green font-mono">{formatSignedPct(m.changePct)}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {universalMovers.losers.length > 0 && (
                <div className="rounded-2xl border border-border-color/50 bg-surface/60 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-2">
                    <span className="text-neon-red">Top Losers</span> (Your Stocks)
                  </p>
                  <div className="space-y-1.5">
                    {universalMovers.losers.map((m) => {
                      const logo = getLogo(m.symbol);
                      return (
                        <div key={m.symbol} className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {logo ? (
                              <img src={logo} alt="" className="w-4 h-4 rounded-full object-cover bg-white/80 p-0.5" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                            ) : (
                              <div className="w-4 h-4 rounded bg-surface-highlight flex items-center justify-center text-[7px] font-bold text-muted">{m.symbol.slice(0, 2)}</div>
                            )}
                            <Link href={`/stock/${m.symbol}`} className="text-xs font-semibold text-foreground hover:text-primary">
                              {m.symbol}
                            </Link>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-muted font-mono">${m.latestClose.toFixed(2)}</span>
                            <span className="text-xs font-bold text-neon-red font-mono">{formatSignedPct(m.changePct)}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* News Pulse */}
          {(marketNews.data ?? []).length > 0 && (
            <div className="mb-4 rounded-2xl border border-border-color/50 bg-surface/60 p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">News Pulse</p>
                <span className="text-[10px] text-muted">{(marketNews.data ?? []).length} headlines</span>
              </div>
              <div className="space-y-2">
                {(marketNews.data ?? []).map((article) => (
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
                    {article.publisher && <p className="text-[10px] text-muted mt-0.5">{article.publisher}</p>}
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Followed Stocks */}
          {followedSymbols.length > 0 && (
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-semibold text-muted uppercase tracking-wider">Followed</p>
                {followed.length > followedSymbols.length && (
                  <span className="text-[10px] text-muted">+{followed.length - followedSymbols.length} more</span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {followedSymbols.map((symbol) => {
                  const logoUrl = getLogo(symbol);
                  const price = getLatestPrice(symbol);
                  const changePct = getDailyChange(symbol);
                  return (
                    <a
                      key={symbol}
                      href={`/stock/${symbol}`}
                      className="flex items-center gap-2 px-3 py-2 bg-surface/70 border border-border-color/40 rounded-2xl hover:border-primary/50 transition-colors"
                    >
                      {logoUrl ? (
                        <img
                          src={logoUrl}
                          alt={`${symbol} logo`}
                          className="w-5 h-5 rounded-full object-contain bg-white/80 p-0.5"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                        />
                      ) : (
                        <div className="w-5 h-5 rounded-full bg-surface-highlight flex items-center justify-center text-[9px] font-bold text-muted">
                          {symbol.slice(0, 2)}
                        </div>
                      )}
                      <div className="flex flex-col leading-tight">
                        <span className="text-xs font-bold text-foreground">{symbol}</span>
                        <div className="flex items-center gap-1">
                          <span className="text-[9px] text-muted font-mono">
                            {price ? `$${price.close.toFixed(2)}` : "\u2014"}
                          </span>
                          {changePct !== null && Number.isFinite(changePct) && (
                            <span className={`text-[9px] font-mono font-semibold ${changePct >= 0 ? "text-neon-green" : "text-neon-red"}`}>
                              {formatSignedPct(changePct)}
                            </span>
                          )}
                        </div>
                      </div>
                    </a>
                  );
                })}
              </div>
            </div>
          )}

          {/* Holdings in Focus — AI commentary on significant watchlist movers */}
          {significantMovers.length > 0 && (
            <div className="mb-4 rounded-2xl border border-primary/20 bg-primary/5 p-3">
              <div className="flex items-center gap-2 mb-3">
                <span className="material-symbols-outlined text-primary text-sm">manage_accounts</span>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                  Holdings in Focus
                </p>
                <span className="text-[10px] text-muted">
                  {significantMovers.length} stock{significantMovers.length > 1 ? "s" : ""} moved ≥{MOVER_THRESHOLD}% today
                </span>
              </div>
              <div className="space-y-3">
                {significantMovers.map((mover) => {
                  const commentary = tickerCommentaries.data?.find((c) => c.symbol === mover.symbol);
                  const logo = getLogo(mover.symbol);
                  return (
                    <div key={mover.symbol} className="flex gap-3">
                      <div className="shrink-0 flex flex-col items-center gap-1 pt-0.5">
                        {logo ? (
                          <img src={logo} alt="" className="w-6 h-6 rounded-full object-contain bg-white/80 p-0.5" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                        ) : (
                          <div className="w-6 h-6 rounded-full bg-surface-highlight flex items-center justify-center text-[9px] font-bold text-muted">{mover.symbol.slice(0, 2)}</div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Link href={`/stock/${mover.symbol}`} className="text-xs font-bold text-foreground hover:text-primary">
                            {mover.symbol}
                          </Link>
                          <span className={`text-xs font-bold font-mono ${mover.changePct >= 0 ? "text-neon-green" : "text-neon-red"}`}>
                            {formatSignedPct(mover.changePct)}
                          </span>
                        </div>
                        {tickerCommentaries.isLoading ? (
                          <div className="h-3 bg-surface-highlight rounded animate-pulse w-4/5"></div>
                        ) : commentary ? (
                          <p className="text-xs text-foreground/80 leading-relaxed">{commentary.commentary}</p>
                        ) : (
                          <p className="text-xs text-muted">Commentary unavailable.</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* AI Synthesis Narrative */}
          <MarketSynthesis synthesis={synthesis} variant="prose" />

          {/* Timestamp */}
          {synthesis.timestamp && (
            <div className="mt-4 pt-4 border-t border-border-color/50 flex items-center justify-end text-xs text-muted">
              <span>
                {new Date(synthesis.timestamp).toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </span>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
