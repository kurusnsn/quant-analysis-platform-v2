"use client";
import { devConsole } from "@/lib/devLog";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import WatchlistNewsAggregator from "@/components/WatchlistNewsAggregator";
import DailyInsightsPanel from "@/components/DailyInsightsPanel";
import { authFetch } from "@/lib/authFetch";
import { readApiErrorMessage } from "@/lib/apiError";
import { MOCK_WATCHLISTS } from "@/constants";
import type { Watchlist as LocalWatchlist } from "@/types";
import CandlestickChart from "@/components/CandlestickChart";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

interface Asset {
    symbol: string;
    name?: string;
    logoUrl?: string | null;
    weight?: number;
}

interface RiskSnapshot {
    id: string;
    calculatedAt: string;
    volatility: number;
    var95: number;
    cvar95: number;
    lossProbability30d: number;
    regime: string;
}

interface WatchlistView {
    id: string;
    name: string;
    riskLevel?: string;
    createdAt?: string;
    updatedAt?: string;
    assets: Asset[];
    riskSnapshots?: RiskSnapshot[];
}

interface WatchlistQueryResult {
    watchlist: WatchlistView;
    isLocalFallback: boolean;
}

interface WatchlistAnalysisPayload {
    volatility?: number;
    var95?: number;
    var_95?: number;
    cvar95?: number;
    cvar_95?: number;
    lossProbability30d?: number;
    loss_probability_30d?: number;
    regime?: string;
}

interface AnalyzeMutationResult {
    localSnapshot: RiskSnapshot | null;
}

const API_URL = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/+$/, "");
const LOCAL_WATCHLISTS_KEY = "quant-platform_watchlists";
const WATCHLIST_SERIES_KEY = "__WATCHLIST__";

type WatchlistTab = "Overview" | "News";
type Timeframe = ChartTimeframe;
type ChartType = "area" | "candlestick";
type ChartMode = "price" | "cumulative";

