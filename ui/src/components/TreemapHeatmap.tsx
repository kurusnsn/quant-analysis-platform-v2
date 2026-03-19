"use client";

import React, { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { treemap, hierarchy } from 'd3-hierarchy';
import { useStockPrices } from '@/hooks/useStockPrices';
import { useStockMetadata } from '@/hooks/useStockMetadata';

// ─── Colour scale ────────────────────────────────────────────────────────────

function getHeatColor(change: number | null | undefined): string {
    if (typeof change !== 'number' || !Number.isFinite(change)) return '#41413F';
    const val = change;
    if (val > 3) return '#65A745'; // biggest gainers  → light green
    if (val > 1.5) return '#52813B'; // mid gainers       → mid green
    if (val > 0) return '#426233'; // small gainers     → dark green
    if (val < -3) return '#D86075'; // biggest losers    → light red
    if (val < -1.5) return '#A54E5C'; // mid losers        → mid red
    if (val < 0) return '#7A3F49'; // small losers      → dark red
    return '#41413F';                // flat              → grey
}

const SECTOR_HEADER_BG = '#1c1917';     // dark warm obsidian — neutral, fits site palette
const SECTOR_STRIPE_BG = '#2a2520';    // slightly lighter for tiny-sector stripe

// ─── Types ───────────────────────────────────────────────────────────────────

interface StockNode {
    type: 'stock';
    ticker: string;
    name: string;
    value: number;
    change: number | null;
}

interface SectorNode {
    type: 'sector';
    name: string;
    change: number;
    children: StockNode[];
}

interface RootNode {
    type: 'root';
    children: SectorNode[];
}

// ─── Tooltip ─────────────────────────────────────────────────────────────────

interface TooltipState {
    visible: boolean;
    x: number;
    y: number;
    ticker: string;
    name: string;
    change: number | null;
    value: number;
}

// ─── Treemap renderer ────────────────────────────────────────────────────────

const SECTOR_LABEL_HEIGHT = 22;  // height of sector label bar
const SECTOR_PADDING_OUTER = 3;  // gap between sectors
const TILE_GAP = 1;              // gap between stock tiles

interface TreemapSVGProps {
    data: RootNode;
    width: number;
    height: number;
    onStockClick?: (ticker: string) => void;
    isExpanded?: boolean;
}

function TreemapSVG({ data, width, height, onStockClick, isExpanded = true }: TreemapSVGProps) {
    const [tooltip, setTooltip] = useState<TooltipState>({ visible: false, x: 0, y: 0, ticker: '', name: '', change: null, value: 0 });

    const root = useMemo(() => {
        const h = hierarchy<RootNode | SectorNode | StockNode>(data as any)
            .sum((d: any) => (d.type === 'stock' ? d.value : 0))
            .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

        treemap<RootNode | SectorNode | StockNode>()
            .size([width, height])
            .paddingInner(TILE_GAP)
            .paddingOuter(isExpanded ? SECTOR_PADDING_OUTER : 0)
            .paddingTop((node: any) => {
                // Only reserve header space when the sector is tall enough to show a label
                if (node.depth === 1) {
                    const sh = (node.y1 ?? 0) - (node.y0 ?? 0);
                    return (isExpanded && sh >= SECTOR_LABEL_HEIGHT) ? SECTOR_LABEL_HEIGHT : (isExpanded ? SECTOR_PADDING_OUTER : 0);
                }
                return isExpanded ? SECTOR_PADDING_OUTER : 0;
            })
            .round(true)(h);

        return h;
    }, [data, width, height, isExpanded]);

    const sectorNodes = root.children ?? [];

    return (
        <svg width={width} height={height} style={{ display: 'block', overflow: 'hidden' }}>

            {/* ── Pass 1: sector backgrounds + all stock tiles ──────────────────── */}
            {sectorNodes.map((sector: any) => {
                const sx = sector.x0;
                const sy = sector.y0;
                const sw = sector.x1 - sector.x0;
                const sh = sector.y1 - sector.y0;
                const sectorData = sector.data as SectorNode;

                return (
                    <g key={`tiles-${sectorData.name}`}>
                        {/* Sector background */}
                        <rect x={sx} y={sy} width={sw} height={sh} fill="#111" rx={2} />

                        {/* Stock tiles */}
                        {(sector.children ?? []).map((leaf: any) => {
                            const stockData = leaf.data as StockNode;
                            const lx = leaf.x0;
                            const ly = leaf.y0;
                            const lw = leaf.x1 - leaf.x0;
                            const lh = leaf.y1 - leaf.y0;
                            if (lw < 4 || lh < 4) return null;

                            const color = getHeatColor(stockData.change);
                            const area = lw * lh;
                            const showTicker = area > 300 && lw > 20 && lh > 14;
                            const showChange = area > 900 && lh > 26;
                            const fontSize = Math.min(Math.max(Math.sqrt(area) / 7, 7), 11);

                            return (
                                <g
                                    key={stockData.ticker}
                                    style={{ cursor: onStockClick ? 'pointer' : 'default' }}
                                    onClick={() => onStockClick?.(stockData.ticker)}
                                    onMouseEnter={() => {
                                        setTooltip({
                                            visible: true,
                                            x: lx + lw / 2,
                                            y: ly,
                                            ticker: stockData.ticker,
                                            name: stockData.name,
                                            change: stockData.change,
                                            value: stockData.value,
                                        });
                                    }}
                                    onMouseLeave={() => setTooltip(t => ({ ...t, visible: false }))}
                                >
                                    <rect x={lx} y={ly} width={lw} height={lh} fill={color} rx={1} />
                                    {showTicker && (
                                        <text
                                            x={lx + lw / 2}
                                            y={ly + lh / 2 + (showChange ? -fontSize * 0.6 : fontSize * 0.35)}
                                            textAnchor="middle"
                                            fill="#fff"
                                            fontSize={fontSize}
                                            fontWeight={700}
                                            fontFamily="system-ui, -apple-system, sans-serif"
                                            style={{ userSelect: 'none', pointerEvents: 'none' }}
                                        >
                                            {stockData.ticker}
                                        </text>
                                    )}
                                    {showChange && typeof stockData.change === 'number' && (
                                        <text
                                            x={lx + lw / 2}
                                            y={ly + lh / 2 + fontSize * 1.1}
                                            textAnchor="middle"
                                            fill="rgba(255,255,255,0.85)"
                                            fontSize={Math.max(fontSize - 1, 6.5)}
                                            fontWeight={400}
                                            fontFamily="system-ui, -apple-system, sans-serif"
                                            style={{ userSelect: 'none', pointerEvents: 'none' }}
                                        >
                                            {stockData.change > 0 ? '+' : ''}{stockData.change.toFixed(2)}%
                                        </text>
                                    )}
                                </g>
                            );
                        })}
                    </g>
                );
            })}

            {/* ── Pass 2: sector headers — rendered last so they sit on top of tiles ── */}
            {sectorNodes.map((sector: any) => {
                const sx = sector.x0;
                const sy = sector.y0;
                const sw = sector.x1 - sector.x0;
                const sh = sector.y1 - sector.y0;
                const sectorData = sector.data as SectorNode;
                const sectorChange = sectorData.change;
                const showLabel = isExpanded && sw >= 50 && sh >= SECTOR_LABEL_HEIGHT;
                const showStripe = !showLabel && sh >= 4 && sw >= 4;
                const changeColor = sectorChange >= 0 ? '#48964B' : '#FF6D87';

                return (
                    <g key={`header-${sectorData.name}`} style={{ pointerEvents: 'none' }}>
                        {/* Full header bar for large-enough sectors */}
                        {showLabel && (
                            <>
                                <rect
                                    x={sx}
                                    y={sy}
                                    width={sw}
                                    height={SECTOR_LABEL_HEIGHT}
                                    fill={SECTOR_HEADER_BG}
                                    rx={2}
                                />
                                {/* Square off bottom corners so it joins the tiles cleanly */}
                                <rect
                                    x={sx}
                                    y={sy + SECTOR_LABEL_HEIGHT - 3}
                                    width={sw}
                                    height={3}
                                    fill={SECTOR_HEADER_BG}
                                />
                                <text
                                    x={sx + 6}
                                    y={sy + 15}
                                    fill="rgba(255,255,255,0.88)"
                                    fontSize={10}
                                    fontWeight={600}
                                    fontFamily="system-ui, -apple-system, sans-serif"
                                    letterSpacing="0.02em"
                                    style={{ userSelect: 'none' }}
                                >
                                    {sectorData.name}
                                </text>
                                <text
                                    x={sx + sw - 6}
                                    y={sy + 15}
                                    textAnchor="end"
                                    fill={changeColor}
                                    fontSize={9}
                                    fontWeight={500}
                                    fontFamily="system-ui, -apple-system, sans-serif"
                                    style={{ userSelect: 'none' }}
                                >
                                    {sectorChange >= 0 ? '+' : ''}{sectorChange.toFixed(2)}%
                                </text>
                            </>
                        )}

                        {/* Neutral left stripe for sectors too small for a full header */}
                        {showStripe && (
                            <rect
                                x={sx}
                                y={sy}
                                width={Math.min(3, sw)}
                                height={sh}
                                fill={SECTOR_STRIPE_BG}
                                rx={1}
                            />
                        )}
                    </g>
                );
            })}

            {/* Tooltip */}
            {tooltip.visible && (() => {
                const tx = Math.min(tooltip.x, width - 160);
                const ty = Math.max(tooltip.y - 72, 4);
                const changeVal = tooltip.change;
                return (
                    <g style={{ pointerEvents: 'none' }}>
                        <rect x={tx} y={ty} width={155} height={62} rx={5} fill="#1a1a1a" stroke="rgba(255,255,255,0.12)" strokeWidth={1} />
                        <text x={tx + 10} y={ty + 19} fill="#fff" fontSize={13} fontWeight={700} fontFamily="system-ui, -apple-system, sans-serif">{tooltip.ticker}</text>
                        {changeVal !== null && (
                            <text x={tx + 145} y={ty + 19} fill={changeVal >= 0 ? '#65A745' : '#D86075'} fontSize={12} fontWeight={600} fontFamily="system-ui, -apple-system, sans-serif" textAnchor="end">
                                {changeVal > 0 ? '+' : ''}{changeVal.toFixed(2)}%
                            </text>
                        )}
                        <text x={tx + 10} y={ty + 34} fill="rgba(255,255,255,0.5)" fontSize={9} fontFamily="system-ui, -apple-system, sans-serif">{tooltip.name.slice(0, 24)}</text>
                        <line x1={tx + 10} y1={ty + 42} x2={tx + 145} y2={ty + 42} stroke="rgba(255,255,255,0.08)" strokeWidth={1} />
                        <text x={tx + 10} y={ty + 55} fill="rgba(255,255,255,0.4)" fontSize={9} fontFamily="system-ui, -apple-system, sans-serif">Market Cap</text>
                        <text x={tx + 145} y={ty + 55} fill="rgba(255,255,255,0.65)" fontSize={9} fontFamily="system-ui, -apple-system, sans-serif" textAnchor="end">
                            {tooltip.value >= 1e12 ? `$${(tooltip.value / 1e12).toFixed(2)}T` : `$${(tooltip.value / 1e9).toFixed(0)}B`}
                        </text>
                    </g>
                );
            })()}
        </svg>
    );
}

// ─── Responsive wrapper ───────────────────────────────────────────────────────

function ResponsiveTreemap({ data, onStockClick, isExpanded = false }: { data: RootNode; onStockClick?: (ticker: string) => void; isExpanded?: boolean }) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [size, setSize] = useState<{ width: number; height: number } | null>(null);

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const ro = new ResizeObserver((entries) => {
            const { width, height } = entries[0].contentRect;
            if (width > 0 && height > 0) setSize({ width: Math.floor(width), height: Math.floor(height) });
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    return (
        <div ref={containerRef} style={{ width: '100%', height: '100%' }}>
            {size && size.width > 0 && size.height > 0 && (
                <TreemapSVG data={data} width={size.width} height={size.height} onStockClick={onStockClick} isExpanded={isExpanded} />
            )}
        </div>
    );
}

// ─── Modal ───────────────────────────────────────────────────────────────────

function TreemapModal({ isOpen, onClose, data }: {
    isOpen: boolean;
    onClose: () => void;
    data: RootNode;
}) {
    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90"
            onClick={onClose}
        >
            <div
                className="bg-[#0a0a0a] border border-white/10 rounded-lg w-full max-w-[96vw] h-[92vh] overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="px-4 py-3 border-b border-white/10 flex justify-between items-center">
                    <div>
                        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                            <span className="material-symbols-outlined text-neon-green">grid_view</span>
                            S&P 500 Market Performance
                        </h2>
                        <p className="text-[10px] text-white/40 mt-0.5">Market Cap Weighted · 1D % Change</p>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-1.5 text-[10px]">
                            <span className="text-neon-red">-5%</span>
                            <div className="flex">
                                {['#7A3F49', '#A54E5C', '#D86075', '#41413F', '#65A745', '#52813B', '#426233'].map((c, i) => (
                                    <div key={i} className="w-3 h-2.5" style={{ backgroundColor: c }} />
                                ))}
                            </div>
                            <span className="text-neon-green">+5%</span>
                        </div>
                        <button
                            onClick={onClose}
                            className="w-7 h-7 rounded bg-white/5 hover:bg-white/10 flex items-center justify-center"
                        >
                            <span className="material-symbols-outlined text-white/50 text-lg">close</span>
                        </button>
                    </div>
                </div>

                <div className="w-full h-[calc(100%-52px)] p-2">
                    <ResponsiveTreemap data={data} isExpanded={true} />
                </div>
            </div>
        </div>
    );
}

// ─── Main widget ─────────────────────────────────────────────────────────────

export default function TreemapHeatmapWidget() {
    const [mounted, setMounted] = useState(false);
    const { prices, loading: pricesLoading } = useStockPrices();
    const { stocks: metadata, loading: metadataLoading } = useStockMetadata();
    const [isModalOpen, setIsModalOpen] = useState(false);

    useEffect(() => { setMounted(true); }, []);

    const data = useMemo((): RootNode => {
        if (!Object.keys(prices).length || !Object.keys(metadata).length) {
            return { type: 'root', children: [] };
        }

        const sectors: Record<string, { stocks: StockNode[]; totalChange: number; totalWeight: number }> = {};

        for (const ticker of Object.keys(prices)) {
            const meta = metadata[ticker];
            if (!meta?.sector) continue;

            const dates = Object.keys(prices[ticker]).sort();
            let change: number | null = null;
            if (dates.length >= 2) {
                const latest = prices[ticker][dates[dates.length - 1]]?.close;
                const prev = prices[ticker][dates[dates.length - 2]]?.close;
                if (typeof latest === 'number' && typeof prev === 'number' && prev > 0) {
                    change = ((latest - prev) / prev) * 100;
                }
            }

            const marketCap = meta.market_cap || 1e9;
            const sector = meta.sector;

            if (!sectors[sector]) sectors[sector] = { stocks: [], totalChange: 0, totalWeight: 0 };

            sectors[sector].stocks.push({
                type: 'stock',
                ticker,
                name: meta.short_name || ticker,
                value: marketCap,
                change,
            });

            if (typeof change === 'number') {
                sectors[sector].totalChange += change * marketCap;
                sectors[sector].totalWeight += marketCap;
            }
        }

        const children: SectorNode[] = Object.entries(sectors).map(([name, { stocks, totalChange, totalWeight }]) => ({
            type: 'sector',
            name,
            change: totalWeight > 0 ? totalChange / totalWeight : 0,
            children: stocks,
        }));

        return { type: 'root', children };
    }, [prices, metadata]);

    const loading = !mounted || pricesLoading || metadataLoading;
    const hasData = data.children.length > 0;

    return (
        <>
            <div
                className="bg-surface border border-border-color rounded-2xl overflow-hidden cursor-pointer hover:border-primary/40 group font-sans"
                onClick={() => setIsModalOpen(true)}
            >
                <div className="px-4 py-3 flex items-center justify-between border-b border-border-color">
                    <h3 className="font-semibold text-foreground text-[11px]">Market Heatmap</h3>
                    <span
                        className="material-symbols-outlined !text-[16px] text-muted group-hover:text-foreground"
                        title="Click to expand"
                    >
                        open_in_full
                    </span>
                </div>

                <div className="h-40">
                    {loading ? (
                        <div className="w-full h-full bg-surface-highlight/40" />
                    ) : !hasData ? (
                        <div className="w-full h-full flex items-center justify-center text-xs text-muted">
                            No data
                        </div>
                    ) : (
                        <ResponsiveTreemap data={data} />
                    )}
                </div>
            </div>

            <TreemapModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                data={data}
            />
        </>
    );
}
