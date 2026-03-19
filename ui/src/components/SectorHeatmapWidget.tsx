"use client";

import { useMemo, useState } from "react";
import { PriceData, useStockPrices } from "@/hooks/useStockPrices";

type WindowKey = "1D" | "1W" | "1M" | "3M";

const WINDOWS: Array<{ key: WindowKey; offsetTradingDays: number }> = [
    { key: "1D", offsetTradingDays: 1 },
    { key: "1W", offsetTradingDays: 5 },
    { key: "1M", offsetTradingDays: 21 },
    { key: "3M", offsetTradingDays: 63 },
];

const SECTORS = [
    { ticker: "XLK", sector: "Technology", icon: "memory" },
    { ticker: "XLF", sector: "Financials", icon: "account_balance" },
    { ticker: "XLV", sector: "Healthcare", icon: "medical_services" },
    { ticker: "XLE", sector: "Energy", icon: "bolt" },
    { ticker: "XLI", sector: "Industrials", icon: "factory" },
    { ticker: "XLY", sector: "Consumer Disc.", icon: "shopping_bag" },
    { ticker: "XLP", sector: "Consumer Staples", icon: "local_grocery_store" },
    { ticker: "XLB", sector: "Materials", icon: "category" },
    { ticker: "XLU", sector: "Utilities", icon: "power" },
    { ticker: "XLRE", sector: "Real Estate", icon: "apartment" },
    { ticker: "XLC", sector: "Communication", icon: "cell_tower" },
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

function heatStyle(value: number | null): { bg: string; border: string; textClass: string } {
    if (value === null || !Number.isFinite(value)) {
        return {
            bg: "rgba(255,255,255,0.02)",
            border: "rgba(255,255,255,0.06)",
            textClass: "text-white",
        };
    }

    const cap = 8; // ±8% max intensity
    const clamped = Math.max(-cap, Math.min(cap, value));
    const intensity = Math.min(1, Math.abs(clamped) / cap);
    const isUp = clamped >= 0;

    const rgb = isUp ? "0,255,65" : "255,0,85";
    const bgAlpha = 0.08 + 0.4 * intensity;
    const borderAlpha = 0.12 + 0.5 * intensity;

    return {
        bg: `rgba(${rgb},${bgAlpha})`,
        border: `rgba(${rgb},${borderAlpha})`,
        textClass: "text-white",
    };
}

export default function SectorHeatmapWidget() {
    const { prices, loading: pricesLoading } = useStockPrices();
    const [selectedWindow, setSelectedWindow] = useState<WindowKey>("1D");

    const sectorData = useMemo(() => {
        // Gather all dates
        const dateSet = new Set<string>();
        for (const s of SECTORS) {
            const series = prices[s.ticker];
            if (!series) continue;
            for (const d of Object.keys(series)) dateSet.add(d);
        }

        const dates = Array.from(dateSet).sort();
        if (dates.length === 0) {
            return { toDate: null as string | null, sectors: [] as Array<{ ticker: string; sector: string; icon: string; change: number | null }> };
        }

        const toIndex = dates.length - 1;
        const toDate = dates[toIndex] ?? null;
        const windowConfig = WINDOWS.find((w) => w.key === selectedWindow) ?? WINDOWS[0];

        const sectors = SECTORS.map((s) => {
            const series = prices[s.ticker] ?? null;
            const to = getCloseOnOrBefore({ series, dates, startIndex: toIndex, maxLookback: 7 });
            const fromIndex = toIndex - windowConfig.offsetTradingDays;

            let change: number | null = null;
            if (to && fromIndex >= 0) {
                const from = getCloseOnOrBefore({ series, dates, startIndex: fromIndex, maxLookback: 7 });
                if (from) {
                    change = ((to.close - from.close) / from.close) * 100;
                }
            }

            return { ticker: s.ticker, sector: s.sector, icon: s.icon, change };
        });

        return { toDate, sectors };
    }, [prices, selectedWindow]);

    const loading = pricesLoading && sectorData.sectors.length === 0;

    return (
        <div className="bg-surface border border-border-color rounded-2xl p-4">
            <div className="flex items-center justify-between mb-2">
                <div className="flex flex-col">
                    <h3 className="font-bold text-white text-[11px] uppercase tracking-[0.15em]">Sector Heatmap</h3>
                    <p className="text-[10px] text-white/80">
                        SPDR ETFs •{" "}
                        {sectorData.toDate ? <span>As of {formatDateLabel(sectorData.toDate)}</span> : "Data unavailable"}
                    </p>
                </div>
                <span className="material-symbols-outlined text-white/70">grid_view</span>
            </div>

            {/* Window Selector */}
            <div className="flex gap-1 mb-3">
                {WINDOWS.map((w) => (
                    <button
                        key={w.key}
                        onClick={() => setSelectedWindow(w.key)}
                        className={`px-3 py-1.5 text-[11px] font-semibold rounded-2xl transition-colors ${selectedWindow === w.key
                                ? "bg-primary text-white"
                                : "text-muted hover:text-foreground hover:bg-surface-highlight"
                            }`}
                        aria-pressed={selectedWindow === w.key}
                    >
                        {w.key}
                    </button>
                ))}
            </div>

            {loading ? (
                <div className="grid grid-cols-3 gap-2">
                    {[...Array(11)].map((_, i) => (
                        <div key={i} className="h-16 bg-surface-highlight rounded-2xl animate-pulse" />
                    ))}
                </div>
            ) : sectorData.sectors.length === 0 ? (
                <div className="text-sm text-muted bg-surface-highlight border border-border-color rounded-2xl p-3">
                    No sector data available. Run the price fetch script.
                </div>
            ) : (
                <div className="grid grid-cols-3 gap-2">
                    {sectorData.sectors.map((s) => {
                        const style = heatStyle(s.change);
                        return (
                            <div
                                key={s.ticker}
                                className="rounded-lg border p-2 flex flex-col items-center justify-center text-center min-h-[60px] transition-colors"
                                style={{ backgroundColor: style.bg, borderColor: style.border }}
                                title={`${s.sector} (${s.ticker}): ${formatPct(s.change)}`}
                            >
                                <span className="material-symbols-outlined text-lg text-white/80 mb-0.5">{s.icon}</span>
                                <span className="text-[9px] font-semibold text-white uppercase tracking-wider">{s.sector}</span>
                                <span className={`text-[11px] font-mono font-bold ${style.textClass}`}>{formatPct(s.change)}</span>
                            </div>
                        );
                    })}
                </div>
            )}

            <div className="mt-3 text-[10px] text-white/80 text-right">
                <span className="font-mono">1W≈5d • 1M≈21d • 3M≈63d</span>
            </div>
        </div>
    );
}