const getStoredWatchlists = (): LocalWatchlist[] => {
    if (typeof window === "undefined") return [];
    try {
        const cached = localStorage.getItem(LOCAL_WATCHLISTS_KEY);
        if (!cached) return [];
        const parsed = JSON.parse(cached);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

const findLocalWatchlist = (id: string): LocalWatchlist | null => {
    const stored = getStoredWatchlists();
    const fromStorage = stored.find(w => w.id === id);
    if (fromStorage) return fromStorage;
    return MOCK_WATCHLISTS.find(w => w.id === id) || null;
};

const mapLocalToView = (local: LocalWatchlist): WatchlistView => ({
    id: local.id,
    name: local.name,
    riskLevel: local.riskLevel,
    assets: local.tickers.map(ticker => ({
        symbol: ticker.symbol,
        name: ticker.name,
        logoUrl: ticker.logoUrl || null
    })),
    riskSnapshots: [],
});

type TickerPricePoint = {
    date: string;
    fullDate: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
};

type WatchlistSeriesPoint = {
    date: string;
    fullDate: string;
    value: number;
};

const isTickerPricePoint = (point: TickerPricePoint | WatchlistSeriesPoint): point is TickerPricePoint => {
    return "close" in point;
};

const formatShortDate = (fullDate: string) => {
    const safe = fullDate.includes("T") ? fullDate : `${fullDate}T00:00:00Z`;
    return new Date(safe).toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

const cutoffIsoForTimeframe = (timeframe: Timeframe) => {
    const now = new Date();
    const cutoff = new Date(now);
    switch (timeframe) {
        case "1D":
        case "5D":
            return "";
        case "1M":
            cutoff.setMonth(now.getMonth() - 1);
            break;
        case "3M":
            cutoff.setMonth(now.getMonth() - 3);
            break;
        case "6M":
            cutoff.setMonth(now.getMonth() - 6);
            break;
        case "YTD":
            return `${now.getFullYear()}-01-01`;
        case "1Y":
            cutoff.setFullYear(now.getFullYear() - 1);
            break;
        case "5Y":
            cutoff.setFullYear(now.getFullYear() - 5);
            break;
        case "MAX":
            return "1900-01-01";
    }
    return cutoff.toISOString().slice(0, 10);
};

const filterByTimeframe = <T extends { fullDate: string }>(data: T[], timeframe: Timeframe) => {
    if (!data.length) return [];
    const sorted = [...data].sort((a, b) => a.fullDate.localeCompare(b.fullDate));

    if (timeframe === "1D") return sorted.slice(-1);
    if (timeframe === "5D") return sorted.slice(-5);

    const cutoffIso = cutoffIsoForTimeframe(timeframe);
    if (!cutoffIso) return sorted;
    return sorted.filter((item) => item.fullDate >= cutoffIso);
};

const toNumberOrZero = (value: unknown) => {
    const numeric = typeof value === "number" ? value : Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
};

const mapAnalysisToSnapshot = (payload: WatchlistAnalysisPayload): RiskSnapshot => ({
    id: `local-${Date.now()}`,
    calculatedAt: new Date().toISOString(),
    volatility: toNumberOrZero(payload.volatility),
    var95: toNumberOrZero(payload.var95 ?? payload.var_95),
    cvar95: toNumberOrZero(payload.cvar95 ?? payload.cvar_95),
    lossProbability30d: toNumberOrZero(payload.lossProbability30d ?? payload.loss_probability_30d),
    regime: typeof payload.regime === "string" && payload.regime.trim() ? payload.regime : "unknown",
});

const formatSignedPercent = (value?: number | null, digits = 2) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return "N/A";
    return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
};

export default function WatchlistDetailPage() {
    const params = useParams();
    const router = useRouter();
    const queryClient = useQueryClient();
    const [activeTab, setActiveTab] = useState<WatchlistTab>("Overview");
    const [timeframe, setTimeframe] = useState<Timeframe>("1M");
    const [candleInterval, setCandleInterval] = useState<CandleInterval>(getDefaultInterval("1M"));
    const [chartType, setChartType] = useState<ChartType>("area");
    const [chartMode, setChartMode] = useState<ChartMode>("price");
    const [expandedStock, setExpandedStock] = useState<string | null>(null);
    const [selectedSymbol, setSelectedSymbol] = useState<string>(WATCHLIST_SERIES_KEY);
    const [localSnapshot, setLocalSnapshot] = useState<{ watchlistId: string; snapshot: RiskSnapshot } | null>(null);
    const autoAnalyzeKeyRef = useRef<string | null>(null);

    const handleTimeframeChange = (tf: Timeframe) => {
        setTimeframe(tf);
        const valid = getValidIntervals(tf);
        if (!valid.includes(candleInterval)) {
            setCandleInterval(getDefaultInterval(tf));
        }
    };

    const validIntervals = getValidIntervals(timeframe);

    const id = params?.id as string;

    const watchlistQuery = useQuery({
        queryKey: ["watchlist", id],
        enabled: Boolean(id),
        queryFn: async ({ signal }) => {
            if (API_URL) {
                try {
                    const res = await authFetch(`${API_URL}/watchlists/${id}`, { signal });
                    if (res.ok) {
                        const data = await res.json();
                        return { watchlist: data, isLocalFallback: false } as WatchlistQueryResult;
                    }
                } catch (error) {
                    if (!(error instanceof Error && error.name === "AbortError")) {
                        devConsole.error("Failed to load watchlist:", error);
                    }
                }
            }

            const local = findLocalWatchlist(id);
            if (local) {
                return { watchlist: mapLocalToView(local), isLocalFallback: true } as WatchlistQueryResult;
            }

            throw new Error("Watchlist not found");
        },
        staleTime: 60 * 1000,
    });

    const analyzeMutation = useMutation<AnalyzeMutationResult>({
        mutationFn: async () => {
            if (!API_URL) {
                throw new Error("Analysis unavailable");
            }

            if (!watchlist) {
                throw new Error("Watchlist unavailable");
            }

            const tickers = watchlist.assets
                .map((asset) => asset.symbol?.toUpperCase())
                .filter((symbol): symbol is string => Boolean(symbol));

            if (tickers.length === 0) {
                throw new Error("Watchlist has no tickers");
            }

            if (isLocalFallback) {
                const res = await authFetch(`${API_URL}/analysis/watchlist`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ tickers }),
                });

                if (!res.ok) {
                    const message = await readApiErrorMessage(res, "Analysis failed.");
                    throw new Error(message);
                }

                const payload = (await res.json()) as WatchlistAnalysisPayload;
                return { localSnapshot: mapAnalysisToSnapshot(payload) };
            }

            const res = await authFetch(`${API_URL}/watchlists/${id}/analyze`, {
                method: "POST",
            });

            if (!res.ok) {
                const message = await readApiErrorMessage(res, "Analysis failed.");
                throw new Error(message);
            }

            return { localSnapshot: null };
        },
        onSuccess: (result) => {
            if (result.localSnapshot) {
                setLocalSnapshot({ watchlistId: id, snapshot: result.localSnapshot });
                return;
            }
            queryClient.invalidateQueries({ queryKey: ["watchlist", id] });
            queryClient.invalidateQueries({ queryKey: ["dailyInsights", id] });
        },
    });

    const watchlist = watchlistQuery.data?.watchlist ?? null;
    const isLocalFallback = watchlistQuery.data?.isLocalFallback ?? false;
    const loading = watchlistQuery.isLoading;
    const error = watchlistQuery.error instanceof Error
        ? watchlistQuery.error.message
        : analyzeMutation.error instanceof Error
            ? analyzeMutation.error.message
            : watchlistQuery.error || analyzeMutation.error
                ? "Failed to load"
                : null;
    const showUpgradeAction =
        typeof error === "string" &&
        (error.toLowerCase().includes("trial") || error.toLowerCase().includes("upgrade"));

    const analyzing = analyzeMutation.isPending;
    const canAnalyze = !!API_URL && Boolean(watchlist?.assets?.length);

    // Fetch logos/prices for all assets (must be after we have `watchlist`)
    const assetSymbols = useMemo(
        () => (watchlist?.assets?.map(a => a.symbol?.toUpperCase()).filter(Boolean) as string[]) || [],
        [watchlist]
    );
    const { getLogo } = useCompanyLogos(assetSymbols);
    const { prices, loading: pricesLoading } = useStockPrices();

    const runAnalysis = () => {
        if (!canAnalyze || analyzing) return;
        analyzeMutation.mutate();
    };

    const latestSnapshot = watchlist?.riskSnapshots?.[0] ?? (
        localSnapshot?.watchlistId === id ? localSnapshot.snapshot : null
    );

    useEffect(() => {
        if (!watchlist || !canAnalyze || analyzing || latestSnapshot) {
            return;
        }
        const symbolsKey = watchlist.assets
            .map((asset) => asset.symbol?.toUpperCase())
            .filter((symbol): symbol is string => Boolean(symbol))
            .sort()
            .join(",");
        const key = `${id}:${symbolsKey}`;
        if (autoAnalyzeKeyRef.current === key) {
            return;
        }
        autoAnalyzeKeyRef.current = key;
        analyzeMutation.mutate();
    }, [analyzing, canAnalyze, id, latestSnapshot, watchlist, analyzeMutation]);

    const resolveSelectedSymbol = useMemo(() => {
        if (!selectedSymbol || selectedSymbol === WATCHLIST_SERIES_KEY) return WATCHLIST_SERIES_KEY;
        const normalized = selectedSymbol.toUpperCase();
        if (assetSymbols.includes(normalized)) return normalized;
        return WATCHLIST_SERIES_KEY;
    }, [assetSymbols, selectedSymbol]);

    // Live chart data for individual ticker views
    const isIndividualTicker = resolveSelectedSymbol !== WATCHLIST_SERIES_KEY;
    const { data: liveChartData, loading: liveChartLoading, fetching: liveChartFetching } = useChartData(
        isIndividualTicker ? resolveSelectedSymbol : "",
        timeframe,
        candleInterval,
    );

    const selectedAsset = useMemo(() => {
        if (!watchlist || resolveSelectedSymbol === WATCHLIST_SERIES_KEY) return null;
        return watchlist.assets.find((asset) => asset.symbol?.toUpperCase() === resolveSelectedSymbol) ?? null;
    }, [resolveSelectedSymbol, watchlist]);

    const selectedLogoUrl = useMemo(() => {
        if (!selectedAsset) return null;
        return selectedAsset.logoUrl || getLogo(selectedAsset.symbol);
    }, [getLogo, selectedAsset]);

    const selectedTickerPriceData = useMemo<TickerPricePoint[]>(() => {
        if (!watchlist || resolveSelectedSymbol === WATCHLIST_SERIES_KEY) return [];
        const symbol = resolveSelectedSymbol;
        const symbolPrices = prices[symbol];
        if (!symbolPrices) return [];
        const dates = Object.keys(symbolPrices).sort();
        return dates.map((fullDate) => ({
            date: formatShortDate(fullDate),
            fullDate,
            open: symbolPrices[fullDate].open,
            high: symbolPrices[fullDate].high,
            low: symbolPrices[fullDate].low,
            close: symbolPrices[fullDate].close,
            volume: symbolPrices[fullDate].volume,
        }));
    }, [prices, resolveSelectedSymbol, watchlist]);

    const selectedTickerFiltered = useMemo(() => {
        return filterByTimeframe(selectedTickerPriceData, timeframe);
    }, [selectedTickerPriceData, timeframe]);

    const selectedTickerCumulative = useMemo<WatchlistSeriesPoint[]>(() => {
        const data = selectedTickerFiltered;
        if (data.length === 0) return [];
        const base = data[0].close;
        if (!Number.isFinite(base) || base === 0) return [];
        return data.map((point) => ({
            date: point.date,
            fullDate: point.fullDate,
            value: ((point.close - base) / base) * 100,
        }));
    }, [selectedTickerFiltered]);

    const watchlistIndexSeries = useMemo<WatchlistSeriesPoint[]>(() => {
        if (!watchlist || assetSymbols.length === 0) return [];

        const dateSet = new Set<string>();
        for (const symbol of assetSymbols) {
            const symbolPrices = prices[symbol];
            if (!symbolPrices) continue;
            for (const fullDate of Object.keys(symbolPrices)) {
                dateSet.add(fullDate);
            }
        }
        const allDates = Array.from(dateSet).sort();
        if (allDates.length === 0) return [];

        const datePoints = allDates.map((fullDate) => ({
            date: formatShortDate(fullDate),
            fullDate,
        }));

        const filteredDates = filterByTimeframe(datePoints, timeframe);
        if (filteredDates.length === 0) return [];

        const baseCloseBySymbol = new Map<string, number>();
        for (const asset of watchlist.assets) {
            const symbol = asset.symbol?.toUpperCase();
            if (!symbol) continue;
            const symbolPrices = prices[symbol];
            if (!symbolPrices) continue;
            const basePoint = filteredDates.find((item) => symbolPrices[item.fullDate]);
            if (!basePoint) continue;
            const baseClose = symbolPrices[basePoint.fullDate]?.close;
            if (!Number.isFinite(baseClose) || baseClose === 0) continue;
            baseCloseBySymbol.set(symbol, baseClose);
        }

        const result: WatchlistSeriesPoint[] = [];
        for (const item of filteredDates) {
            let weightedSum = 0;
            let weightSum = 0;

            for (const asset of watchlist.assets) {
                const symbol = asset.symbol?.toUpperCase();
                if (!symbol) continue;
                const baseClose = baseCloseBySymbol.get(symbol);
                const symbolPrices = prices[symbol];
                const point = symbolPrices?.[item.fullDate];
                if (!point || !baseClose) continue;
                const weight =
                    typeof asset.weight === "number" && Number.isFinite(asset.weight) && asset.weight > 0
                        ? asset.weight
                        : 1;
                weightedSum += (point.close / baseClose) * weight;
                weightSum += weight;
            }

            if (weightSum === 0) continue;
            result.push({
                date: item.date,
                fullDate: item.fullDate,
                value: (weightedSum / weightSum) * 100,
            });
        }

        return result;
    }, [assetSymbols, prices, timeframe, watchlist]);

    const watchlistCumulativeSeries = useMemo<WatchlistSeriesPoint[]>(() => {
        return watchlistIndexSeries.map((point) => ({
            ...point,
            value: point.value - 100,
        }));
    }, [watchlistIndexSeries]);

    const chartData = useMemo<Array<TickerPricePoint | WatchlistSeriesPoint>>(() => {
        const isWatchlist = resolveSelectedSymbol === WATCHLIST_SERIES_KEY;
        if (isWatchlist) {
            return chartMode === "price" ? watchlistIndexSeries : watchlistCumulativeSeries;
        }
        // For individual tickers: use live chart data in price mode, fallback to static for cumulative
        if (chartMode === "price" && liveChartData.length > 0) {
            return liveChartData as unknown as TickerPricePoint[];
        }
        return chartMode === "price" ? selectedTickerFiltered : selectedTickerCumulative;
    }, [
        chartMode,
        liveChartData,
        resolveSelectedSymbol,
        selectedTickerCumulative,
        selectedTickerFiltered,
        watchlistCumulativeSeries,
        watchlistIndexSeries,
    ]);

    const chartIsPositive = useMemo(() => {
        if (!chartData.length) return true;
        const first = chartData[0];
        const last = chartData[chartData.length - 1];
        const firstValue = isTickerPricePoint(first) ? first.close : first.value;
        const lastValue = isTickerPricePoint(last) ? last.close : last.value;
        if (!Number.isFinite(firstValue) || !Number.isFinite(lastValue)) return true;
        return lastValue - firstValue >= 0;
    }, [chartData]);

    const chartHeadline = useMemo(() => {
        const isWatchlist = resolveSelectedSymbol === WATCHLIST_SERIES_KEY;
        if (isWatchlist) return "Watchlist";
        return resolveSelectedSymbol;
    }, [resolveSelectedSymbol]);

    const headlineValue = useMemo(() => {
        if (!chartData.length) return null;
        const last = chartData[chartData.length - 1];
        if (chartMode === "price") {
            if (resolveSelectedSymbol === WATCHLIST_SERIES_KEY) {
                if (isTickerPricePoint(last)) return null;
                return Number.isFinite(last.value) ? last.value : null;
            }
            if (!isTickerPricePoint(last)) return null;
            return Number.isFinite(last.close) ? last.close : null;
        }
        if (isTickerPricePoint(last)) return null;
        return Number.isFinite(last.value) ? last.value : null;
    }, [chartData, chartMode, resolveSelectedSymbol]);

    type HeadlineChange = { change: number; pct: number | null };

    const headlineChange = useMemo(() => {
        if (chartData.length < 2) return null;
        const first = chartData[0];
        const last = chartData[chartData.length - 1];

        if (chartMode === "price") {
            if (resolveSelectedSymbol === WATCHLIST_SERIES_KEY) {
                if (isTickerPricePoint(first) || isTickerPricePoint(last)) return null;
                const firstValue = first.value;
                const lastValue = last.value;
                if (!Number.isFinite(firstValue) || !Number.isFinite(lastValue) || firstValue === 0) return null;
                const change = lastValue - firstValue;
                const pct = (change / firstValue) * 100;
                return { change, pct } satisfies HeadlineChange;
            }
            if (!isTickerPricePoint(first) || !isTickerPricePoint(last)) return null;
            const firstClose = first.close;
            const lastClose = last.close;
            if (!Number.isFinite(firstClose) || !Number.isFinite(lastClose) || firstClose === 0) return null;
            const change = lastClose - firstClose;
            const pct = (change / firstClose) * 100;
            return { change, pct } satisfies HeadlineChange;
        }

        if (isTickerPricePoint(first) || isTickerPricePoint(last)) return null;
        const firstValue = first.value;
        const lastValue = last.value;
        if (!Number.isFinite(firstValue) || !Number.isFinite(lastValue)) return null;
        return { change: lastValue - firstValue, pct: null } satisfies HeadlineChange;
    }, [chartData, chartMode, resolveSelectedSymbol]);

    const holdingsRows = useMemo(() => {
        if (!watchlist) return [];
        return watchlist.assets.map((asset) => {
            const symbol = asset.symbol?.toUpperCase() || "";
            const symbolPrices = symbol ? prices[symbol] : undefined;
            const dates = symbolPrices ? Object.keys(symbolPrices).sort() : [];
            const latestDate = dates.length ? dates[dates.length - 1] : null;
            const prevDate = dates.length > 1 ? dates[dates.length - 2] : null;
            const latest = latestDate ? symbolPrices?.[latestDate] : null;
            const prev = prevDate ? symbolPrices?.[prevDate] : null;

            let dayChangePct: number | null = null;
            if (latest && prev && Number.isFinite(prev.close) && prev.close !== 0) {
                dayChangePct = ((latest.close - prev.close) / prev.close) * 100;
            }

            const priceSeries: Array<{ fullDate: string; close: number }> = dates.map((fullDate) => ({
                fullDate,
                close: symbolPrices?.[fullDate]?.close ?? NaN,
            }));
            const filtered = filterByTimeframe(priceSeries, timeframe).filter((point) => Number.isFinite(point.close));
            let periodChangePct: number | null = null;
            if (filtered.length >= 2) {
                const base = filtered[0].close;
                const last = filtered[filtered.length - 1].close;
                if (Number.isFinite(base) && base !== 0 && Number.isFinite(last)) {
                    periodChangePct = ((last - base) / base) * 100;
                }
            }

            return {
                symbol,
                name: asset.name || symbol,
                logoUrl: asset.logoUrl || (symbol ? getLogo(symbol) : null),
                latestClose: latest?.close ?? null,
                latestVolume: latest?.volume ?? null,
                dayChangePct,
                periodChangePct,
            };
        });
    }, [getLogo, prices, timeframe, watchlist]);

    const localFallbackInsights = useMemo(() => {
        if (!isLocalFallback) return null;
        const withDayChange = holdingsRows.filter(
            (row) => typeof row.dayChangePct === "number" && Number.isFinite(row.dayChangePct)
        );
        const sorted = [...withDayChange].sort((a, b) => (b.dayChangePct ?? 0) - (a.dayChangePct ?? 0));
        const topGainer = sorted[0] ?? null;
        const topLaggard = sorted.length > 0 ? sorted[sorted.length - 1] : null;
        const avgDayMove = withDayChange.length
            ? withDayChange.reduce((sum, row) => sum + (row.dayChangePct ?? 0), 0) / withDayChange.length
            : null;

        return {
            trackedCount: withDayChange.length,
            topGainer,
            topLaggard,
            avgDayMove,
        };
    }, [holdingsRows, isLocalFallback]);

    if (loading) {
        return (
            <div className="min-h-screen bg-background-dark flex items-center justify-center">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
            </div>
        );
    }

    if (error || !watchlist) {
        return (
            <div className="min-h-screen bg-background-dark flex items-center justify-center">
                <div className="text-center">
                    <h1 className="text-2xl text-neon-red mb-4">Error</h1>
                    <p className="text-muted mb-6">{error || "Watchlist not found"}</p>
                    <div className="flex items-center justify-center gap-3">
                        {showUpgradeAction ? (
                            <Link
                                href="/settings/billing"
                                className="px-6 py-3 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
                            >
                                Upgrade Plan
                            </Link>
                        ) : null}
                        <button
                            onClick={() => router.push("/home")}
                            className="px-6 py-3 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
                        >
                            Go Home
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-background-dark">
            <Header />

            <main className="max-w-7xl mx-auto px-6 py-8">
                <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between mb-8">
                    <div className="min-w-0">
                        <button
                            onClick={() => router.push("/home")}
                            className="text-muted hover:text-foreground mb-2 flex items-center gap-2 text-sm"
                        >
                            <span className="material-symbols-outlined !text-[18px]">arrow_back</span>
                            Back
                        </button>
                        <h1 className="text-3xl font-bold text-foreground truncate">{watchlist.name}</h1>
                        <p className="text-xs text-muted mt-1">
                            {watchlist.createdAt
                                ? `Created ${new Date(watchlist.createdAt).toLocaleDateString("en-US", {
                                    year: "numeric",
                                    month: "short",
                                    day: "numeric",
                                })}`
                                : "Local watchlist"}
                            {latestSnapshot?.calculatedAt
                                ? ` • Last analyzed ${new Date(latestSnapshot.calculatedAt).toLocaleString("en-US", {
                                    month: "short",
                                    day: "numeric",
                                    hour: "numeric",
                                    minute: "2-digit",
                                })}`
                                : ""}
                        </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                        <button
                            onClick={runAnalysis}
                            disabled={analyzing || !canAnalyze}
                            className="h-11 px-4 rounded-lg bg-primary text-white text-xs font-bold uppercase tracking-wider hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center gap-2"
                        >
                            <span className={`material-symbols-outlined !text-[18px] ${analyzing ? "animate-spin" : ""}`}>
                                {analyzing ? "progress_activity" : "query_stats"}
                            </span>
                            {analyzing ? "Analyzing" : canAnalyze ? "Refresh Analysis" : "Analysis Unavailable"}
                        </button>
                    </div>
                </div>

                <div className="border-b border-border-color mb-6">
                    <div className="flex gap-8">
                        {(["Overview", "News"] as WatchlistTab[]).map((tab) => (
                            <button
                                key={tab}
                                onClick={() => setActiveTab(tab)}
                                className={`pb-3 px-1 text-sm font-medium transition-colors border-b-2 ${tab === activeTab
                                    ? "text-foreground border-primary"
                                    : "text-muted border-transparent hover:text-foreground"
                                    }`}
                            >
                                {tab}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-2 space-y-6">
                        {activeTab === "Overview" ? (
                            <>
                                <div className="bg-surface border border-border-color rounded-2xl p-4">
                                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-4">
                                        <div className="flex items-center gap-3">
                                            {resolveSelectedSymbol !== WATCHLIST_SERIES_KEY && selectedLogoUrl ? (
                                                <div className="w-12 h-12 rounded-full bg-transparent p-2 flex items-center justify-center shrink-0 border border-border-color overflow-hidden">
                                                    <img
                                                        src={selectedLogoUrl}
                                                        alt={`${resolveSelectedSymbol} logo`}
                                                        className="w-full h-full object-contain"
                                                    />
                                                </div>
                                            ) : (
                                                <div className="w-12 h-12 rounded-full bg-surface-highlight flex items-center justify-center shrink-0 border border-border-color">
                                                    <span className="material-symbols-outlined text-primary">list_alt</span>
                                                </div>
                                            )}
                                            <div>
                                                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                                                    {chartMode === "price" ? "Price History" : "Cumulative Change"}
                                                </p>
                                                <p className="text-sm text-foreground">
                                                    {chartHeadline}
                                                    {resolveSelectedSymbol === WATCHLIST_SERIES_KEY
                                                        ? " (equal-weighted)"
                                                        : selectedAsset?.name
                                                            ? ` • ${selectedAsset.name}`
                                                            : ""}
                                                </p>
                                            </div>
                                        </div>

                                        <div className="flex flex-wrap items-center gap-2">
                                            <div className="flex gap-1 border border-border-color rounded-lg p-1">
                                                <button
                                                    onClick={() => setChartMode("price")}
                                                    className={`flex-1 px-3 py-1 text-xs font-medium rounded-md transition-colors text-center ${chartMode === "price"
                                                        ? "bg-primary text-white"
                                                        : "text-muted hover:text-foreground"
                                                        }`}
                                                >
                                                    Price
                                                </button>
                                                <button
                                                    onClick={() => setChartMode("cumulative")}
                                                    className={`flex-1 px-3 py-1 text-xs font-medium rounded-md transition-colors text-center ${chartMode === "cumulative"
                                                        ? "bg-primary text-white"
                                                        : "text-muted hover:text-foreground"
                                                        }`}
                                                >
                                                    Cumulative
                                                </button>
                                            </div>

                                            <div className="flex gap-1 border border-border-color rounded-lg p-1">
                                                <button
                                                    onClick={() => setChartType("area")}
                                                    className={`flex-1 px-3 py-1 text-xs font-medium rounded-md transition-colors text-center ${chartType === "area"
                                                        ? "bg-primary text-white"
                                                        : "text-muted hover:text-foreground"
                                                        }`}
                                                    title="Line Chart"
                                                >
                                                    Line
                                                </button>
                                                <button
                                                    onClick={() => setChartType("candlestick")}
                                                    disabled={resolveSelectedSymbol === WATCHLIST_SERIES_KEY || chartMode !== "price"}
                                                    className={`flex-1 px-3 py-1 text-xs font-medium rounded-md transition-colors text-center ${chartType === "candlestick" && chartMode === "price" && resolveSelectedSymbol !== WATCHLIST_SERIES_KEY
                                                        ? "bg-primary text-white"
                                                        : "text-muted hover:text-foreground disabled:opacity-40 disabled:hover:text-muted"
                                                        }`}
                                                    title={resolveSelectedSymbol === WATCHLIST_SERIES_KEY ? "Candles available for individual tickers" : "Candlestick Chart"}
                                                >
                                                    Candles
                                                </button>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex flex-wrap gap-2 mb-4">
                                        <button
                                            type="button"
                                            onClick={() => setSelectedSymbol(WATCHLIST_SERIES_KEY)}
                                            className={`px-3 py-1.5 text-xs font-bold uppercase tracking-wider rounded-full border transition-colors ${resolveSelectedSymbol === WATCHLIST_SERIES_KEY
                                                ? "border-primary bg-primary/15 text-foreground"
                                                : "border-border-color text-muted hover:text-foreground hover:border-primary/60"
                                                }`}
                                        >
                                            Watchlist
                                        </button>
                                        {assetSymbols.map((symbol) => (
                                            <button
                                                key={symbol}
                                                type="button"
                                                onClick={() => setSelectedSymbol(symbol)}
                                                className={`px-3 py-1.5 text-xs font-bold uppercase tracking-wider rounded-full border transition-colors ${resolveSelectedSymbol === symbol
                                                    ? "border-primary bg-primary/15 text-foreground"
                                                    : "border-border-color text-muted hover:text-foreground hover:border-primary/60"
                                                    }`}
                                            >
                                                {symbol}
                                            </button>
                                        ))}
                                    </div>

                                    <div className="flex items-baseline gap-3 mb-2">
                                        {headlineValue !== null ? (
                                            <span className="text-4xl font-bold text-foreground">
                                                {chartMode === "price" ? (
                                                    resolveSelectedSymbol === WATCHLIST_SERIES_KEY ? (
                                                        headlineValue.toFixed(2)
                                                    ) : (
                                                        <>${headlineValue.toFixed(2)}</>
                                                    )
                                                ) : (
                                                    <>{headlineValue.toFixed(2)}%</>
                                                )}
                                            </span>
                                        ) : (
                                            <span className="text-2xl font-bold text-muted">
                                                {pricesLoading ? "Loading..." : "No price data"}
                                            </span>
                                        )}

                                        {headlineChange ? (
                                            <span className={`text-lg font-semibold ${chartIsPositive ? "text-neon-green" : "text-neon-red"}`}>
                                                {chartMode === "price" && resolveSelectedSymbol !== WATCHLIST_SERIES_KEY ? (
                                                    <>
                                                        {headlineChange.change >= 0 ? "+" : ""}${headlineChange.change.toFixed(2)} (
                                                        {headlineChange.pct !== null && headlineChange.pct !== undefined
                                                            ? `${headlineChange.pct >= 0 ? "+" : ""}${headlineChange.pct.toFixed(2)}%`
                                                            : ""}
                                                        )
                                                    </>
                                                ) : chartMode === "price" ? (
                                                    <>
                                                        {headlineChange.pct !== null && headlineChange.pct !== undefined
                                                            ? `${headlineChange.pct >= 0 ? "+" : ""}${headlineChange.pct.toFixed(2)}%`
                                                            : ""}
                                                    </>
                                                ) : (
                                                    <>
                                                        {headlineChange.change >= 0 ? "+" : ""}
                                                        {headlineChange.change.toFixed(2)}%
                                                    </>
                                                )}
                                            </span>
                                        ) : null}
                                    </div>

                                    <p className="text-xs text-muted mb-4">
                                        {resolveSelectedSymbol === WATCHLIST_SERIES_KEY
                                            ? "Derived from end-of-day close data across holdings."
                                            : "Click a holding to update the chart."}
                                    </p>

                                    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                                        <div className="flex gap-1 items-center">
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
                                            {isIndividualTicker && (
                                                <>
                                                    <div className="w-px h-5 bg-border-color mx-1" />
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
                                                </>
                                            )}
                                        </div>
                                        <div className="text-xs text-muted flex items-center gap-2">
                                            <span className="material-symbols-outlined !text-[16px]">timeline</span>
                                            {chartData.length ? `${chartData.length} points` : "No points"}
                                        </div>
                                    </div>

                                    {chartMode === "price" &&
                                        chartType === "candlestick" &&
                                        resolveSelectedSymbol !== WATCHLIST_SERIES_KEY ? (
                                        <CandlestickChart data={liveChartData.length > 0 ? liveChartData : selectedTickerFiltered} height={350} showVolume={true} />
                                    ) : (
                                        <ResponsiveContainer width="100%" height={350}>
                                            <AreaChart data={chartData}>
                                                <defs>
                                                    <linearGradient id="watchlistGradient" x1="0" y1="0" x2="0" y2="1">
                                                        <stop
                                                            offset="5%"
                                                            stopColor={chartIsPositive ? "#00ff41" : "#ff0055"}
                                                            stopOpacity={0.25}
                                                        />
                                                        <stop
                                                            offset="95%"
                                                            stopColor={chartIsPositive ? "#00ff41" : "#ff0055"}
                                                            stopOpacity={0}
                                                        />
                                                    </linearGradient>
                                                </defs>
                                                <XAxis
                                                    dataKey="date"
                                                    stroke="#666"
                                                    tick={{ fill: "#666", fontSize: 11 }}
                                                    tickLine={false}
                                                />
                                                <YAxis
                                                    stroke="#666"
                                                    tick={{ fill: "#666", fontSize: 11 }}
                                                    tickLine={false}
                                                    domain={chartMode === "cumulative"
                                                        ? ["dataMin - 2", "dataMax + 2"]
                                                        : resolveSelectedSymbol === WATCHLIST_SERIES_KEY
                                                            ? ["dataMin - 2", "dataMax + 2"]
                                                            : ["dataMin - 5", "dataMax + 5"]}
                                                    tickFormatter={(value) => {
                                                        if (chartMode === "cumulative") return `${Number(value).toFixed(0)}%`;
                                                        if (resolveSelectedSymbol === WATCHLIST_SERIES_KEY) return Number(value).toFixed(0);
                                                        return `$${Number(value).toFixed(0)}`;
                                                    }}
                                                />
                                                <Tooltip
                                                    contentStyle={{
                                                        backgroundColor: "#1a1a1a",
                                                        border: "1px solid #333",
                                                        borderRadius: "8px",
                                                        fontSize: "12px",
                                                    }}
                                                    labelStyle={{ color: "#999" }}
                                                    formatter={(value: unknown) => {
                                                        const numeric =
                                                            typeof value === "number"
                                                                ? value
                                                                : typeof value === "string"
                                                                    ? Number(value)
                                                                    : NaN;
                                                        if (!Number.isFinite(numeric)) return String(value ?? "");
                                                        if (chartMode === "cumulative") return `${numeric.toFixed(2)}%`;
                                                        if (resolveSelectedSymbol === WATCHLIST_SERIES_KEY) return numeric.toFixed(2);
                                                        return `$${numeric.toFixed(2)}`;
                                                    }}
                                                />
                                                <Area
                                                    type="monotone"
                                                    dataKey={chartMode === "price" && resolveSelectedSymbol !== WATCHLIST_SERIES_KEY ? "close" : "value"}
                                                    stroke={chartIsPositive ? "#00ff41" : "#ff0055"}
                                                    strokeWidth={2}
                                                    fill="url(#watchlistGradient)"
                                                />
                                            </AreaChart>
                                        </ResponsiveContainer>
                                    )}
                                </div>

                                <div className="bg-surface border border-border-color rounded-2xl overflow-hidden">
                                    <div className="p-4 border-b border-border-color flex items-center justify-between">
                                        <div>
                                            <h2 className="text-lg font-bold text-foreground">Holdings</h2>
                                            <p className="text-xs text-muted">Click a row to update the chart.</p>
                                        </div>
                                        <span className="text-xs text-muted">{watchlist.assets.length} stocks</span>
                                    </div>

                                    <div className="overflow-x-auto">
                                        <table className="w-full">
                                            <thead className="bg-surface-highlight/50">
                                                <tr>
                                                    <th className="text-left p-4 text-muted font-semibold text-xs uppercase tracking-wider">Symbol</th>
                                                    <th className="text-left p-4 text-muted font-semibold text-xs uppercase tracking-wider">Name</th>
                                                    <th className="text-right p-4 text-muted font-semibold text-xs uppercase tracking-wider">Price</th>
                                                    <th className="text-right p-4 text-muted font-semibold text-xs uppercase tracking-wider">1D</th>
                                                    <th className="text-right p-4 text-muted font-semibold text-xs uppercase tracking-wider">{timeframe}</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {holdingsRows.map((row, i) => {
                                                    const isSelected = resolveSelectedSymbol === row.symbol;
                                                    const isExpanded = expandedStock === row.symbol;
                                                    const dayPositive = row.dayChangePct !== null ? row.dayChangePct >= 0 : null;
                                                    const periodPositive = row.periodChangePct !== null ? row.periodChangePct >= 0 : null;

                                                    return (
                                                        <Fragment key={row.symbol}>
                                                            <tr
                                                                className={`cursor-pointer transition-colors ${isSelected ? "bg-primary/10" : i % 2 === 0 ? "bg-background-dark/10" : ""} hover:bg-surface-highlight/60`}
                                                                onClick={() => {
                                                                    setSelectedSymbol(row.symbol);
                                                                    setExpandedStock(isExpanded ? null : row.symbol);
                                                                }}
                                                            >
                                                                <td className="p-4">
                                                                    <div className="flex items-center gap-3">
                                                                        <span className={`material-symbols-outlined text-muted text-sm transition-transform ${isExpanded ? "rotate-90" : ""}`}>
                                                                            chevron_right
                                                                        </span>
                                                                        {row.logoUrl ? (
                                                                            <img
                                                                                src={row.logoUrl}
                                                                                alt={`${row.symbol} logo`}
                                                                                className="w-8 h-8 rounded-lg object-contain bg-transparent p-1 border border-border-color"
                                                                                onError={(e) => {
                                                                                    (e.target as HTMLImageElement).style.display = "none";
                                                                                }}
                                                                            />
                                                                        ) : (
                                                                            <div className="w-8 h-8 rounded-2xl bg-surface-highlight flex items-center justify-center text-xs font-bold text-muted border border-border-color">
                                                                                {row.symbol.slice(0, 2)}
                                                                            </div>
                                                                        )}
                                                                        <span className={`font-mono font-bold ${isSelected ? "text-foreground" : "text-primary"}`}>
                                                                            {row.symbol}
                                                                        </span>
                                                                        <Link
                                                                            href={`/stock/${row.symbol}`}
                                                                            onClick={(e) => e.stopPropagation()}
                                                                            className="text-muted hover:text-foreground transition-colors"
                                                                            title="Open ticker page"
                                                                        >
                                                                            <span className="material-symbols-outlined !text-[18px]">open_in_new</span>
                                                                        </Link>
                                                                    </div>
                                                                </td>
                                                                <td className="p-4 text-sm text-foreground">{row.name || "-"}</td>
                                                                <td className="p-4 text-right font-mono text-sm font-semibold text-foreground">
                                                                    {row.latestClose !== null && Number.isFinite(row.latestClose)
                                                                        ? `$${row.latestClose.toFixed(2)}`
                                                                        : pricesLoading ? "…" : "-"}
                                                                </td>
                                                                <td className={`p-4 text-right font-mono text-sm ${dayPositive === null ? "text-muted" : dayPositive ? "text-neon-green" : "text-neon-red"}`}>
                                                                    {row.dayChangePct === null || !Number.isFinite(row.dayChangePct)
                                                                        ? "-"
                                                                        : `${row.dayChangePct >= 0 ? "+" : ""}${row.dayChangePct.toFixed(2)}%`}
                                                                </td>
                                                                <td className={`p-4 text-right font-mono text-sm ${periodPositive === null ? "text-muted" : periodPositive ? "text-neon-green" : "text-neon-red"}`}>
                                                                    {row.periodChangePct === null || !Number.isFinite(row.periodChangePct)
                                                                        ? "-"
                                                                        : `${row.periodChangePct >= 0 ? "+" : ""}${row.periodChangePct.toFixed(2)}%`}
                                                                </td>
                                                            </tr>

                                                            {isExpanded ? (
                                                                <tr>
                                                                    <td colSpan={5} className="p-0 bg-background-dark/20">
                                                                        <div className="p-6 border-t border-border-color">
                                                                            <div className="flex items-center justify-between gap-3 mb-3">
                                                                                <div>
                                                                                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted">
                                                                                        Quick Look
                                                                                    </p>
                                                                                    <p className="text-sm text-foreground">
                                                                                        {row.symbol} details (opens full page for deeper analysis)
                                                                                    </p>
                                                                                </div>
                                                                                <Link
                                                                                    href={`/stock/${row.symbol}`}
                                                                                    className="px-3 py-2 rounded-2xl border border-border-color bg-surface hover:bg-surface-highlight text-xs font-bold uppercase tracking-wider text-foreground transition-colors flex items-center gap-2"
                                                                                >
                                                                                    <span className="material-symbols-outlined !text-[18px]">monitoring</span>
                                                                                    View
                                                                                </Link>
                                                                            </div>
                                                                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                                                                <div className="bg-surface-highlight/60 border border-border-color rounded-2xl p-3">
                                                                                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted mb-1">Price</p>
                                                                                    <p className="text-sm font-mono font-semibold text-foreground">
                                                                                        {row.latestClose !== null && Number.isFinite(row.latestClose)
                                                                                            ? `$${row.latestClose.toFixed(2)}`
                                                                                            : "-"}
                                                                                    </p>
                                                                                </div>
                                                                                <div className="bg-surface-highlight/60 border border-border-color rounded-2xl p-3">
                                                                                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted mb-1">1D</p>
                                                                                    <p className={`text-sm font-mono font-semibold ${dayPositive === null ? "text-muted" : dayPositive ? "text-neon-green" : "text-neon-red"}`}>
                                                                                        {row.dayChangePct === null || !Number.isFinite(row.dayChangePct)
                                                                                            ? "-"
                                                                                            : `${row.dayChangePct >= 0 ? "+" : ""}${row.dayChangePct.toFixed(2)}%`}
                                                                                    </p>
                                                                                </div>
                                                                                <div className="bg-surface-highlight/60 border border-border-color rounded-2xl p-3">
                                                                                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted mb-1">{timeframe}</p>
                                                                                    <p className={`text-sm font-mono font-semibold ${periodPositive === null ? "text-muted" : periodPositive ? "text-neon-green" : "text-neon-red"}`}>
                                                                                        {row.periodChangePct === null || !Number.isFinite(row.periodChangePct)
                                                                                            ? "-"
                                                                                            : `${row.periodChangePct >= 0 ? "+" : ""}${row.periodChangePct.toFixed(2)}%`}
                                                                                    </p>
                                                                                </div>
                                                                                <div className="bg-surface-highlight/60 border border-border-color rounded-2xl p-3">
                                                                                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted mb-1">Volume</p>
                                                                                    <p className="text-sm font-mono font-semibold text-foreground">
                                                                                        {row.latestVolume !== null && Number.isFinite(row.latestVolume)
                                                                                            ? `${(row.latestVolume / 1_000_000).toFixed(2)}M`
                                                                                            : "-"}
                                                                                    </p>
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                    </td>
                                                                </tr>
                                                            ) : null}
                                                        </Fragment>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>

                                {canAnalyze ? (
                                    isLocalFallback ? (
                                        <div className="bg-gradient-to-br from-primary/5 to-primary/10 border border-primary/30 rounded-xl p-6">
                                            <div className="flex items-center gap-2 mb-4">
                                                <span className="material-symbols-outlined text-primary">auto_awesome</span>
                                                <h2 className="text-lg font-bold text-foreground">Daily AI Insights</h2>
                                            </div>
                                            <p className="text-sm text-muted mb-4">
                                                Local/dev mode insights generated from current watchlist prices and latest risk run.
                                            </p>
                                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                                <div className="bg-surface-highlight/60 border border-border-color rounded-2xl p-3">
                                                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted mb-1">Avg 1D Move</p>
                                                    <p className="text-sm font-mono font-semibold text-foreground">
                                                        {formatSignedPercent(localFallbackInsights?.avgDayMove ?? null)}
                                                    </p>
                                                </div>
                                                <div className="bg-surface-highlight/60 border border-border-color rounded-2xl p-3">
                                                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted mb-1">Top Gainer</p>
                                                    <p className="text-sm font-mono font-semibold text-foreground">
                                                        {localFallbackInsights?.topGainer
                                                            ? `${localFallbackInsights.topGainer.symbol} ${formatSignedPercent(localFallbackInsights.topGainer.dayChangePct)}`
                                                            : "N/A"}
                                                    </p>
                                                </div>
                                                <div className="bg-surface-highlight/60 border border-border-color rounded-2xl p-3">
                                                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted mb-1">Top Laggard</p>
                                                    <p className="text-sm font-mono font-semibold text-foreground">
                                                        {localFallbackInsights?.topLaggard
                                                            ? `${localFallbackInsights.topLaggard.symbol} ${formatSignedPercent(localFallbackInsights.topLaggard.dayChangePct)}`
                                                            : "N/A"}
                                                    </p>
                                                </div>
                                                <div className="bg-surface-highlight/60 border border-border-color rounded-2xl p-3">
                                                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted mb-1">Regime</p>
                                                    <p className="text-sm font-mono font-semibold text-foreground uppercase">
                                                        {(latestSnapshot?.regime || watchlist.riskLevel || "unknown").replace("_", " ")}
                                                    </p>
                                                </div>
                                            </div>
                                            <p className="text-[11px] text-muted mt-4">
                                                Tracking {localFallbackInsights?.trackedCount ?? 0} symbols with valid daily return data.
                                            </p>
                                        </div>
                                    ) : (
                                        <DailyInsightsPanel watchlistId={id} tickers={assetSymbols} />
                                    )
                                ) : (
                                    <div className="bg-surface border border-border-color rounded-2xl p-6 text-center">
                                        <h2 className="text-lg font-bold text-foreground mb-2">Daily AI Insights</h2>
                                        <p className="text-sm text-muted">
                                            Daily insights are available once the API is connected.
                                        </p>
                                    </div>
                                )}

                                {!latestSnapshot ? (
                                    <div className="bg-surface border border-border-color rounded-2xl p-6 text-center">
                                        <p className="text-sm text-muted mb-4">
                                            No risk analysis available yet. Run an analysis to see portfolio metrics.
                                        </p>
                                        <button
                                            onClick={runAnalysis}
                                            disabled={analyzing || !canAnalyze}
                                            className="px-6 py-3 bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
                                        >
                                            {analyzing ? "Analyzing..." : canAnalyze ? "Run Analysis" : "Analysis Unavailable"}
                                        </button>
                                    </div>
                                ) : null}
                            </>
                        ) : (
                            <WatchlistNewsAggregator tickers={assetSymbols} />
                        )}
                    </div>

                    <div className="space-y-6">
                        <div className="bg-surface border border-border-color rounded-2xl p-6">
                            <h3 className="text-sm font-bold text-foreground mb-4 uppercase tracking-wider">
                                Watchlist Stats
                            </h3>
                            <div className="space-y-3">
                                <div className="flex justify-between items-center py-2 border-b border-border-color">
                                    <span className="text-sm text-muted">Holdings</span>
                                    <span className="text-sm font-semibold text-foreground">
                                        {watchlist.assets.length}
                                    </span>
                                </div>
                                <div className="flex justify-between items-center py-2 border-b border-border-color">
                                    <span className="text-sm text-muted">Risk Level</span>
                                    <span className="text-sm font-semibold text-foreground">
                                        {latestSnapshot?.regime || watchlist.riskLevel || "Unknown"}
                                    </span>
                                </div>
                                <div className="flex justify-between items-center py-2">
                                    <span className="text-sm text-muted">Selected</span>
                                    <span className="text-sm font-semibold text-foreground">
                                        {resolveSelectedSymbol === WATCHLIST_SERIES_KEY ? "Watchlist" : resolveSelectedSymbol}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {latestSnapshot ? (
                            <div className="bg-surface border border-border-color rounded-2xl p-6">
                                <div className="flex items-start justify-between gap-2 mb-4">
                                    <div>
                                        <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">Risk Snapshot</h3>
                                        <p className="text-xs text-muted mt-1">
                                            As of {new Date(latestSnapshot.calculatedAt).toLocaleString("en-US", {
                                                month: "short",
                                                day: "numeric",
                                                hour: "numeric",
                                                minute: "2-digit",
                                            })}
                                        </p>
                                    </div>
                                    <span className="text-xs text-muted uppercase tracking-wider">
                                        {latestSnapshot.regime.replace("_", " ")}
                                    </span>
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    <div className="bg-surface-highlight/60 border border-border-color rounded-2xl p-3">
                                        <p className="text-[10px] font-bold uppercase tracking-wider text-muted mb-1">Volatility</p>
                                        <p className="text-sm font-mono font-semibold text-foreground">
                                            {(latestSnapshot.volatility * 100).toFixed(2)}%
                                        </p>
                                    </div>
                                    <div className="bg-surface-highlight/60 border border-border-color rounded-2xl p-3">
                                        <p className="text-[10px] font-bold uppercase tracking-wider text-muted mb-1">Loss Prob (30d)</p>
                                        <p className="text-sm font-mono font-semibold text-foreground">
                                            {(latestSnapshot.lossProbability30d * 100).toFixed(2)}%
                                        </p>
                                    </div>
                                    <div className="bg-surface-highlight/60 border border-border-color rounded-2xl p-3">
                                        <p className="text-[10px] font-bold uppercase tracking-wider text-muted mb-1">VaR 95%</p>
                                        <p className="text-sm font-mono font-semibold text-foreground">
                                            {(latestSnapshot.var95 * 100).toFixed(2)}%
                                        </p>
                                    </div>
                                    <div className="bg-surface-highlight/60 border border-border-color rounded-2xl p-3">
                                        <p className="text-[10px] font-bold uppercase tracking-wider text-muted mb-1">CVaR 95%</p>
                                        <p className="text-sm font-mono font-semibold text-foreground">
                                            {(latestSnapshot.cvar95 * 100).toFixed(2)}%
                                        </p>
                                    </div>
                                </div>

                                {latestSnapshot.calculatedAt && canAnalyze ? (
                                    <p className="text-[11px] text-muted mt-4">
                                        Analyses on this watchlist are recorded in History.
                                    </p>
                                ) : null}
                            </div>
                        ) : (
                            <div className="bg-surface border border-border-color rounded-2xl p-6">
                                <h3 className="text-sm font-bold text-foreground mb-2 uppercase tracking-wider">Risk Snapshot</h3>
                                <p className="text-sm text-muted">
                                    No snapshot available yet.
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </main>
        </div>
    );
}
