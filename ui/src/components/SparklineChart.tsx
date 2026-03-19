"use client";

import { useId, useMemo } from "react";
import { Area, AreaChart, ResponsiveContainer, YAxis } from "recharts";

interface SparklineProps {
    data: number[];
    isPositive: boolean;
    color: string;
}

export function SparklineChart({ data, isPositive, color }: SparklineProps) {
    // Create chart-friendly data
    const chartData = data.map((val, i) => ({ i, val }));

    // Neon colors
    const neonGreen = "#00ff41";
    const neonRed = "#ff0055";

    // Choose stroke color based on trend if not explicitly provided
    const strokeColor = color || (isPositive ? neonGreen : neonRed);

    const rawId = useId();
    const gradientId = useMemo(
        () => `sparkline-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`,
        [rawId]
    );

    return (
        <div className="h-16 w-full -mx-2">
            <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                    <defs>
                        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={strokeColor} stopOpacity={0.4} />
                            <stop offset="90%" stopColor={strokeColor} stopOpacity={0.0} />
                        </linearGradient>
                    </defs>
                    <YAxis domain={['auto', 'auto']} hide />
                    <Area
                        type="monotone"
                        dataKey="val"
                        stroke={strokeColor}
                        strokeWidth={2}
                        fill={`url(#${gradientId})`}
                        animationDuration={1500}
                    />
                </AreaChart>
            </ResponsiveContainer>
        </div>
    );
}
