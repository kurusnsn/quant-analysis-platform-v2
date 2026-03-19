"use client";

import { ResponsiveContainer, ComposedChart, XAxis, YAxis, Tooltip, Bar, Line, CartesianGrid, Cell, usePlotArea, useXAxisDomain } from 'recharts';
import { useMemo } from 'react';

export interface CandlestickData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface CandlestickChartProps {
  data: CandlestickData[];
  height?: number;
  showVolume?: boolean;
}

interface CandlestickLayerProps {
  data: CandlestickData[];
  yDomain: [number, number];
}

function CandlestickLayer({ data, yDomain }: CandlestickLayerProps) {
  const plotArea = usePlotArea();
  const xDomain = useXAxisDomain();

  if (!plotArea || !data.length || plotArea.width <= 0 || plotArea.height <= 0) return null;

  const [yMin, yMax] = yDomain;
  const range = yMax - yMin || 1;

  const domainValues =
    Array.isArray(xDomain) && xDomain.length && typeof xDomain[0] === 'string'
      ? (xDomain as string[])
      : data.map((entry) => entry.date);

  const count = domainValues.length || data.length;
  if (!count) return null;

  const step = plotArea.width / count;
  const candleWidth = Math.max(step * 0.6, 2);
  const wickWidth = Math.max(candleWidth * 0.15, 1);
  const indexByValue = new Map(domainValues.map((value, index) => [value, index]));

  const scaleY = (value: number) => plotArea.y + ((yMax - value) / range) * plotArea.height;

  return (
    <g>
      {data.map((entry, index) => {
        const domainIndex = indexByValue.get(entry.date) ?? index;
        const xCenter = plotArea.x + step * (domainIndex + 0.5);

        const openY = scaleY(entry.open);
        const closeY = scaleY(entry.close);
        const highY = scaleY(entry.high);
        const lowY = scaleY(entry.low);

        if ([openY, closeY, highY, lowY].some((value) => !Number.isFinite(value))) {
          return null;
        }

        const isGreen = entry.close >= entry.open;
        const color = isGreen ? '#00ff41' : '#ff0055';
        const bodyTop = Math.min(openY, closeY);
        const bodyBottom = Math.max(openY, closeY);
        const bodyHeight = Math.max(bodyBottom - bodyTop, 1);

        return (
          <g key={`${entry.date}-${index}`}>
            <line
              x1={xCenter}
              y1={highY}
              x2={xCenter}
              y2={lowY}
              stroke={color}
              strokeWidth={wickWidth}
            />
            <rect
              x={xCenter - candleWidth / 2}
              y={bodyTop}
              width={candleWidth}
              height={bodyHeight}
              fill={color}
              stroke={color}
              strokeWidth={1}
            />
          </g>
        );
      })}
    </g>
  );
}

