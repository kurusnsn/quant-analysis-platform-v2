'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useClientNow } from '@/hooks/useClientNow';
import { authFetch } from '@/lib/authFetch';

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

interface Forecast {
    label: string;
    target: string;
    confidence: number;
    horizon: string;
    current?: number;
    rsi?: number;
    deviation_pct?: number;
    avg_5d?: number;
    error?: boolean;
}

interface ForecastsResponse {
    forecasts: Forecast[];
    timestamp: string;
    source: string;
}

export const ForecastWidget: React.FC = () => {
    const { data, isLoading, error, dataUpdatedAt } = useQuery<ForecastsResponse>({
        queryKey: ['forecasts'],
        queryFn: async () => {
            const response = await authFetch(`${API_URL}/forecasts`);
            if (!response.ok) throw new Error('Failed to fetch forecasts');
            return response.json();
        },
        staleTime: 1000 * 60 * 5, // 5 minutes
        refetchInterval: 1000 * 60 * 5, // Refetch every 5 minutes
    });

    const forecasts = data?.forecasts || [];
    const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt) : null;
    const now = useClientNow(60_000);

    const getTimeSinceUpdate = () => {
        if (!lastUpdated || now === null) return 'Loading...';
        const diff = Math.floor((now - lastUpdated.getTime()) / 1000 / 60);
        if (diff < 1) return 'Just now';
        if (diff === 1) return '1 min ago';
        return `${diff} mins ago`;
    };

    return (
        <div className="bg-surface border border-sentinel-border rounded-2xl shadow-2xl overflow-hidden flex flex-col">
            <div className="px-5 py-4 flex items-center justify-between border-b border-sentinel-border">
                <div className="flex flex-col text-left">
                    <span className="text-[10px] font-bold tracking-[0.1em] text-primary uppercase font-mono">QUANT PLATFORM</span>
                    <div className="flex items-center gap-1.5">
                        <h2 className="text-foreground text-base font-semibold leading-tight tracking-tight">Guardian Forecasts</h2>
                        <span className="material-symbols-outlined text-muted cursor-help !text-[16px]">info</span>
                    </div>
                </div>
                <div className="flex h-8 w-8 items-center justify-center rounded-2xl bg-sentinel-bg text-muted hover:text-foreground transition-colors cursor-pointer border border-sentinel-border">
                    <span className="material-symbols-outlined">more_horiz</span>
                </div>
            </div>

            <div className="flex flex-col divide-y divide-sentinel-border/50">
                {isLoading ? (
                    <div className="p-5 text-center text-muted text-sm font-mono">
                        <span className="animate-pulse">Loading forecasts...</span>
                    </div>
                ) : error ? (
                    <div className="p-5 text-center text-neon-red text-sm font-mono">
                        Failed to load forecasts
                    </div>
                ) : forecasts.length === 0 ? (
                    <div className="p-5 text-center text-muted text-sm font-mono">
                        No forecasts available
                    </div>
                ) : (
                    forecasts.map((f, i) => (
                        <div key={i} className="p-5 hover:bg-black/5 transition-colors group cursor-pointer text-left">
                            <div className="flex justify-between items-start mb-3">
                                <div className="flex flex-col">
                                    <h3 className="text-foreground text-sm font-medium font-mono">{f.label}</h3>
                                    <p className="text-muted text-xs mt-0.5">
                                        Target: <span className="text-foreground font-mono">{f.target}</span>
                                        {f.current && (
                                            <span className="ml-2 text-muted">
                                                (Now: <span className="font-mono">{f.current.toLocaleString()}</span>)
                                            </span>
                                        )}
                                    </p>
                                </div>
                                <div className="flex flex-col items-end">
                                    <span className={`text-sm font-bold font-mono ${f.confidence >= 60 ? 'text-neon-green' : f.confidence >= 40 ? 'text-primary' : 'text-muted'}`}>
                                        {f.confidence}%
                                    </span>
                                    <span className="text-[10px] text-muted uppercase tracking-wider">Confidence</span>
                                </div>
                            </div>
                            <div className="relative h-1.5 w-full bg-sentinel-border rounded-full overflow-hidden mb-3">
                                <div
                                    className={`absolute top-0 left-0 h-full rounded-full ${f.confidence >= 60 ? 'bg-neon-green shadow-[0_0_5px_#48964B]' : f.confidence >= 40 ? 'bg-primary' : 'bg-muted'}`}
                                    style={{ width: `${f.confidence}%` }}
                                ></div>
                            </div>
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1.5">
                                    <span className="material-symbols-outlined text-neon-green !text-[14px]">schedule</span>
                                    <span className="text-muted text-[11px] font-mono">Horizon: {f.horizon}</span>
                                </div>
                                <span className="material-symbols-outlined text-muted group-hover:text-neon-green transition-colors !text-[16px]">arrow_forward</span>
                            </div>
                        </div>
                    ))
                )}
            </div>

            <div className="bg-black/5 px-5 pt-4 pb-5 border-t border-sentinel-border flex items-center justify-between">
                <p className="text-muted text-[10px] font-medium flex items-center gap-1.5 uppercase">
                    <span className="relative flex h-2 w-2">
                        <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isLoading ? 'bg-primary' : 'bg-neon-green'}`}></span>
                        <span className={`relative inline-flex rounded-full h-2 w-2 ${isLoading ? 'bg-primary' : 'bg-neon-green'}`}></span>
                    </span>
                    Last Updated: {getTimeSinceUpdate()}
                </p>
                <button className="text-neon-green text-[10px] font-bold uppercase tracking-widest hover:underline transition-all font-mono">
                    Full Report
                </button>
            </div>
        </div>
    );
};
