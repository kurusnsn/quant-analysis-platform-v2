"use client";
import { devConsole } from "@/lib/devLog";

import { useParams } from "next/navigation";
import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { Header } from "@/components/Header";
import { useCompanyLogos } from "@/hooks/useCompanyLogos";
import { useStockPrices } from "@/hooks/useStockPrices";
import {
  useChartData,
  type ChartTimeframe,
  type CandleInterval,
  ALL_INTERVALS,
  INTERVAL_LABELS,
  getValidIntervals,
  getDefaultInterval,
} from "@/hooks/useChartData";
import { useStockFinancials, FinancialTableData, FinancialValue, FinancialsResponse, ValuationRatios } from "@/hooks/useStockFinancials";
import { useStockHolders, HolderTableData, HolderValue } from "@/hooks/useStockHolders";
import { useFollowedStocks } from "@/hooks/useFollowedStocks";
import { useLocalWatchlists } from "@/hooks/useLocalWatchlists";
import { useStockNews } from "@/hooks/useStockNews";
import { useStockFilings, StockFiling } from "@/hooks/useStockFilings";
import { useStockEarnings, EarningsTableData, EarningsValue } from "@/hooks/useStockEarnings";
import { useStockSentiment } from "@/hooks/useStockSentiment";
import { useStockProfile } from "@/hooks/useStockProfile";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import FeatureGateOverlay from "@/components/FeatureGateOverlay";
import NewsCard from "@/components/NewsCard";
import ShareDownloadButtons from "@/components/ShareDownloadButtons";
import CopyButton from "@/components/CopyButton";
import CandlestickChart from "@/components/CandlestickChart";
import { XAxis, YAxis, Tooltip, ResponsiveContainer, Area, AreaChart } from "recharts";
import { MOCK_WATCHLISTS } from "@/constants";

type StockTab = "Overview" | "Financials" | "Holders" | "Filings";
type ChartType = "area" | "candlestick";
type FinancialPeriod = "annual" | "quarterly" | "ttm";
type FinancialSection = "key_stats" | "balance_sheet" | "income_statement" | "cash_flow";
type HoldersSection = "major" | "institutional" | "mutual_fund";
type AskIntent = "summary" | "sentiment" | "filings" | "earnings" | "news" | "financials" | "holders" | "unknown";

