
import React from 'react';
import { IconTrendingUp, IconTrendingDown } from './Icons';
import { SparklineChart } from './SparklineChart';

interface TickerProps {
    label: string;
    value: string;
    change: string;
    status: string;
    statusColor: string;
    percent: number;
    history?: number[]; // Optional history data
}

export const MarketTicker: React.FC<TickerProps> = ({ label, value, change, status, statusColor, percent, history }) => {
    const isPositive = !change.startsWith('-');

    // Generate mock data if history is missing for visual demo
    // Create a 20-point array that trends in the direction of isPositive
    const mockData = React.useMemo(() => {
        if (history) return history;

        const seedInput = `${label}|${change}|${percent}`;
        let seed = 0;
        for (let i = 0; i < seedInput.length; i += 1) {
            seed = (seed * 31 + seedInput.charCodeAt(i)) | 0;
        }

        let state = seed >>> 0;
        const rand = () => {
            state = (state * 1664525 + 1013904223) >>> 0;
            return state / 2 ** 32;
        };

        const data = [50];
        let current = 50;
        const trendFactor = isPositive ? 2 : -2;

        for (let i = 0; i < 20; i++) {
            const noise = (rand() - 0.5) * 10;
            current += trendFactor + noise;
            data.push(current);
        }
        return data;
    }, [history, isPositive, label, change, percent]);

    return (
        <div className="bg-sentinel-card border border-sentinel-border p-5 rounded-2xl flex flex-col gap-2 hover:border-sentinel-accent/50 transition-colors cursor-default h-48 justify-between relative overflow-hidden">
            <div className="flex justify-between items-start z-10 relative">
                <div className="flex flex-col gap-1.5">
                    <p className="text-[10px] font-bold text-sentinel-muted uppercase tracking-[0.1em]">{label}</p>
                    <span className={`text-[8px] font-bold px-2 py-0.5 border rounded-full uppercase tracking-tighter self-start`} style={{ color: statusColor, borderColor: statusColor, backgroundColor: `${statusColor}10` }}>
                        {status}
                    </span>
                </div>
                <div className="flex flex-col items-end">
                    <p className="text-2xl font-black text-sentinel-primary tracking-tight leading-none">{value}</p>
                    <p className={`text-xs font-bold flex items-center mt-1 ${isPositive ? 'text-neon-green' : 'text-neon-red'}`} style={{ textShadow: isPositive ? '0 0 10px rgba(72,150,75,0.5)' : '0 0 10px rgba(255,109,135,0.5)' }}>
                        {isPositive ? <IconTrendingUp className="w-3 h-3 mr-1" /> : <IconTrendingDown className="w-3 h-3 mr-1" />}
                        {change}
                    </p>
                </div>
            </div>

            <div className="absolute bottom-0 left-0 right-0 h-24 opacity-80 pointer-events-none">
                <SparklineChart
                    data={history || mockData}
                    isPositive={isPositive}
                    color={isPositive ? 'var(--neon-green)' : 'var(--neon-red)'}
                />
            </div>
        </div>
    );
};