export default function CandlestickChart({
  data,
  height = 350,
  showVolume = true
}: CandlestickChartProps) {

  // Transform data for candlestick rendering
  const chartData = useMemo(() => {
    return data.map((d) => {
      const isGreen = d.close >= d.open;
      return {
        ...d,
        // Color
        color: isGreen ? '#00ff41' : '#ff0055',
        isGreen,
      };
    });
  }, [data]);

  // Calculate y-axis domain with padding
  const yDomain = useMemo<[number, number]>(() => {
    if (chartData.length === 0) return [0, 100];
    const lows = chartData.map(d => d.low);
    const highs = chartData.map(d => d.high);
    const min = Math.min(...lows);
    const max = Math.max(...highs);
    const padding = (max - min) * 0.1;
    return [min - padding, max + padding];
  }, [chartData]);

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload || !payload[0]) return null;

    const data = payload[0].payload;
    const isGreen = data.isGreen;

    return (
      <div className="bg-surface border border-border-color rounded-2xl p-3 shadow-lg">
        <p className="text-xs font-semibold text-foreground mb-2">{data.date}</p>
        <div className="space-y-1 text-xs">
          <div className="flex justify-between gap-4">
            <span className="text-muted">Open:</span>
            <span className="font-mono text-foreground">${data.open.toFixed(2)}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted">High:</span>
            <span className="font-mono text-foreground">${data.high.toFixed(2)}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted">Low:</span>
            <span className="font-mono text-foreground">${data.low.toFixed(2)}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted">Close:</span>
            <span className={`font-mono font-semibold ${isGreen ? 'text-[#00ff41]' : 'text-[#ff0055]'}`}>
              ${data.close.toFixed(2)}
            </span>
          </div>
          {showVolume && (
            <div className="flex justify-between gap-4 pt-1 border-t border-border-color/30 mt-1">
              <span className="text-muted">Volume:</span>
              <span className="font-mono text-foreground">
                {(data.volume / 1000000).toFixed(2)}M
              </span>
            </div>
          )}
        </div>
      </div>
    );
  };

  const volumeHeight = showVolume ? height * 0.25 : 0;
  const candleHeight = height - volumeHeight;

  return (
    <div className="space-y-2">
      {/* Candlestick Chart */}
      <ResponsiveContainer width="100%" height={candleHeight}>
        <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis
            dataKey="date"
            tick={{ fill: '#e8e4d9', fontSize: 11 }}
            tickLine={{ stroke: 'rgba(255,255,255,0.1)' }}
            axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
          />
          <YAxis
            domain={yDomain}
            tick={{ fill: '#e8e4d9', fontSize: 11 }}
            tickLine={{ stroke: 'rgba(255,255,255,0.1)' }}
            axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
            tickFormatter={(value) => `$${value.toFixed(0)}`}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'rgba(0,255,65,0.2)', strokeWidth: 1 }} />

          {/* Invisible line for tooltip + custom candlestick rendering */}
          <Line
            dataKey="close"
            stroke="transparent"
            dot={false}
            activeDot={{ r: 3, fill: "transparent", stroke: "transparent" }}
            isAnimationActive={false}
          />
          <CandlestickLayer data={chartData} yDomain={yDomain} />
        </ComposedChart>
      </ResponsiveContainer>

      {/* Volume Chart */}
      {showVolume && (
        <ResponsiveContainer width="100%" height={volumeHeight}>
          <ComposedChart data={chartData} margin={{ top: 0, right: 10, left: 0, bottom: 5 }}>
            <XAxis
              dataKey="date"
              tick={{ fill: '#e8e4d9', fontSize: 10 }}
              tickLine={{ stroke: 'rgba(255,255,255,0.1)' }}
              axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
              hide
            />
            <YAxis
              tick={{ fill: '#e8e4d9', fontSize: 10 }}
              tickLine={{ stroke: 'rgba(255,255,255,0.1)' }}
              axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
              tickFormatter={(value) => `${(value / 1000000).toFixed(0)}M`}
            />
            <Tooltip
              content={({ active, payload }: any) => {
                if (!active || !payload || !payload[0]) return null;
                const data = payload[0].payload;
                const volumeColor = data.isGreen ? "bg-[#00ff41]" : "bg-[#ff0055]";
                const dayLabel = data.isGreen ? "Up day" : "Down day";
                return (
                  <div className="bg-surface border border-border-color rounded-2xl px-3 py-2 shadow-lg">
                    <div className="flex items-center gap-2 text-xs text-muted">
                      <span className={`inline-block h-2 w-2 rounded-full ${volumeColor}`} />
                      <span>{dayLabel}</span>
                    </div>
                    <p className="text-sm font-mono text-foreground">
                      {(data.volume / 1000000).toFixed(2)}M
                    </p>
                  </div>
                );
              }}
            />
            <Bar dataKey="volume" radius={[2, 2, 0, 0]}>
              {chartData.map((entry, index) => (
                <Cell
                  key={`volume-cell-${index}`}
                  fill={entry.isGreen ? "rgba(0, 255, 65, 0.35)" : "rgba(255, 0, 85, 0.35)"}
                />
              ))}
            </Bar>
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