export default function StockDetailPage() {
  const params = useParams();
  const ticker = (params?.ticker as string)?.toUpperCase();

  const [timeframe, setTimeframe] = useState<ChartTimeframe>("1M");
  const [candleInterval, setCandleInterval] = useState<CandleInterval>(getDefaultInterval("1M"));
  const [chartType, setChartType] = useState<ChartType>("area");
  const [activeTab, setActiveTab] = useState<StockTab>("Overview");
  const [financialPeriod, setFinancialPeriod] = useState<FinancialPeriod>("annual");
  const [financialSection, setFinancialSection] = useState<FinancialSection>("key_stats");
  const [holdersSection, setHoldersSection] = useState<HoldersSection>("major");
  const [askQuery, setAskQuery] = useState("");
  const [askIntent, setAskIntent] = useState<AskIntent | null>(null);
  const [isEarningsExpanded, setIsEarningsExpanded] = useState(false);
  const [isChartExpanded, setIsChartExpanded] = useState(false);
  const [newsLimit, setNewsLimit] = useState(10);
  const askResponseRef = useRef<HTMLDivElement>(null);
  const newsSentinelRef = useRef<HTMLDivElement>(null);
  const newsScrollRef = useRef<HTMLDivElement>(null);

  // Close expanded chart on ESC
  useEffect(() => {
    if (!isChartExpanded) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsChartExpanded(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isChartExpanded]);

  // When timeframe changes, auto-select the best default interval
  const handleTimeframeChange = (tf: ChartTimeframe) => {
    setTimeframe(tf);
    const valid = getValidIntervals(tf);
    if (!valid.includes(candleInterval)) {
      setCandleInterval(getDefaultInterval(tf));
    }
  };

  const validIntervals = getValidIntervals(timeframe);

  const { getLogo } = useCompanyLogos([ticker]);
  const { getPrices, getLatestPrice, loading } = useStockPrices();
  const { data: chartData, loading: chartLoading, fetching: chartFetching } = useChartData(ticker, timeframe, candleInterval);
  const { financials, loading: financialsLoading, error: financialsError } = useStockFinancials(ticker);
  const { news, loading: newsLoading, fetching: newsFetching, error: newsError } = useStockNews(ticker, newsLimit);
  const { holders, loading: holdersLoading, error: holdersError } = useStockHolders(ticker);
  const summaryEnabled = askIntent === "summary";
  const filingsEnabled = activeTab === "Filings" || askIntent === "filings" || summaryEnabled;
  const earningsEnabled = activeTab === "Overview" || askIntent === "earnings" || summaryEnabled;
  const sentimentEnabled = askIntent === "sentiment" || summaryEnabled;
  const { filings, loading: filingsLoading, error: filingsError } = useStockFilings(ticker, { enabled: filingsEnabled });
  const { earnings, loading: earningsLoading, error: earningsError } = useStockEarnings(ticker, { enabled: earningsEnabled });
  const { sentiment, loading: sentimentLoading, error: sentimentError } = useStockSentiment(ticker, { enabled: sentimentEnabled });
  const { profile } = useStockProfile(ticker);
  const { isFollowed, toggleFollow } = useFollowedStocks();
  const { watchlists, toggleTickerInWatchlist, isInWatchlist } = useLocalWatchlists({ fallback: MOCK_WATCHLISTS });
  const { canUseLLM, reason: accessReason, isLoading: accessLoading } = useFeatureAccess();

  const logoUrl = getLogo(ticker);
  const allPrices = getPrices(ticker);
  const latestPrice = getLatestPrice(ticker);
  const displayPrice = latestPrice?.close ?? (chartData.length ? chartData[chartData.length - 1]?.close ?? null : null);
  const displayLow = latestPrice?.low ?? (chartData.length ? chartData[chartData.length - 1]?.low ?? null : null);
  const displayHigh = latestPrice?.high ?? (chartData.length ? chartData[chartData.length - 1]?.high ?? null : null);
  const displayVolume = latestPrice?.volume ?? (chartData.length ? chartData[chartData.length - 1]?.volume ?? null : null);
  const followed = isFollowed(ticker);
  const watchlistsWithTicker = useMemo(
    () => watchlists.filter((watchlist) => watchlist.tickers.some((item) => item.symbol === ticker)),
    [watchlists, ticker]
  );

  const handleFollow = () => {
    if (!ticker) return;
    toggleFollow(ticker);
  };

  const promptSuggestions: Array<{ label: string; intent: AskIntent }> = [
    { label: "Summarize today", intent: "summary" },
    { label: "News sentiment snapshot", intent: "sentiment" },
    { label: "SEC filings summary", intent: "filings" },
    { label: "Next earnings date", intent: "earnings" },
    { label: "Top headlines", intent: "news" }
  ];

  const resolveAskIntent = (value: string): AskIntent => {
    const lower = value.toLowerCase();
    if (lower.includes("summarize") || lower.includes("summary") || lower.includes("today")) return "summary";
    if (lower.includes("sentiment")) return "sentiment";
    if (lower.includes("filing") || lower.includes("edgar") || lower.includes("sec")) return "filings";
    if (lower.includes("earn")) return "earnings";
    if (lower.includes("news") || lower.includes("headline")) return "news";
    if (lower.includes("holder")) return "holders";
    if (lower.includes("financial") || lower.includes("balance") || lower.includes("income")) return "financials";
    return "unknown";
  };

  const handleAsk = (value?: string, intentOverride?: AskIntent) => {
    const nextValue = value ?? askQuery;
    if (!nextValue.trim()) return;
    setAskQuery(nextValue);
    setAskIntent(intentOverride ?? resolveAskIntent(nextValue));
  };

  const renderAskResponse = () => {
    const compactNumber = new Intl.NumberFormat("en-US", {
      notation: "compact",
      maximumFractionDigits: 2
    });

    const describeSentiment = (label: string, summary?: { label: string; positive: number; negative: number; neutral: number } | null) => {
      if (!summary) return `${label} sentiment is unavailable from our sources.`;
      const total = summary.positive + summary.negative + summary.neutral;
      if (!total) return `${label} sentiment has insufficient signals to score right now.`;
      const positivePct = Math.round((summary.positive / total) * 100);
      const neutralPct = Math.round((summary.neutral / total) * 100);
      const negativePct = Math.round((summary.negative / total) * 100);
      return `${label} sentiment is ${summary.label.toLowerCase()} (${positivePct}% positive, ${neutralPct}% neutral, ${negativePct}% negative).`;
    };

    const describeFilings = () => {
      if (filingsLoading) return "SEC filings are loading.";
      if (filingsError) return `SEC filings are unavailable from our sources (${filingsError}).`;
      if (!filings.length) return "No recent SEC filings were found in our sources.";

      const sorted = [...filings].sort((a, b) => {
        const aTime = a.filing_date ? new Date(a.filing_date).getTime() : 0;
        const bTime = b.filing_date ? new Date(b.filing_date).getTime() : 0;
        return bTime - aTime;
      });
      const latest = sorted[0];
      const formCounts = sorted.reduce<Record<string, number>>((acc, filing) => {
        acc[filing.form] = (acc[filing.form] ?? 0) + 1;
        return acc;
      }, {});
      const formsText = Object.entries(formCounts)
        .map(([form, count]) => `${count} ${form}`)
        .join(", ");
      const latestText = latest
        ? `Latest: ${latest.form}${latest.filing_date ? ` on ${formatDate(latest.filing_date)}` : ""}.`
        : "";
      return `Recent SEC activity shows ${formsText}. ${latestText}`.trim();
    };

    const describeEarnings = () => {
      if (earningsLoading) return "Earnings data is loading.";
      if (earningsError) return `Earnings data is unavailable from our sources (${earningsError}).`;
      const highlights = extractEarningsHighlights(earnings);
      if (!highlights.length) return "No earnings calendar data is available from our sources.";
      const highlightText = highlights.map((item) => `${item.label}: ${item.value}`).join(" • ");
      return `Earnings calendar highlights: ${highlightText}.`;
    };

    const describeNews = () => {
      if (newsLoading) return "News headlines are loading.";
      if (newsError) return `News is unavailable from our sources (${newsError}).`;
      if (!news.length) return "No recent headlines are available from our sources.";
      const headlines = news.slice(0, 3).map((article) => article.title).filter(Boolean);
      if (!headlines.length) return "No recent headlines are available from our sources.";
      return `Top headlines: ${headlines.join("; ")}.`;
    };

    const describeFinancials = () => {
      if (financialsLoading) return "Financial statement data is loading.";
      if (financialsError || !financials) {
        return `Financial statement data is unavailable from our sources${financialsError ? ` (${financialsError})` : ""}.`;
      }
      const entries = Object.entries(financials.key_stats ?? {}).filter(([, value]) => value !== null && value !== undefined);
      if (!entries.length) return "Financial statements are available, but no key stats were returned.";
      const formatted = entries.slice(0, 3).map(([key, value]) => {
        const label = key.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
        const numeric = typeof value === "number" ? compactNumber.format(value) : String(value);
        return `${label}: ${numeric}`;
      });
      return `Key financial highlights: ${formatted.join(" • ")}.`;
    };

    const describeHolders = () => {
      if (holdersLoading) return "Ownership data is loading.";
      if (holdersError || !holders) {
        return `Ownership data is unavailable from our sources${holdersError ? ` (${holdersError})` : ""}.`;
      }
      const majorRows = holders.holders?.major?.rows ?? [];
      if (!majorRows.length) {
        return "Ownership data is available, but no major holder rows were returned.";
      }
      const top = majorRows.slice(0, 2).map((row) => row.label).filter(Boolean);
      return top.length
        ? `Major holder categories include ${top.join(" and ")}.`
        : "Ownership data is available in the Holders tab.";
    };

    if (!askIntent) {
      return (
        <p className="text-sm text-muted">
          Try a suggested prompt, or ask about news, filings, earnings, sentiment, or a daily summary.
        </p>
      );
    }

    if (askIntent === "summary") {
      const priceLine = latestPrice
        ? (() => {
          const open = latestPrice.open;
          const close = latestPrice.close;
          if (!open || !Number.isFinite(open)) {
            return `${ticker} last closed at $${close.toFixed(2)}.`;
          }
          const changePct = ((close - open) / open) * 100;
          const direction = changePct >= 0 ? "up" : "down";
          return `${ticker} last closed at $${close.toFixed(2)} (${direction} ${Math.abs(changePct).toFixed(2)}% from open).`;
        })()
        : "Price data is unavailable from our sources.";
      const summaryLines = [
        priceLine,
        describeNews(),
        describeSentiment("News", sentiment?.news_sentiment),
        describeFilings(),
        describeEarnings(),
      ];

      return (
        <div className="space-y-3">
          <p className="text-sm text-foreground leading-relaxed">
            Here is a concise summary based on the sources available in QuantPlatform:
          </p>
          <ul className="text-sm text-foreground leading-relaxed list-disc pl-4 space-y-2">
            {summaryLines.map((line, idx) => (
              <li key={`${idx}-${line.slice(0, 12)}`}>{line}</li>
            ))}
          </ul>
        </div>
      );
    }

    if (askIntent === "sentiment") {
      if (sentimentLoading) {
        return (
          <div className="text-sm text-muted flex items-center gap-2">
            <span className="material-symbols-outlined animate-spin text-base">progress_activity</span>
            Loading sentiment...
          </div>
        );
      }
      if (sentimentError || !sentiment) {
        return (
          <p className="text-sm text-muted">
            I cannot answer that from our sources right now. Sentiment data is unavailable.
          </p>
        );
      }

      const newsLine = describeSentiment("News", sentiment.news_sentiment);

      return (
        <div className="space-y-3">
          <p className="text-sm text-foreground leading-relaxed">{newsLine}</p>
          <div className="grid grid-cols-1 gap-4">
            <SentimentCard title="News Sentiment" summary={sentiment.news_sentiment} />
          </div>
        </div>
      );
    }

    if (askIntent === "filings") {
      if (filingsLoading) {
        return (
          <div className="text-sm text-muted flex items-center gap-2">
            <span className="material-symbols-outlined animate-spin text-base">progress_activity</span>
            Loading filings...
          </div>
        );
      }
      if (filingsError || !filings.length) {
        return (
          <p className="text-sm text-muted">
            I cannot answer that from our sources right now. {filingsError || "No filings were returned."}
          </p>
        );
      }

      const summary = describeFilings();

      return (
        <div className="space-y-3">
          <p className="text-sm text-foreground leading-relaxed">{summary}</p>
          <div className="space-y-2">
            {filings.slice(0, 3).map((filing, idx) => (
              <div key={`${filing.form}-${filing.filing_date}-${idx}`} className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-foreground">{filing.form}</p>
                  <p className="text-xs text-muted">
                    {filing.description || "SEC filing"}
                  </p>
                </div>
                <div className="text-xs text-muted whitespace-nowrap">
                  {formatDate(filing.filing_date)}
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }

    if (askIntent === "earnings") {
      if (earningsLoading) {
        return (
          <div className="text-sm text-muted flex items-center gap-2">
            <span className="material-symbols-outlined animate-spin text-base">progress_activity</span>
            Loading earnings...
          </div>
        );
      }
      if (earningsError) {
        return (
          <p className="text-sm text-muted">
            I cannot answer that from our sources right now. {earningsError}
          </p>
        );
      }
      const highlights = extractEarningsHighlights(earnings);
      if (!highlights.length) {
        return <p className="text-sm text-muted">I cannot answer that from our sources right now. No earnings data was returned.</p>;
      }

      return (
        <div className="space-y-3">
          <p className="text-sm text-foreground leading-relaxed">{describeEarnings()}</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {highlights.map((item) => (
              <div key={item.label} className="bg-surface-highlight rounded-2xl p-3">
                <p className="text-xs text-muted uppercase tracking-wider mb-1">{item.label}</p>
                <p className="text-sm font-semibold text-foreground">{item.value}</p>
              </div>
            ))}
          </div>
        </div>
      );
    }

    if (askIntent === "news") {
      if (newsLoading) {
        return (
          <div className="text-sm text-muted flex items-center gap-2">
            <span className="material-symbols-outlined animate-spin text-base">progress_activity</span>
            Loading news...
          </div>
        );
      }
      if (newsError || !news.length) {
        return (
          <p className="text-sm text-muted">
            I cannot answer that from our sources right now. {newsError || "No recent news available."}
          </p>
        );
      }
      return (
        <div className="space-y-3">
          <p className="text-sm text-foreground leading-relaxed">{describeNews()}</p>
          <div className="space-y-3">
            {news.slice(0, 3).map((article, index) => (
              <NewsCard key={index} article={article} />
            ))}
          </div>
        </div>
      );
    }

    if (askIntent === "financials") {
      return <p className="text-sm text-muted">{describeFinancials()}</p>;
    }

    if (askIntent === "holders") {
      return <p className="text-sm text-muted">{describeHolders()}</p>;
    }

    return (
      <p className="text-sm text-muted">
        I cannot answer that from the sources available here. Try news, filings, earnings, sentiment, financials, or holders.
      </p>
    );
  };

  // Calculate price change
  const priceData = useMemo(() => {
    if (!allPrices) return [];

    const dates = Object.keys(allPrices).sort();
    return dates.map(date => ({
      date: new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      fullDate: date,
      open: allPrices[date].open,
      close: allPrices[date].close,
      high: allPrices[date].high,
      low: allPrices[date].low,
      volume: allPrices[date].volume,
    }));
  }, [allPrices]);


  const stats = useMemo(() => {
    if (!chartData.length && !latestPrice) return null;

    // Derive change from live chart data when available
    const firstPrice = chartData.length > 0 ? chartData[0].close : null;
    const lastPrice = chartData.length > 0 ? chartData[chartData.length - 1].close : latestPrice?.close ?? null;
    const change = firstPrice != null && lastPrice != null ? lastPrice - firstPrice : null;
    const changePercent = change != null && firstPrice ? ((change / firstPrice) * 100).toFixed(2) : null;

    return {
      change,
      changePercent,
      isPositive: (change ?? 0) >= 0,
      high52w: priceData.length ? Math.max(...priceData.map(d => d.high)) : null,
      low52w: priceData.length ? Math.min(...priceData.map(d => d.low)) : null,
      avgVolume: priceData.length ? Math.round(priceData.reduce((sum, d) => sum + d.volume, 0) / priceData.length) : null,
    };
  }, [chartData, latestPrice, priceData]);

  // Scroll-to-load-more for news
  const newsHasMore = news.length >= newsLimit;
  const loadMoreNews = useCallback(() => {
    setNewsLimit((prev) => prev + 10);
  }, []);

  useEffect(() => {
    const sentinel = newsSentinelRef.current;
    const scrollRoot = newsScrollRef.current;
    if (!sentinel || !scrollRoot) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !newsFetching && newsHasMore) {
          loadMoreNews();
        }
      },
      { root: scrollRoot, rootMargin: "200px" }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [newsFetching, newsHasMore, loadMoreNews]);

  const earningsDetail = useMemo(
    () => buildEarningsDetailData(earnings, financials, priceData),
    [earnings, financials, priceData]
  );

  const currency = financials?.currency || "USD";
  const tabs: StockTab[] = ["Overview", "Financials", "Holders", "Filings"];
  const financialSections: Array<{ id: FinancialSection; label: string }> = [
    { id: "key_stats", label: "Key Stats" },
    { id: "balance_sheet", label: "Balance Sheet" },
    { id: "income_statement", label: "Income Statement" },
    { id: "cash_flow", label: "Cash Flow" },
  ];
  const holdersSections: Array<{ id: HoldersSection; label: string }> = [
    { id: "major", label: "Major Holders" },
    { id: "institutional", label: "Institutional Holders" },
    { id: "mutual_fund", label: "Mutual Fund Holders" },
  ];

  const resolveFinancialTable = useCallback((section: FinancialSection, period: FinancialPeriod) => {
    if (!financials) return null;

    const incomeAnnual = financials.statements?.income_statement?.annual;
    const incomeQuarterly = financials.statements?.income_statement?.quarterly;
    const balanceAnnual = financials.statements?.balance_sheet?.annual;
    const balanceQuarterly = financials.statements?.balance_sheet?.quarterly;
    const cashAnnual = financials.statements?.cash_flow?.annual;
    const cashQuarterly = financials.statements?.cash_flow?.quarterly;

    const periodTable = (annual?: FinancialTableData, quarterly?: FinancialTableData) => {
      if (period === "ttm") {
        return buildTtmTable(quarterly);
      }
      return period === "annual" ? annual : quarterly;
    };

    if (section === "key_stats") {
      return buildKeyStatsTable({
        period,
        incomeAnnual,
        incomeQuarterly,
        balanceAnnual,
        balanceQuarterly,
        cashAnnual,
        cashQuarterly,
        keyStats: financials.key_stats,
        valuationRatios: financials.valuation_ratios,
      });
    }

    if (section === "balance_sheet") {
      if (period === "ttm") {
        return buildMostRecentTable(balanceQuarterly);
      }
      return periodTable(balanceAnnual, balanceQuarterly);
    }

    if (section === "income_statement") {
      return periodTable(incomeAnnual, incomeQuarterly);
    }

    return periodTable(cashAnnual, cashQuarterly);
  }, [financials]);

  const resolvedFinancialTable = useMemo(() => {
    return resolveFinancialTable(financialSection, financialPeriod);
  }, [financialPeriod, financialSection, resolveFinancialTable]);

  const formatCsvValue = (value: FinancialValue) => {
    if (value === null || value === undefined) return "";
    const raw = String(value);
    if (raw.includes(",") || raw.includes("\"") || raw.includes("\n")) {
      return `"${raw.replace(/"/g, "\"\"")}"`;
    }
    return raw;
  };

  const downloadFinancialCsv = (section: FinancialSection) => {
    if (!ticker) return;
    const table = resolveFinancialTable(section, financialPeriod);
    if (!table || !table.columns.length || !table.rows.length) {
      devConsole.warn("No financial data to download for", section);
      return;
    }

    const header = ["Line Item", ...table.columns].map(formatCsvValue).join(",");
    const rows = table.rows.map((row) => {
      const values = row.values.map(formatCsvValue);
      return [formatCsvValue(row.label), ...values].join(",");
    });

    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${ticker}_${section}_${financialPeriod}.csv`.toLowerCase();
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const canDownloadSection = (section: FinancialSection) => {
    const table = resolveFinancialTable(section, financialPeriod);
    return !!table?.columns?.length && !!table?.rows?.length;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background-dark flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background-dark">
      <Header />

      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Header Section */}
        <div className="flex items-start gap-4 mb-8">
          {logoUrl && (
            <div className="w-16 h-16 rounded-full shrink-0 border border-border-color overflow-hidden">
              <img
                src={logoUrl}
                alt={`${ticker} logo`}
                className="w-full h-full object-cover"
              />
            </div>
          )}
          <div className="flex-1">
            <h1 className="text-3xl font-bold text-foreground mb-1">{ticker}</h1>
            <p className="text-muted text-sm">NASDAQ • United States</p>
          </div>
          <button
            onClick={handleFollow}
            className={`px-4 py-2 border rounded-lg transition-colors flex items-center gap-2 ${followed
              ? "border-primary text-foreground bg-primary/10"
              : "border-border-color text-muted hover:text-foreground hover:border-primary"
              }`}
            aria-pressed={followed}
          >
            <span
              className="material-symbols-outlined text-lg"
              style={followed ? { fontVariationSettings: "'FILL' 1" } : undefined}
            >
              star
            </span>
            {followed ? "Following" : "Follow"}
          </button>
        </div>

        <div className="mb-8 bg-surface border border-border-color rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Watchlists</p>
              <p className="text-sm text-foreground">Track {ticker} across your portfolios.</p>
            </div>
            <span className="text-xs text-muted">
              {watchlistsWithTicker.length ? `In ${watchlistsWithTicker.length}` : "Not tracked"}
            </span>
          </div>
          {watchlists.length === 0 ? (
            <p className="text-sm text-muted">No watchlists yet. Create one on the home page.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {watchlists.map((watchlist) => {
                const inWatchlist = isInWatchlist(watchlist.id, ticker);
                return (
                  <button
                    key={watchlist.id}
                    type="button"
                    onClick={() => toggleTickerInWatchlist(watchlist.id, ticker)}
                    className={`flex items-center justify-between px-3 py-2 rounded-2xl border text-left transition-colors ${inWatchlist
                      ? "border-risk-red/40 bg-risk-red/10 text-foreground hover:bg-risk-red/15"
                      : "border-border-color/50 hover:bg-surface-highlight text-foreground"
                      }`}
                  >
                    <span className="text-sm font-semibold truncate">{watchlist.name}</span>
                    <span className={`text-[10px] font-bold uppercase tracking-wider ${inWatchlist ? "text-neon-red" : "text-primary"
                      }`}>
                      {inWatchlist ? "Remove" : "Add"}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          {watchlistsWithTicker.length > 0 ? (
            <div className="flex flex-wrap gap-2 mt-4">
              {watchlistsWithTicker.map((watchlist) => (
                <span
                  key={watchlist.id}
                  className="text-[10px] px-2 py-1 rounded-full bg-surface-highlight text-muted uppercase tracking-wider"
                >
                  {watchlist.name}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        {/* Tabs */}
        <div className="border-b border-border-color mb-6">
          <div className="flex gap-8">
            {tabs.map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`pb-3 px-1 text-sm font-medium transition-colors border-b-2 ${tab === activeTab
                  ? 'text-foreground border-primary'
                  : 'text-muted border-transparent hover:text-foreground'
                  }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {activeTab === "Overview" && (
              <>
                {/* Price Display */}
                <div>
                  <div className="flex items-baseline gap-3 mb-2">
                    <span className="text-4xl font-bold text-foreground">
                      {displayPrice != null ? `$${displayPrice.toFixed(2)}` : "--"}
                    </span>
                    {stats && stats.change != null && stats.changePercent != null && (
                      <span className={`text-lg font-semibold ${stats.isPositive ? "text-neon-green" : "text-neon-red"}`}>
                        {stats.isPositive ? "+" : ""}${stats.change.toFixed(2)} ({stats.isPositive ? "+" : ""}{stats.changePercent}%)
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted">
                    Regular session • {new Date().toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                      timeZoneName: "short"
                    })}
                  </p>
                </div>

                {/* Chart */}
                <div className="bg-surface border border-border-color rounded-2xl p-4">
                  {/* Timeframe, Interval, and Chart Type Controls */}
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex gap-3 items-center">
                      {/* Range / Timeframe */}
                      <div className="flex gap-1">
                        {(["1D", "5D", "1M", "3M", "6M", "YTD", "1Y", "5Y", "MAX"] as const).map((tf) => (
                          <button
                            key={tf}
                            onClick={() => handleTimeframeChange(tf)}
                            className={`px-2 py-1.5 text-[11px] font-medium rounded-2xl transition-colors ${timeframe === tf
                              ? "bg-primary text-white"
                              : "text-muted hover:text-foreground hover:bg-surface-highlight"
                              }`}
                          >
                            {tf}
                          </button>
                        ))}
                      </div>

                      <div className="w-px h-5 bg-border-color" />

                      {/* Candle Interval */}
                      <div className="flex gap-1">
                        {ALL_INTERVALS.map((iv) => {
                          const isValid = validIntervals.includes(iv);
                          const isActive = candleInterval === iv;
                          return (
                            <button
                              key={iv}
                              onClick={() => isValid && setCandleInterval(iv)}
                              disabled={!isValid}
                              className={`px-2 py-1.5 text-[11px] font-medium rounded-2xl transition-colors ${isActive
                                  ? "bg-primary/20 text-primary border border-primary/40"
                                  : isValid
                                    ? "text-muted hover:text-foreground hover:bg-surface-highlight"
                                    : "text-muted/30 cursor-not-allowed"
                                }`}
                            >
                              {INTERVAL_LABELS[iv]}
                            </button>
                          );
                        })}
                      </div>

                      <div className="w-px h-5 bg-border-color" />

                      {/* Chart Type Toggle */}
                      <div className="flex border border-border-color rounded-lg overflow-hidden">
                        <button
                          onClick={() => setChartType("area")}
                          className={`px-2.5 py-1.5 text-[11px] font-medium transition-colors ${chartType === "area"
                            ? "bg-primary text-white"
                            : "text-muted hover:text-foreground"
                            }`}
                          title="Line Chart"
                        >
                          Line
                        </button>
                        <button
                          onClick={() => setChartType("candlestick")}
                          className={`px-2.5 py-1.5 text-[11px] font-medium transition-colors ${chartType === "candlestick"
                            ? "bg-primary text-white"
                            : "text-muted hover:text-foreground"
                            }`}
                          title="Candlestick Chart"
                        >
                          Candles
                        </button>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={() => setIsChartExpanded(true)}
                        className="p-2 text-muted hover:text-foreground transition-colors"
                        title="Expand chart"
                      >
                        <span className="material-symbols-outlined text-lg">open_in_full</span>
                      </button>
                    </div>
                  </div>

                  {/* Chart */}
                  <div className="relative">
                    {chartFetching && !chartLoading && (
                      <div className="absolute top-2 right-2 z-10">
                        <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                      </div>
                    )}
                    {chartLoading ? (
                      <div className="h-[350px] flex items-center justify-center">
                        <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                      </div>
                    ) : chartType === "area" ? (
                      <ResponsiveContainer width="100%" height={350}>
                        <AreaChart data={chartData}>
                          <defs>
                            <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor={stats?.isPositive ? "#00ff41" : "#ff0055"} stopOpacity={0.3} />
                              <stop offset="95%" stopColor={stats?.isPositive ? "#00ff41" : "#ff0055"} stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <XAxis
                            dataKey="date"
                            stroke="#e8e4d9"
                            tick={{ fill: "#e8e4d9", fontSize: 11 }}
                            tickLine={false}
                          />
                          <YAxis
                            stroke="#e8e4d9"
                            tick={{ fill: "#e8e4d9", fontSize: 11 }}
                            tickLine={false}
                            domain={["dataMin - 5", "dataMax + 5"]}
                          />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: "#1a1a1a",
                              border: "1px solid #333",
                              borderRadius: "8px",
                              fontSize: "12px"
                            }}
                            labelStyle={{ color: "#999" }}
                          />
                          <Area
                            type="monotone"
                            dataKey="close"
                            stroke={stats?.isPositive ? "#00ff41" : "#ff0055"}
                            strokeWidth={2}
                            fill="url(#colorPrice)"
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    ) : (
                      <CandlestickChart
                        data={chartData}
                        height={350}
                        showVolume={true}
                      />
                    )}
                  </div>

                  {/* Chart Stats */}
                  <div className="grid grid-cols-4 gap-4 mt-4 pt-4 border-t border-border-color">
                    <div>
                      <p className="text-xs text-muted mb-1">Prev Close</p>
                      <p className="text-sm font-semibold text-foreground">
                        ${priceData[priceData.length - 2]?.close.toFixed(2) || "-"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted mb-1">Day Range</p>
                      <p className="text-sm font-semibold text-foreground">
                        {displayLow != null && displayHigh != null
                          ? `$${displayLow.toFixed(2)}-$${displayHigh.toFixed(2)}`
                          : "-"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted mb-1">Volume</p>
                      <p className="text-sm font-semibold text-foreground">
                        {displayVolume != null ? `${(displayVolume / 1000000).toFixed(2)}M` : "-"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted mb-1">Avg Volume</p>
                      <p className="text-sm font-semibold text-foreground">
                        {stats?.avgVolume != null ? (stats.avgVolume / 1000000).toFixed(2) : "-"}M
                      </p>
                    </div>
                  </div>
                </div>

                {/* Earnings */}
                <div className="bg-surface border border-border-color rounded-2xl p-6">
                  <div className="flex flex-wrap items-start justify-between gap-2 mb-4">
                    <div>
                      <h2 className="text-lg font-bold text-foreground">Earnings</h2>
                      {earnings?.generated_at && (
                        <p className="text-xs text-muted">
                          Updated {new Date(earnings.generated_at).toLocaleDateString("en-US")}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsEarningsExpanded((prev) => !prev)}
                      className="inline-flex items-center gap-1 rounded-lg border border-border-color px-3 py-1.5 text-[11px] font-semibold text-muted hover:text-foreground"
                    >
                      <span className="material-symbols-outlined text-sm leading-none">
                        {isEarningsExpanded ? "expand_less" : "expand_more"}
                      </span>
                      {isEarningsExpanded ? "Hide Detail" : "Expand Detail"}
                    </button>
                  </div>

                  {earningsLoading ? (
                    <div className="text-center text-muted py-6">
                      <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary mx-auto mb-3"></div>
                      <p className="text-sm">Loading earnings...</p>
                    </div>
                  ) : earningsError ? (
                    <div className="text-center text-muted py-6">
                      <span className="material-symbols-outlined text-3xl mb-2 opacity-50">event</span>
                      <p className="text-sm">{earningsError}</p>
                    </div>
                  ) : earnings && (earnings.calendar?.rows?.length || earnings.earnings_dates?.rows?.length) ? (
                    <div className={`grid grid-cols-1 gap-4${earnings.calendar?.rows?.length && earnings.earnings_dates?.rows?.length ? ' lg:grid-cols-2' : ''}`}>
                      {earnings.calendar?.rows?.length ? (
                        <div>
                          <p className="text-xs text-muted uppercase tracking-wider mb-2">Calendar</p>
                          <FinancialTable table={earnings.calendar as FinancialTableData} />
                        </div>
                      ) : null}
                      {earnings.earnings_dates?.rows?.length ? (
                        <div>
                          <p className="text-xs text-muted uppercase tracking-wider mb-2">Earnings Dates</p>
                          <FinancialTable table={earnings.earnings_dates as FinancialTableData} />
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="text-center text-muted py-6">
                      <span className="material-symbols-outlined text-3xl mb-2 opacity-50">event_busy</span>
                      <p className="text-sm">No earnings data available</p>
                    </div>
                  )}

                  {isEarningsExpanded ? (
                    <div className="mt-5 border-t border-border-color pt-4 space-y-4">
                      {earningsDetail ? (
                        <>
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                            {earningsDetail.nextEarningsDate ? (
                              <div className="bg-surface-highlight rounded-2xl p-3">
                                <p className="text-[10px] uppercase tracking-wider text-muted">Next Earnings</p>
                                <p className="mt-1 text-sm font-semibold text-foreground">{earningsDetail.nextEarningsDate}</p>
                              </div>
                            ) : null}
                            {earningsDetail.epsAverage !== null ? (
                              <div className="bg-surface-highlight rounded-2xl p-3">
                                <p className="text-[10px] uppercase tracking-wider text-muted">EPS Consensus</p>
                                <p className="mt-1 text-sm font-semibold text-foreground">
                                  {formatComparisonMetricValue("eps", earningsDetail.epsAverage)}
                                </p>
                                {(earningsDetail.epsLow !== null || earningsDetail.epsHigh !== null) ? (
                                  <p className="mt-1 text-[11px] text-muted">
                                    Range {formatComparisonMetricValue("eps", earningsDetail.epsLow)} to{" "}
                                    {formatComparisonMetricValue("eps", earningsDetail.epsHigh)}
                                  </p>
                                ) : null}
                              </div>
                            ) : null}
                            {earningsDetail.revenueAverage !== null ? (
                              <div className="bg-surface-highlight rounded-2xl p-3">
                                <p className="text-[10px] uppercase tracking-wider text-muted">Revenue Consensus</p>
                                <p className="mt-1 text-sm font-semibold text-foreground">
                                  {formatComparisonMetricValue("currency", earningsDetail.revenueAverage)}
                                </p>
                                {(earningsDetail.revenueLow !== null || earningsDetail.revenueHigh !== null) ? (
                                  <p className="mt-1 text-[11px] text-muted">
                                    Range {formatComparisonMetricValue("currency", earningsDetail.revenueLow)} to{" "}
                                    {formatComparisonMetricValue("currency", earningsDetail.revenueHigh)}
                                  </p>
                                ) : null}
                              </div>
                            ) : null}
                            {earningsDetail.ytdPriceChangePct !== null ? (
                              <div className="bg-surface-highlight rounded-2xl p-3">
                                <p className="text-[10px] uppercase tracking-wider text-muted">Price YTD</p>
                                <p
                                  className={`mt-1 text-sm font-semibold ${earningsDetail.ytdPriceChangePct >= 0 ? "text-[#00ff41]" : "text-[#ff0055]"
                                    }`}
                                >
                                  {formatDeltaPercent(earningsDetail.ytdPriceChangePct)}
                                </p>
                                {earningsDetail.asOfDate ? (
                                  <p className="mt-1 text-[11px] text-muted">As of {formatDate(earningsDetail.asOfDate)}</p>
                                ) : null}
                              </div>
                            ) : null}
                          </div>

                          {earningsDetail.comparisonRows.length ? (
                            <div className="w-full">
                              <table className="w-full table-fixed text-xs">
                                <thead>
                                  <tr className="text-muted border-b border-border-color">
                                    <th className="w-[22%] text-left font-medium pb-2 pr-2">Metric</th>
                                    <th className="text-right font-medium pb-2">Latest Quarter</th>
                                    <th className="text-right font-medium pb-2">Previous Quarter</th>
                                    <th className="text-right font-medium pb-2">QoQ</th>
                                    <th className="text-right font-medium pb-2">Current YTD</th>
                                    <th className="text-right font-medium pb-2">Prior YTD</th>
                                    <th className="text-right font-medium pb-2">YTD Delta</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-border-color">
                                  {earningsDetail.comparisonRows.map((row) => (
                                    <tr key={row.label} className="hover:bg-surface-highlight/60">
                                      <td className="py-2 pr-2 text-foreground font-medium break-words">{row.label}</td>
                                      <td className="py-2 text-right text-foreground tabular-nums">
                                        {formatComparisonMetricValue(row.valueFormat, row.latestQuarter)}
                                      </td>
                                      <td className="py-2 text-right text-foreground tabular-nums">
                                        {formatComparisonMetricValue(row.valueFormat, row.previousQuarter)}
                                      </td>
                                      <td
                                        className={`py-2 text-right tabular-nums ${row.qoqChangePct === null
                                            ? "text-muted"
                                            : row.qoqChangePct >= 0
                                              ? "text-[#00ff41]"
                                              : "text-[#ff0055]"
                                          }`}
                                      >
                                        {formatDeltaPercent(row.qoqChangePct)}
                                      </td>
                                      <td className="py-2 text-right text-foreground tabular-nums">
                                        {formatComparisonMetricValue(row.valueFormat, row.ytdCurrent)}
                                      </td>
                                      <td className="py-2 text-right text-foreground tabular-nums">
                                        {formatComparisonMetricValue(row.valueFormat, row.ytdPrevious)}
                                      </td>
                                      <td
                                        className={`py-2 text-right tabular-nums ${row.ytdChangePct === null
                                            ? "text-muted"
                                            : row.ytdChangePct >= 0
                                              ? "text-[#00ff41]"
                                              : "text-[#ff0055]"
                                          }`}
                                      >
                                        {formatDeltaPercent(row.ytdChangePct)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <p className="text-xs text-muted">
                              No quarterly income rows were available to compare previous quarter and YTD.
                            </p>
                          )}
                        </>
                      ) : (
                        <p className="text-xs text-muted">
                          Expanded earnings detail is unavailable for this ticker right now.
                        </p>
                      )}
                    </div>
                  ) : null}
                </div>

                {/* Ask QuantPlatform */}
                <div className="bg-surface border border-border-color rounded-2xl p-6 relative">
                  {!canUseLLM && !accessLoading && (
                    <FeatureGateOverlay reason={accessReason} featureLabel="Ask QuantPlatform" />
                  )}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-lg font-bold text-foreground">Ask QuantPlatform</h2>
                    <span className="text-xs text-muted">News, filings, earnings, sentiment, daily summary</span>
                  </div>

                  <div className="mt-4 flex flex-col md:flex-row gap-2">
                    <input
                      value={askQuery}
                      onChange={(event) => setAskQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && canUseLLM) {
                          handleAsk();
                        }
                      }}
                      disabled={!canUseLLM}
                      placeholder={canUseLLM ? "Ask QuantPlatform about sentiment, filings, earnings, or summarize today..." : "AI insights require a Pro subscription."}
                      className="flex-1 bg-surface-highlight border border-border-color rounded-2xl px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-primary disabled:opacity-50"
                    />
                    <button
                      onClick={() => handleAsk()}
                      disabled={!canUseLLM || !askQuery.trim()}
                      className="px-4 py-2 text-sm font-medium rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Ask
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-2 mt-3">
                    {promptSuggestions.map((suggestion) => (
                      <button
                        key={suggestion.label}
                        onClick={() => handleAsk(suggestion.label, suggestion.intent)}
                        disabled={!canUseLLM}
                        className="px-3 py-1.5 text-xs font-medium rounded-full bg-surface-highlight text-muted hover:text-foreground hover:bg-surface-highlight/80 transition-colors disabled:opacity-50"
                      >
                        {suggestion.label}
                      </button>
                    ))}
                  </div>

                  <div className="mt-4">
                    {askIntent && (
                      <div className="flex items-center justify-end gap-2 mb-2">
                        <CopyButton
                          getText={() => askResponseRef.current?.innerText ?? ""}
                          label="Copy"
                        />
                        <ShareDownloadButtons
                          content={askResponseRef.current?.innerText ?? `${ticker} - ${askQuery}`}
                          title={`${ticker} ${askIntent} insight`}
                          filename={`${ticker.toLowerCase()}-${askIntent}-insight`}
                          variant="compact"
                        />
                      </div>
                    )}
                    <div ref={askResponseRef}>
                      {renderAskResponse()}
                    </div>
                  </div>
                </div>

                {/* Recent Developments */}
                <div className="bg-surface border border-border-color rounded-2xl p-6 flex flex-col">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-bold text-foreground">Recent Developments</h2>
                    <span className="material-symbols-outlined text-muted">newspaper</span>
                  </div>
                  {newsLoading && newsLimit === 10 ? (
                    <div className="space-y-3">
                      {[...Array(3)].map((_, i) => (
                        <div key={i} className="flex gap-3 p-4 rounded-lg border border-border-color/50 animate-pulse">
                          <div className="w-20 h-20 bg-surface-highlight rounded-md"></div>
                          <div className="flex-1 space-y-2">
                            <div className="h-4 bg-surface-highlight rounded w-3/4"></div>
                            <div className="h-3 bg-surface-highlight rounded w-1/2"></div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : newsError ? (
                    <div className="text-center py-8 text-muted">
                      <span className="material-symbols-outlined text-4xl mb-2 opacity-50">error</span>
                      <p className="text-sm">Unable to load news</p>
                    </div>
                  ) : news.length === 0 ? (
                    <div className="text-center py-8 text-muted">
                      <span className="material-symbols-outlined text-4xl mb-2 opacity-50">newspaper</span>
                      <p className="text-sm">No recent news available</p>
                    </div>
                  ) : (
                    <div
                      ref={newsScrollRef}
                      className="overflow-y-auto max-h-[600px] space-y-3 custom-scrollbar pr-1"
                    >
                      {news.map((article, index) => (
                        <NewsCard key={index} article={article} />
                      ))}

                      {/* Sentinel — triggers load-more when scrolled into view */}
                      <div ref={newsSentinelRef} className="h-1" />

                      {newsFetching && (
                        <div className="py-3 text-center">
                          <span className="inline-block w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin"></span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}

            {activeTab === "Financials" && (
              <>
                <div className="bg-surface border border-border-color rounded-2xl p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap gap-2">
                      {financialSections.map((section) => (
                        <button
                          key={section.id}
                          onClick={() => setFinancialSection(section.id)}
                          className={`px-3 py-1.5 text-xs font-medium rounded-2xl transition-colors ${financialSection === section.id
                            ? "bg-surface-highlight text-foreground border border-border-color"
                            : "text-muted hover:text-foreground hover:bg-surface-highlight"
                            }`}
                        >
                          {section.label}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      {(["annual", "quarterly", "ttm"] as FinancialPeriod[]).map((period) => (
                        <button
                          key={period}
                          onClick={() => setFinancialPeriod(period)}
                          className={`px-3 py-1.5 text-xs font-medium rounded-2xl transition-colors ${financialPeriod === period
                            ? "bg-primary text-white"
                            : "text-muted hover:text-foreground hover:bg-surface-highlight"
                            }`}
                        >
                          {period === "annual" ? "Annual" : period === "quarterly" ? "Quarterly" : "TTM"}
                        </button>
                      ))}
                      <button className="p-2 text-muted hover:text-foreground transition-colors">
                        <span className="material-symbols-outlined text-lg">more_vert</span>
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 mt-3">
                    <span className="text-[11px] text-muted uppercase tracking-wider">Download CSV</span>
                    {financialSections.map((section) => {
                      const canDownload = canDownloadSection(section.id);
                      return (
                        <button
                          key={`${section.id}-download`}
                          onClick={() => downloadFinancialCsv(section.id)}
                          disabled={!canDownload}
                          className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold rounded-full border transition-colors ${canDownload
                            ? "border-border-color text-muted hover:text-foreground hover:border-primary"
                            : "border-border-color/40 text-muted/50 cursor-not-allowed"
                            }`}
                        >
                          <span className="material-symbols-outlined !text-[14px]">download</span>
                          {section.label}
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 mt-3 text-xs text-muted">
                    <span>
                      Currency: {currency}
                    </span>
                    {financials?.generated_at && (
                      <span>
                        Updated {new Date(financials.generated_at).toLocaleDateString("en-US")}
                      </span>
                    )}
                  </div>

                  <div className="mt-4">
                    {financialsLoading && (
                      <div className="text-center text-muted py-10">
                        <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-primary mx-auto mb-3"></div>
                        <p className="text-sm">Loading financials...</p>
                      </div>
                    )}

                    {!financialsLoading && (financialsError || !financials) && (
                      <div className="text-center text-muted py-10">
                        <span className="material-symbols-outlined text-4xl mb-2 opacity-50">monitoring</span>
                        <p className="text-sm">{financialsError || "No financials available for this ticker."}</p>
                      </div>
                    )}

                    {!financialsLoading && !financialsError && financials && (
                      <FinancialTable table={resolvedFinancialTable || undefined} />
                    )}
                  </div>
                </div>
              </>
            )}

            {activeTab === "Holders" && (
              <div className="bg-surface border border-border-color rounded-2xl p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap gap-2">
                    {holdersSections.map((section) => (
                      <button
                        key={section.id}
                        onClick={() => setHoldersSection(section.id)}
                        className={`px-3 py-1.5 text-xs font-medium rounded-2xl transition-colors ${holdersSection === section.id
                          ? "bg-surface-highlight text-foreground border border-border-color"
                          : "text-muted hover:text-foreground hover:bg-surface-highlight"
                          }`}
                      >
                        {section.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2 mt-3 text-xs text-muted">
                  {holders?.generated_at && (
                    <span>
                      Updated {new Date(holders.generated_at).toLocaleDateString("en-US")}
                    </span>
                  )}
                </div>

                <div className="mt-4">
                  {holdersLoading && (
                    <div className="text-center text-muted py-10">
                      <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-primary mx-auto mb-3"></div>
                      <p className="text-sm">Loading holders...</p>
                    </div>
                  )}

                  {!holdersLoading && (holdersError || !holders) && (
                    <div className="text-center text-muted py-10">
                      <span className="material-symbols-outlined text-4xl mb-2 opacity-50">groups</span>
                      <p className="text-sm">{holdersError || "No holders data available for this ticker."}</p>
                    </div>
                  )}

                  {!holdersLoading && !holdersError && holders && (
                    <HoldersTable table={holders.holders[holdersSection]} />
                  )}
                </div>
              </div>
            )}

            {activeTab === "Filings" && (
              <div className="bg-surface border border-border-color rounded-2xl p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">SEC Filings</h3>
                    <p className="text-xs text-muted mt-1">Forms: 10-K, 10-Q, 8-K</p>
                  </div>
                </div>

                <div className="mt-4">
                  {filingsLoading && (
                    <div className="text-center text-muted py-10">
                      <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-primary mx-auto mb-3"></div>
                      <p className="text-sm">Loading filings...</p>
                    </div>
                  )}

                  {!filingsLoading && filingsError && (
                    <div className="text-center text-muted py-10">
                      <span className="material-symbols-outlined text-4xl mb-2 opacity-50">description</span>
                      <p className="text-sm">{filingsError}</p>
                    </div>
                  )}

                  {!filingsLoading && !filingsError && filings.length === 0 && (
                    <div className="text-center text-muted py-10">
                      <span className="material-symbols-outlined text-4xl mb-2 opacity-50">description</span>
                      <p className="text-sm">No recent filings found</p>
                    </div>
                  )}

                  {!filingsLoading && !filingsError && filings.length > 0 && (
                    <FilingsTable filings={filings} />
                  )}
                </div>
              </div>
            )}

          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Key Stats */}
            <div className="bg-surface border border-border-color rounded-2xl p-6">
              <h3 className="text-sm font-bold text-foreground mb-4 uppercase tracking-wider">Key Statistics</h3>
              <div className="space-y-3">
                <div className="flex justify-between items-center py-2 border-b border-border-color">
                  <span className="text-sm text-muted">Symbol</span>
                  <span className="text-sm font-semibold text-foreground">{ticker}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-border-color">
                  <span className="text-sm text-muted">52W High</span>
                  <span className="text-sm font-semibold text-foreground">
                    ${stats?.high52w != null ? stats.high52w.toFixed(2) : "-"}
                  </span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-border-color">
                  <span className="text-sm text-muted">52W Low</span>
                  <span className="text-sm font-semibold text-foreground">
                    ${stats?.low52w != null ? stats.low52w.toFixed(2) : "-"}
                  </span>
                </div>
                {profile?.sector && (
                  <div className="flex justify-between items-center py-2 border-b border-border-color">
                    <span className="text-sm text-muted">Sector</span>
                    <span className="text-sm font-semibold text-foreground">{profile.sector}</span>
                  </div>
                )}
                {profile?.industry && (
                  <div className="flex justify-between items-center py-2 border-b border-border-color">
                    <span className="text-sm text-muted">Industry</span>
                    <span className="text-sm font-semibold text-foreground truncate ml-4 text-right">{profile.industry}</span>
                  </div>
                )}
                <div className="flex justify-between items-center py-2 border-b border-border-color">
                  <span className="text-sm text-muted">Exchange</span>
                  <span className="text-sm font-semibold text-foreground">{profile?.exchange || "—"}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-border-color">
                  <span className="text-sm text-muted">Country</span>
                  <span className="text-sm font-semibold text-foreground">{profile?.country || "—"}</span>
                </div>
                {profile?.employees != null && (
                  <div className="flex justify-between items-center py-2 border-b border-border-color">
                    <span className="text-sm text-muted">Employees</span>
                    <span className="text-sm font-semibold text-foreground">{profile.employees.toLocaleString()}</span>
                  </div>
                )}
                {profile?.website && (
                  <div className="flex justify-between items-center py-2 border-b border-border-color">
                    <span className="text-sm text-muted">Website</span>
                    <a href={profile.website} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-primary hover:underline truncate ml-4">
                      {profile.website.replace(/^https?:\/\/(www\.)?/, "")}
                    </a>
                  </div>
                )}
              </div>

              {/* Valuation Ratios */}
              {financials?.valuation_ratios && (
                <>
                  <h4 className="text-xs font-bold text-muted mt-5 mb-3 uppercase tracking-wider">Valuation</h4>
                  <div className="space-y-3">
                    {financials.valuation_ratios.trailing_pe != null && (
                      <div className="flex justify-between items-center py-2 border-b border-border-color">
                        <span className="text-sm text-muted">P/E (TTM)</span>
                        <span className="text-sm font-semibold text-foreground">{financials.valuation_ratios.trailing_pe.toFixed(2)}</span>
                      </div>
                    )}
                    {financials.valuation_ratios.forward_pe != null && (
                      <div className="flex justify-between items-center py-2 border-b border-border-color">
                        <span className="text-sm text-muted">Forward P/E</span>
                        <span className="text-sm font-semibold text-foreground">{financials.valuation_ratios.forward_pe.toFixed(2)}</span>
                      </div>
                    )}
                    {financials.valuation_ratios.price_to_sales != null && (
                      <div className="flex justify-between items-center py-2 border-b border-border-color">
                        <span className="text-sm text-muted">P/S</span>
                        <span className="text-sm font-semibold text-foreground">{financials.valuation_ratios.price_to_sales.toFixed(2)}</span>
                      </div>
                    )}
                    {financials.valuation_ratios.price_to_book != null && (
                      <div className="flex justify-between items-center py-2 border-b border-border-color">
                        <span className="text-sm text-muted">P/B</span>
                        <span className="text-sm font-semibold text-foreground">{financials.valuation_ratios.price_to_book.toFixed(2)}</span>
                      </div>
                    )}
                    {financials.valuation_ratios.ev_to_ebitda != null && (
                      <div className="flex justify-between items-center py-2 border-b border-border-color">
                        <span className="text-sm text-muted">EV/EBITDA</span>
                        <span className="text-sm font-semibold text-foreground">{financials.valuation_ratios.ev_to_ebitda.toFixed(2)}</span>
                      </div>
                    )}
                    {financials.valuation_ratios.peg_ratio != null && (
                      <div className="flex justify-between items-center py-2 border-b border-border-color">
                        <span className="text-sm text-muted">PEG</span>
                        <span className="text-sm font-semibold text-foreground">{financials.valuation_ratios.peg_ratio.toFixed(2)}</span>
                      </div>
                    )}
                    {financials.valuation_ratios.dividend_yield != null && (
                      <div className="flex justify-between items-center py-2 border-b border-border-color">
                        <span className="text-sm text-muted">Div Yield</span>
                        <span className="text-sm font-semibold text-foreground">{(financials.valuation_ratios.dividend_yield * 100).toFixed(2)}%</span>
                      </div>
                    )}
                    {financials.valuation_ratios.beta != null && (
                      <div className="flex justify-between items-center py-2">
                        <span className="text-sm text-muted">Beta</span>
                        <span className="text-sm font-semibold text-foreground">{financials.valuation_ratios.beta.toFixed(2)}</span>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Company About */}
            <div className="bg-surface border border-border-color rounded-2xl p-6">
              <h3 className="text-sm font-bold text-foreground mb-3 uppercase tracking-wider">About</h3>
              {profile?.description ? (
                <p className="text-sm text-muted leading-relaxed">
                  {profile.description}
                </p>
              ) : (
                <p className="text-sm text-muted leading-relaxed">
                  Company information loading...
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Expanded Chart Modal */}
      {isChartExpanded && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90"
          onClick={() => setIsChartExpanded(false)}
        >
          <div
            className="bg-[#0a0a0a] border border-white/10 rounded-lg w-full max-w-[96vw] h-[92vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="px-5 py-3 border-b border-white/10 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                {logoUrl && (
                  <img src={logoUrl} alt="" className="h-6 w-6 rounded-full bg-white object-cover p-0.5" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                )}
                <h2 className="text-sm font-semibold text-white">{ticker}</h2>
                {stats && (
                  <span className={`text-sm font-bold ${stats.isPositive ? "text-[#00ff41]" : "text-[#ff0055]"}`}>
                    {stats.changePercent ? `${stats.isPositive ? "+" : ""}${stats.changePercent}%` : ""}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {/* Timeframe controls */}
                <div className="flex gap-1">
                  {(["1D", "5D", "1M", "3M", "6M", "YTD", "1Y", "5Y", "MAX"] as const).map((tf) => (
                    <button
                      key={tf}
                      onClick={() => handleTimeframeChange(tf)}
                      className={`px-2 py-1 text-[11px] font-medium rounded-md transition-colors ${timeframe === tf
                        ? "bg-primary text-white"
                        : "text-white/50 hover:text-white hover:bg-white/10"
                        }`}
                    >
                      {tf}
                    </button>
                  ))}
                </div>

                <div className="w-px h-5 bg-white/10" />

                {/* Interval controls */}
                <div className="flex gap-1">
                  {ALL_INTERVALS.map((iv) => {
                    const isValid = validIntervals.includes(iv);
                    const isActive = candleInterval === iv;
                    return (
                      <button
                        key={iv}
                        onClick={() => isValid && setCandleInterval(iv)}
                        disabled={!isValid}
                        className={`px-2 py-1 text-[11px] font-medium rounded-md transition-colors ${isActive
                            ? "bg-primary/20 text-primary border border-primary/40"
                            : isValid
                              ? "text-white/50 hover:text-white hover:bg-white/10"
                              : "text-white/15 cursor-not-allowed"
                          }`}
                      >
                        {INTERVAL_LABELS[iv]}
                      </button>
                    );
                  })}
                </div>

                <div className="w-px h-5 bg-white/10" />

                {/* Chart type toggle */}
                <div className="flex border border-white/10 rounded-md overflow-hidden">
                  <button
                    onClick={() => setChartType("area")}
                    className={`px-2.5 py-1 text-[11px] font-medium transition-colors ${chartType === "area"
                      ? "bg-primary text-white" : "text-white/50 hover:text-white"}`}
                  >
                    Line
                  </button>
                  <button
                    onClick={() => setChartType("candlestick")}
                    className={`px-2.5 py-1 text-[11px] font-medium transition-colors ${chartType === "candlestick"
                      ? "bg-primary text-white" : "text-white/50 hover:text-white"}`}
                  >
                    Candles
                  </button>
                </div>

                <div className="w-px h-5 bg-white/10" />

                <button
                  onClick={() => setIsChartExpanded(false)}
                  className="p-1.5 text-white/50 hover:text-white transition-colors"
                  title="Close"
                >
                  <span className="material-symbols-outlined text-lg">close</span>
                </button>
              </div>
            </div>

            {/* Modal Chart */}
            <div className="flex-1 p-4 min-h-0">
              {chartLoading ? (
                <div className="h-full flex items-center justify-center">
                  <div className="h-6 w-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                </div>
              ) : chartType === "area" ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="colorPriceModal" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={stats?.isPositive ? "#00ff41" : "#ff0055"} stopOpacity={0.3} />
                        <stop offset="95%" stopColor={stats?.isPositive ? "#00ff41" : "#ff0055"} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="date"
                      stroke="#e8e4d9"
                      tick={{ fill: "#e8e4d9", fontSize: 11 }}
                      tickLine={false}
                    />
                    <YAxis
                      stroke="#e8e4d9"
                      tick={{ fill: "#e8e4d9", fontSize: 11 }}
                      tickLine={false}
                      domain={["dataMin - 5", "dataMax + 5"]}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#1a1a1a",
                        border: "1px solid #333",
                        borderRadius: "8px",
                        fontSize: "12px"
                      }}
                      labelStyle={{ color: "#999" }}
                    />
                    <Area
                      type="monotone"
                      dataKey="close"
                      stroke={stats?.isPositive ? "#00ff41" : "#ff0055"}
                      strokeWidth={2}
                      fill="url(#colorPriceModal)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <CandlestickChart
                  data={chartData}
                  height={typeof window !== "undefined" ? window.innerHeight * 0.92 - 80 : 600}
                  showVolume={true}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type TableRow = FinancialTableData["rows"][number];

function normalizeLabel(label: string) {
  return label.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findRow(table: FinancialTableData | undefined, keys: string[]): TableRow | null {
  if (!table) return null;
  const normalizedKeys = keys.map(normalizeLabel);
  return (
    table.rows.find((row) =>
      normalizedKeys.some((key) => normalizeLabel(row.label).includes(key))
    ) || null
  );
}

function alignValuesToColumns(
  table: FinancialTableData | undefined,
  row: TableRow | null,
  columns: string[]
): FinancialValue[] {
  if (!table || !row) return columns.map(() => null);
  const mapping = new Map<string, FinancialValue>();
  table.columns.forEach((column, idx) => {
    mapping.set(column, row.values[idx] ?? null);
  });
  return columns.map((column) => mapping.get(column) ?? null);
}

function fillMissing(values: FinancialValue[], fallback?: FinancialValue) {
  if (fallback === undefined || fallback === null) return values;
  return values.map((value) => (value === null || value === undefined ? fallback : value));
}

function getPrimaryColumns(...tables: Array<FinancialTableData | undefined>) {
  for (const table of tables) {
    if (table?.columns?.length) return table.columns;
  }
  return [];
}

function percentString(value: number | null) {
  if (value === null || Number.isNaN(value)) return null;
  return `${value.toFixed(1)}%`;
}

function computeGrowthRow(values: FinancialValue[]) {
  return values.map((value, index) => {
    if (index === 0) return null;
    const prev = values[index - 1];
    if (typeof value !== "number" || typeof prev !== "number" || prev === 0) return null;
    const pct = ((value - prev) / Math.abs(prev)) * 100;
    return percentString(pct);
  });
}

function computeMarginRow(values: FinancialValue[], revenueValues: FinancialValue[]) {
  return values.map((value, index) => {
    const revenue = revenueValues[index];
    if (typeof value !== "number" || typeof revenue !== "number" || revenue === 0) return null;
    return percentString((value / revenue) * 100);
  });
}

function sumLast(values: FinancialValue[], count: number) {
  const slice = values.slice(-count);
  const numeric = slice.filter((v) => typeof v === "number") as number[];
  if (!numeric.length) return null;
  return numeric.reduce((sum, v) => sum + v, 0);
}

function buildTtmTable(table?: FinancialTableData): FinancialTableData | undefined {
  if (!table) return table;
  if (!table.columns.length || !table.rows.length) return table;

  return {
    columns: ["TTM"],
    rows: table.rows.map((row) => ({
      label: row.label,
      values: [sumLast(row.values, 4)],
    })),
  };
}

function buildMostRecentTable(table?: FinancialTableData): FinancialTableData | undefined {
  if (!table) return table;
  if (!table.columns.length || !table.rows.length) return table;
  const lastIndex = table.columns.length - 1;
  return {
    columns: [table.columns[lastIndex]],
    rows: table.rows.map((row) => ({
      label: row.label,
      values: [row.values[lastIndex] ?? null],
    })),
  };
}

interface KeyStatsBuildArgs {
  period: FinancialPeriod;
  incomeAnnual?: FinancialTableData;
  incomeQuarterly?: FinancialTableData;
  balanceAnnual?: FinancialTableData;
  balanceQuarterly?: FinancialTableData;
  cashAnnual?: FinancialTableData;
  cashQuarterly?: FinancialTableData;
  keyStats?: Record<string, FinancialValue>;
  valuationRatios?: ValuationRatios;
}

function buildKeyStatsTable(args: KeyStatsBuildArgs): FinancialTableData | undefined {
  const {
    period,
    incomeAnnual,
    incomeQuarterly,
    balanceAnnual,
    balanceQuarterly,
    cashAnnual,
    cashQuarterly,
    keyStats,
    valuationRatios,
  } = args;

  const income = period === "annual" ? incomeAnnual : incomeQuarterly;
  const balance = period === "annual" ? balanceAnnual : balanceQuarterly;
  const cash = period === "annual" ? cashAnnual : cashQuarterly;

  if (period === "ttm") {
    const ttmIncome = buildTtmTable(incomeQuarterly);
    const ttmCash = buildTtmTable(cashQuarterly);
    const latestBalance = buildMostRecentTable(balanceQuarterly);
    const columns = ["TTM"];

    const cashRow = findRow(latestBalance, ["cash", "cash and cash equivalents", "cash and short term investments"]);
    const debtRow = findRow(latestBalance, ["total debt", "long term debt", "short long term debt total"]);
    const revenueRow = findRow(ttmIncome, ["total revenue", "revenue"]);
    const grossRow = findRow(ttmIncome, ["gross profit"]);
    const ebitdaRow = findRow(ttmIncome, ["ebitda"]);
    const netIncomeRow = findRow(ttmIncome, ["net income"]);
    const epsRow = findRow(ttmIncome, ["diluted eps", "eps diluted", "diluted eps"]);
    const opCashRow = findRow(ttmCash, ["operating cash flow", "total cash from operating activities"]);
    const capexRow = findRow(ttmCash, ["capital expenditure", "capital expenditures", "capital expenditure"]);
    const fcfRow = findRow(ttmCash, ["free cash flow"]);

    const rows: TableRow[] = [];
    const pushRow = (label: string, value: FinancialValue) => {
      if (value === null || value === undefined) return;
      rows.push({ label, values: [value] });
    };

    pushRow("Market Cap", keyStats?.market_cap ?? null);
    pushRow("- Cash", cashRow?.values?.[0] ?? keyStats?.total_cash ?? null);
    pushRow("+ Debt", debtRow?.values?.[0] ?? keyStats?.total_debt ?? null);
    pushRow("Enterprise Value", keyStats?.enterprise_value ?? null);
    pushRow("Revenue", revenueRow?.values?.[0] ?? keyStats?.total_revenue ?? null);
    pushRow("Gross Profit", grossRow?.values?.[0] ?? keyStats?.gross_profit ?? null);
    pushRow("EBITDA", ebitdaRow?.values?.[0] ?? keyStats?.ebitda ?? null);
    pushRow("Net Income", netIncomeRow?.values?.[0] ?? keyStats?.net_income ?? null);
    pushRow("EPS Diluted", epsRow?.values?.[0] ?? keyStats?.eps_diluted ?? null);
    pushRow("Operating Cash Flow", opCashRow?.values?.[0] ?? null);
    pushRow("Capital Expenditures", capexRow?.values?.[0] ?? null);
    pushRow("Free Cash Flow", fcfRow?.values?.[0] ?? null);
    pushRow("P/E Ratio", valuationRatios?.trailing_pe ?? null);
    pushRow("Forward P/E", valuationRatios?.forward_pe ?? null);
    pushRow("EV / EBITDA", valuationRatios?.ev_to_ebitda ?? null);
    pushRow("Price / Sales", valuationRatios?.price_to_sales ?? null);
    pushRow("Price / Book", valuationRatios?.price_to_book ?? null);
    pushRow("PEG Ratio", valuationRatios?.peg_ratio ?? null);

    return { columns, rows };
  }

  const columns = getPrimaryColumns(income, balance, cash);
  if (!columns.length) return { columns: [], rows: [] };

  const revenueValues = fillMissing(
    alignValuesToColumns(income, findRow(income, ["total revenue", "revenue"]), columns),
    keyStats?.total_revenue
  );
  const grossValues = fillMissing(
    alignValuesToColumns(income, findRow(income, ["gross profit"]), columns),
    keyStats?.gross_profit
  );
  const ebitdaValues = fillMissing(
    alignValuesToColumns(income, findRow(income, ["ebitda"]), columns),
    keyStats?.ebitda
  );
  const netIncomeValues = fillMissing(
    alignValuesToColumns(income, findRow(income, ["net income"]), columns),
    keyStats?.net_income
  );
  const epsValues = fillMissing(
    alignValuesToColumns(income, findRow(income, ["diluted eps", "eps diluted", "diluted eps"]), columns),
    keyStats?.eps_diluted
  );
  const cashValues = fillMissing(
    alignValuesToColumns(balance, findRow(balance, ["cash", "cash and cash equivalents", "cash and short term investments"]), columns),
    keyStats?.total_cash
  );
  const debtValues = fillMissing(
    alignValuesToColumns(balance, findRow(balance, ["total debt", "long term debt", "short long term debt total"]), columns),
    keyStats?.total_debt
  );
  const opCashValues = alignValuesToColumns(
    cash,
    findRow(cash, ["operating cash flow", "total cash from operating activities"]),
    columns
  );
  const capexValues = alignValuesToColumns(
    cash,
    findRow(cash, ["capital expenditure", "capital expenditures", "capital expenditure"]),
    columns
  );
  const fcfValues = alignValuesToColumns(cash, findRow(cash, ["free cash flow"]), columns);

  const rows: TableRow[] = [];
  const pushRow = (label: string, values: FinancialValue[]) => {
    if (!values.some((value) => value !== null && value !== undefined)) return;
    rows.push({ label, values });
  };

  pushRow("Market Cap", fillMissing(columns.map(() => null), keyStats?.market_cap));
  pushRow("- Cash", cashValues);
  pushRow("+ Debt", debtValues);
  pushRow("Enterprise Value", fillMissing(columns.map(() => null), keyStats?.enterprise_value));
  pushRow("Revenue", revenueValues);
  pushRow("% Growth", computeGrowthRow(revenueValues));
  pushRow("Gross Profit", grossValues);
  pushRow("% Margin", computeMarginRow(grossValues, revenueValues));
  pushRow("EBITDA", ebitdaValues);
  pushRow("% Margin", computeMarginRow(ebitdaValues, revenueValues));
  pushRow("Net Income", netIncomeValues);
  pushRow("% Margin", computeMarginRow(netIncomeValues, revenueValues));
  pushRow("EPS Diluted", epsValues);
  pushRow("% Growth", computeGrowthRow(epsValues));
  pushRow("Operating Cash Flow", opCashValues);
  pushRow("Capital Expenditures", capexValues);
  pushRow("Free Cash Flow", fcfValues);
  const valFill = (v: number | null | undefined) => fillMissing(columns.map(() => null), v ?? undefined);
  pushRow("P/E Ratio", valFill(valuationRatios?.trailing_pe));
  pushRow("Forward P/E", valFill(valuationRatios?.forward_pe));
  pushRow("EV / EBITDA", valFill(valuationRatios?.ev_to_ebitda));
  pushRow("Price / Sales", valFill(valuationRatios?.price_to_sales));
  pushRow("Price / Book", valFill(valuationRatios?.price_to_book));
  pushRow("PEG Ratio", valFill(valuationRatios?.peg_ratio));

  return { columns, rows };
}

interface FinancialTableProps {
  table?: FinancialTableData;
}

function FinancialTable({ table }: FinancialTableProps) {
  const numberFormatter = new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2
  });

  const formatPeriodLabel = (value: string) => {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleDateString("en-US");
    }
    return value;
  };

  const formatValue = (value: FinancialValue) => {
    if (value === null || value === undefined) return "-";
    if (typeof value === "number") {
      const sign = value < 0 ? "-" : "";
      const formatted = numberFormatter.format(Math.abs(value));
      return `${sign}${formatted}`;
    }
    return String(value);
  };

  const needsScroll = table && table.columns.length > 2;

  return (
    <div className={needsScroll ? "overflow-x-auto custom-scrollbar" : ""}>
      {!table || !table.columns.length || !table.rows.length ? (
        <div className="text-sm text-muted py-6 text-center">No data available.</div>
      ) : (
        <table className={`w-full text-sm${needsScroll ? " min-w-[680px]" : ""}`}>
          <thead>
            <tr className="text-muted border-b border-border-color">
              <th className="text-left font-medium pb-2 pr-4">Line Item</th>
              {table.columns.map((column) => (
                <th key={column} className="text-right font-medium pb-2">
                  {formatPeriodLabel(column)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border-color">
            {table.rows.map((row, rowIndex) => {
              const isPercentRow = row.label.includes("%");
              const isSubRow = row.label.startsWith("-") || row.label.startsWith("+");
              const labelClass = isPercentRow
                ? "text-muted text-xs"
                : isSubRow
                  ? "text-muted"
                  : "text-foreground";
              const valueClass = isPercentRow ? "text-muted text-xs" : "text-foreground";

              return (
                <tr key={`${row.label}-${rowIndex}`} className="align-top hover:bg-surface-highlight/60">
                  <td className={`py-2 pr-4 ${labelClass}`}>{row.label}</td>
                  {row.values.map((value, idx) => (
                    <td key={`${row.label}-${idx}`} className={`py-2 text-right ${valueClass}`}>
                      {formatValue(value)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

interface HoldersTableProps {
  table?: HolderTableData;
}

function HoldersTable({ table }: HoldersTableProps) {
  const numberFormatter = new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2
  });

  const formatValue = (value: HolderValue, column?: string) => {
    if (value === null || value === undefined) return "-";
    if (typeof value === "number") {
      if (column && /%|percent/i.test(column)) {
        const normalized = value <= 1 ? value * 100 : value;
        return `${normalized.toFixed(2)}%`;
      }
      return numberFormatter.format(value);
    }
    const asDate = new Date(value);
    if (!Number.isNaN(asDate.getTime())) {
      return asDate.toLocaleDateString("en-US");
    }
    return String(value);
  };

  if (!table || !table.columns.length || !table.rows.length) {
    return <div className="text-sm text-muted py-6 text-center">No data available.</div>;
  }

  return (
    <div className="overflow-x-auto custom-scrollbar">
      <table className="min-w-[680px] w-full text-sm">
        <thead>
          <tr className="text-muted border-b border-border-color">
            <th className="text-left font-medium pb-2 pr-4">Holder</th>
            {table.columns.map((column) => (
              <th key={column} className="text-right font-medium pb-2">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border-color">
          {table.rows.map((row) => (
            <tr key={row.label} className="align-top hover:bg-surface-highlight/60">
              <td className="py-2 pr-4 text-foreground">{row.label}</td>
              {row.values.map((value, idx) => (
                <td key={`${row.label}-${idx}`} className="py-2 text-right text-foreground">
                  {formatValue(value, table.columns[idx])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toLocaleDateString("en-US");
  }
  return value;
}

function formatEarningsValue(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (Array.isArray(value)) {
    return value.map((item) => formatEarningsValue(item)).join(" - ");
  }
  if (typeof value === "number") {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
  }
  if (value instanceof Date) {
    return value.toLocaleDateString("en-US");
  }
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleDateString("en-US");
    }
  }
  return String(value);
}

type EarningsMetricFormat = "currency" | "eps";

interface EarningsComparisonRow {
  label: string;
  valueFormat: EarningsMetricFormat;
  latestQuarter: number | null;
  previousQuarter: number | null;
  qoqChangePct: number | null;
  ytdCurrent: number | null;
  ytdPrevious: number | null;
  ytdChangePct: number | null;
}

interface EarningsDetailData {
  asOfDate: string | null;
  nextEarningsDate: string | null;
  epsAverage: number | null;
  epsLow: number | null;
  epsHigh: number | null;
  revenueAverage: number | null;
  revenueLow: number | null;
  revenueHigh: number | null;
  ytdPriceChangePct: number | null;
  comparisonRows: EarningsComparisonRow[];
}

interface QuarterSeriesPoint {
  period: string;
  date: Date | null;
  value: number;
}

interface YtdComparison {
  current: number | null;
  previous: number | null;
  deltaPct: number | null;
  asOfDate: string | null;
}

function toNumericValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/,/g, "").trim();
    if (!cleaned) return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatComparisonMetricValue(format: EarningsMetricFormat, value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  if (format === "eps") return value.toFixed(2);

  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const compact = new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(abs);
  return `${sign}$${compact}`;
}

function formatDeltaPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function findEarningsRowValue(table: EarningsTableData | undefined, key: string): EarningsValue | null {
  const rows = table?.rows ?? [];
  const normalizedKey = normalizeLabel(key);
  const row = rows.find((item) => normalizeLabel(item.label).includes(normalizedKey));
  return row?.values?.[0] ?? null;
}

function extractQuarterSeries(table: FinancialTableData | undefined, keys: string[]): QuarterSeriesPoint[] {
  if (!table) return [];
  const row = findRow(table, keys);
  if (!row) return [];

  return table.columns
    .map((column, idx) => {
      const numeric = toNumericValue(row.values[idx]);
      if (numeric === null) return null;
      const parsedDate = new Date(column);
      return {
        period: column,
        date: Number.isNaN(parsedDate.getTime()) ? null : parsedDate,
        value: numeric,
      } as QuarterSeriesPoint;
    })
    .filter((point): point is QuarterSeriesPoint => point !== null);
}

function computeYtdComparison(points: QuarterSeriesPoint[]): YtdComparison {
  const dated = points
    .filter((point) => point.date !== null)
    .sort((a, b) => (a.date!.getTime() - b.date!.getTime()));

  if (!dated.length) {
    return { current: null, previous: null, deltaPct: null, asOfDate: null };
  }

  const latest = dated[dated.length - 1];
  const currentYear = latest.date!.getFullYear();
  const currentYearPoints = dated.filter((point) => point.date!.getFullYear() === currentYear);
  const ytdCount = currentYearPoints.length;
  if (!ytdCount) {
    return { current: null, previous: null, deltaPct: null, asOfDate: null };
  }

  const previousYearPoints = dated.filter((point) => point.date!.getFullYear() === currentYear - 1);
  const previousComparable = previousYearPoints.slice(0, ytdCount);

  const current = currentYearPoints.reduce((sum, point) => sum + point.value, 0);
  const previous =
    previousComparable.length === ytdCount
      ? previousComparable.reduce((sum, point) => sum + point.value, 0)
      : null;
  const deltaPct =
    previous !== null && previous !== 0
      ? ((current - previous) / Math.abs(previous)) * 100
      : null;

  return {
    current,
    previous,
    deltaPct,
    asOfDate: latest.date ? latest.date.toISOString().slice(0, 10) : null,
  };
}

function computePriceYtdChange(priceData: Array<{ fullDate: string; close: number }>): { deltaPct: number | null; asOfDate: string | null } {
  if (!priceData.length) return { deltaPct: null, asOfDate: null };

  const latest = priceData[priceData.length - 1];
  const latestDate = new Date(latest.fullDate);
  if (Number.isNaN(latestDate.getTime())) {
    return { deltaPct: null, asOfDate: null };
  }

  const startOfYear = new Date(latestDate.getFullYear(), 0, 1);
  const ytdStart = priceData.find((point) => {
    const date = new Date(point.fullDate);
    return !Number.isNaN(date.getTime()) && date >= startOfYear;
  });
  if (!ytdStart || ytdStart.close === 0) {
    return { deltaPct: null, asOfDate: latest.fullDate };
  }

  return {
    deltaPct: ((latest.close - ytdStart.close) / Math.abs(ytdStart.close)) * 100,
    asOfDate: latest.fullDate,
  };
}

function buildEarningsDetailData(
  earnings: { calendar?: EarningsTableData; earnings_dates?: EarningsTableData } | null,
  financials: FinancialsResponse | null,
  priceData: Array<{ fullDate: string; close: number }>
): EarningsDetailData | null {
  const calendar = earnings?.calendar;
  const nextEarningsDateRaw = findEarningsRowValue(calendar, "earnings date");
  const epsAverage = toNumericValue(findEarningsRowValue(calendar, "earnings average"));
  const epsLow = toNumericValue(findEarningsRowValue(calendar, "earnings low"));
  const epsHigh = toNumericValue(findEarningsRowValue(calendar, "earnings high"));
  const revenueAverage = toNumericValue(findEarningsRowValue(calendar, "revenue average"));
  const revenueLow = toNumericValue(findEarningsRowValue(calendar, "revenue low"));
  const revenueHigh = toNumericValue(findEarningsRowValue(calendar, "revenue high"));

  const incomeQuarterly = financials?.statements?.income_statement?.quarterly;
  const metricDefinitions: Array<{ label: string; keys: string[]; valueFormat: EarningsMetricFormat }> = [
    { label: "Revenue", keys: ["total revenue", "revenue"], valueFormat: "currency" },
    { label: "Net Income", keys: ["net income"], valueFormat: "currency" },
    { label: "Diluted EPS", keys: ["diluted eps", "eps diluted"], valueFormat: "eps" },
  ];

  let computedAsOfDate: string | null = null;

  const comparisonRows: EarningsComparisonRow[] = metricDefinitions.map((metric) => {
    const points = extractQuarterSeries(incomeQuarterly, metric.keys)
      .sort((a, b) => {
        if (a.date && b.date) return a.date.getTime() - b.date.getTime();
        return 0;
      });

    const latestPoint = points.length ? points[points.length - 1] : null;
    const previousPoint = points.length > 1 ? points[points.length - 2] : null;
    const latestQuarter = latestPoint?.value ?? null;
    const previousQuarter = previousPoint?.value ?? null;
    const qoqChangePct =
      latestQuarter !== null && previousQuarter !== null && previousQuarter !== 0
        ? ((latestQuarter - previousQuarter) / Math.abs(previousQuarter)) * 100
        : null;

    const ytd = computeYtdComparison(points);
    if (!computedAsOfDate && ytd.asOfDate) {
      computedAsOfDate = ytd.asOfDate;
    }

    return {
      label: metric.label,
      valueFormat: metric.valueFormat,
      latestQuarter,
      previousQuarter,
      qoqChangePct,
      ytdCurrent: ytd.current,
      ytdPrevious: ytd.previous,
      ytdChangePct: ytd.deltaPct,
    };
  });

  const meaningfulRows = comparisonRows.filter((row) => {
    return row.latestQuarter !== null || row.previousQuarter !== null || row.ytdCurrent !== null || row.ytdPrevious !== null;
  });

  const priceYtd = computePriceYtdChange(priceData);

  const hasSummary =
    nextEarningsDateRaw !== null ||
    epsAverage !== null ||
    epsLow !== null ||
    epsHigh !== null ||
    revenueAverage !== null ||
    revenueLow !== null ||
    revenueHigh !== null;

  if (!hasSummary && !meaningfulRows.length && priceYtd.deltaPct === null) {
    return null;
  }

  return {
    asOfDate: computedAsOfDate ?? priceYtd.asOfDate,
    nextEarningsDate: nextEarningsDateRaw !== null ? formatEarningsValue(nextEarningsDateRaw) : null,
    epsAverage,
    epsLow,
    epsHigh,
    revenueAverage,
    revenueLow,
    revenueHigh,
    ytdPriceChangePct: priceYtd.deltaPct,
    comparisonRows: meaningfulRows,
  };
}

function extractEarningsHighlights(earnings: { calendar?: EarningsTableData; earnings_dates?: EarningsTableData } | null) {
  if (!earnings) return [];

  const highlights: Array<{ label: string; value: string }> = [];
  const calendarRows = earnings.calendar?.rows ?? [];
  const desired = [
    "earnings date",
    "earnings average",
    "earnings high",
    "earnings low",
    "revenue average"
  ];

  for (const key of desired) {
    const row = calendarRows.find((item) => item.label.toLowerCase().includes(key));
    const value = row?.values?.[0];
    if (row && value !== undefined && value !== null) {
      highlights.push({ label: row.label, value: formatEarningsValue(value) });
    }
  }

  if (highlights.length) {
    return highlights.slice(0, 4);
  }

  const datesTable = earnings.earnings_dates;
  if (datesTable?.rows?.length) {
    const first = datesTable.rows[0];
    if (first?.label) {
      highlights.push({ label: "Latest Earnings Date", value: formatEarningsValue(first.label) });
    }
    datesTable.columns.forEach((column, idx) => {
      const value = first?.values?.[idx];
      if (column && value !== undefined && value !== null) {
        highlights.push({ label: column, value: formatEarningsValue(value) });
      }
    });
  }

  return highlights.slice(0, 4);
}

function sentimentTone(label?: string) {
  if (!label) return "text-muted";
  if (label.toLowerCase() === "positive") return "text-[#00ff41]";
  if (label.toLowerCase() === "negative") return "text-[#ff0055]";
  return "text-muted";
}

function SentimentCard({ title, summary }: { title: string; summary: { label: string; positive: number; negative: number; neutral: number; model?: string } }) {
  const total = summary.positive + summary.negative + summary.neutral;
  const positivePct = total ? (summary.positive / total) * 100 : 0;
  const neutralPct = total ? (summary.neutral / total) * 100 : 0;
  const negativePct = total ? (summary.negative / total) * 100 : 0;

  return (
    <div className="bg-surface-highlight rounded-2xl p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted uppercase tracking-wider">{title}</p>
        {summary.model && (
          <span className="text-[10px] text-muted uppercase">{summary.model}</span>
        )}
      </div>
      <p className={`mt-2 text-sm font-semibold ${sentimentTone(summary.label)}`}>
        {summary.label}
      </p>
      <div className="mt-3 flex h-2 w-full overflow-hidden rounded-full bg-border-color/40">
        <div style={{ width: `${positivePct}%` }} className="h-full bg-[#00ff41]" />
        <div style={{ width: `${neutralPct}%` }} className="h-full bg-border-color" />
        <div style={{ width: `${negativePct}%` }} className="h-full bg-[#ff0055]" />
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-muted">
        <span>Pos {positivePct.toFixed(0)}%</span>
        <span>Neu {neutralPct.toFixed(0)}%</span>
        <span>Neg {negativePct.toFixed(0)}%</span>
      </div>
    </div>
  );
}

function FilingsTable({ filings }: { filings: StockFiling[] }) {
  return (
    <div className="overflow-x-auto custom-scrollbar">
      <table className="min-w-[680px] w-full text-sm">
        <thead>
          <tr className="text-muted border-b border-border-color">
            <th className="text-left font-medium pb-2 pr-4">Form</th>
            <th className="text-left font-medium pb-2 pr-4">Date</th>
            <th className="text-left font-medium pb-2 pr-4">Description</th>
            <th className="text-left font-medium pb-2 pr-4">Sentiment</th>
            <th className="text-left font-medium pb-2">Link</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-color">
          {filings.map((filing, idx) => (
            <tr key={`${filing.form}-${filing.filing_date}-${idx}`} className="align-top hover:bg-surface-highlight/60">
              <td className="py-2 pr-4 text-foreground font-semibold">{filing.form}</td>
              <td className="py-2 pr-4 text-muted">{formatDate(filing.filing_date)}</td>
              <td className="py-2 pr-4 text-foreground">
                {filing.description || "SEC filing"}
              </td>
              <td className="py-2 pr-4">
                {filing.sentiment ? (
                  <span className={`text-xs font-semibold ${sentimentTone(filing.sentiment.label)}`}>
                    {filing.sentiment.label}
                  </span>
                ) : (
                  <span className="text-xs text-muted">-</span>
                )}
              </td>
              <td className="py-2">
                {filing.url ? (
                  <a
                    href={filing.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary hover:underline"
                  >
                    View
                  </a>
                ) : (
                  <span className="text-xs text-muted">-</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
