"use client";

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { Trash2, MoreHorizontal } from './Icons';
import { Watchlist } from '../types';
import { useCompanyLogos } from '../hooks/useCompanyLogos';
import { useStockPrices } from '../hooks/useStockPrices';

interface Props {
    watchlist: Watchlist;
    onSelect: (id: string) => void;
    onDelete?: () => void;
}

export const WatchlistCard: React.FC<Props> = ({ watchlist, onSelect, onDelete }) => {
    // Always request logo candidates so stale saved logoUrl values can be replaced.
    const symbolsNeedingLogos = useMemo(
        () => watchlist.tickers.map(t => t.symbol.toUpperCase()),
        [watchlist.tickers]
    );
    const { getLogo } = useCompanyLogos(symbolsNeedingLogos);
    const { getLatestPrice } = useStockPrices();
    const [failedLogoUrls, setFailedLogoUrls] = useState<Record<string, Record<string, boolean>>>({});

    const markLogoUrlAsFailed = (symbol: string, url: string) => {
        const normalizedSymbol = symbol.toUpperCase();
        setFailedLogoUrls((prev) => ({
            ...prev,
            [normalizedSymbol]: {
                ...(prev[normalizedSymbol] ?? {}),
                [url]: true,
            },
        }));
    };

    const handleDelete = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (onDelete) onDelete();
    };

    return (
        <div
            className="bg-sentinel-card border border-sentinel-border p-5 space-y-4 rounded-2xl hover:border-sentinel-accent transition-all cursor-pointer group relative"
            onClick={() => onSelect(watchlist.id)}
        >
            <div className="flex justify-between items-start">
                <h4 className="text-xs font-bold text-sentinel-primary flex items-center gap-2 uppercase tracking-wide font-mono">
                    {watchlist.name}
                </h4>
                <div className="flex flex-col items-end gap-1">
                    <div className="flex items-center gap-2">
                        <span className="text-[11px] font-black font-mono">
                            <span className={watchlist.dailyChange.startsWith('-') ? 'text-neon-red' : 'text-neon-green'}>
                                {watchlist.dailyChange}
                            </span>
                        </span>
                        <button
                            onClick={handleDelete}
                            className="text-sentinel-muted hover:text-neon-red opacity-0 group-hover:opacity-100 transition-all p-1"
                            title="Delete Watchlist"
                        >
                            <Trash2 className="w-3.5 h-3.5" />
                        </button>
                    </div>
                    <span className="text-[8px] text-sentinel-muted font-mono uppercase tracking-[0.1em]">CORR: {watchlist.correlation}</span>
                </div>
            </div>

            <div className="flex flex-wrap gap-1">
                {watchlist.tickers.map((t) => {
                    const symbol = t.symbol.toUpperCase();
                    const primaryLogo = getLogo(symbol);
                    const secondaryLogo = typeof t.logoUrl === "string" ? t.logoUrl : null;
                    const candidates = Array.from(
                        new Set([primaryLogo, secondaryLogo].filter((value): value is string => Boolean(value)))
                    );
                    const failedBySymbol = failedLogoUrls[symbol] ?? {};
                    const logoUrl = candidates.find((candidate) => !failedBySymbol[candidate]) ?? null;
                    const price = getLatestPrice(symbol);
                    return (
                        <Link
                            key={symbol}
                            href={`/stock/${symbol}`}
                            onClick={(e) => e.stopPropagation()}
                            className="text-[9px] text-sentinel-primary px-2 py-1.5 border border-sentinel-border bg-sentinel-bg rounded-lg font-bold hover:border-primary/50 transition-colors font-mono flex items-center gap-1.5"
                        >
                            {logoUrl ? (
                                <img
                                    src={logoUrl}
                                    alt={`${symbol} logo`}
                                    className="w-3.5 h-3.5 rounded-sm object-cover bg-white shrink-0"
                                    onError={() => {
                                        markLogoUrlAsFailed(symbol, logoUrl);
                                    }}
                                />
                            ) : (
                                <span className="w-3.5 h-3.5 rounded-sm bg-sentinel-border/70 text-[7px] leading-[14px] text-center text-sentinel-muted shrink-0">
                                    {symbol.slice(0, 1)}
                                </span>
                            )}
                            <div className="flex flex-col gap-0.5">
                                <span className="leading-none">{symbol}</span>
                                {price && (
                                    <span className="text-[8px] text-sentinel-muted leading-none">
                                        ${price.close.toFixed(2)}
                                    </span>
                                )}
                            </div>
                        </Link>
                    );
                })}
            </div>

            <div className="pt-3 border-t border-sentinel-border flex justify-end items-center text-[9px] font-bold uppercase tracking-tighter">
                <Link
                    href={`/watchlist/${watchlist.id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="text-sentinel-accent hover:underline flex items-center gap-1"
                >
                    Details <MoreHorizontal className="w-2.5 h-2.5" />
                </Link>
            </div>
        </div>
    );
};
