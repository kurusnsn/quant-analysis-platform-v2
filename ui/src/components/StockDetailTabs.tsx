"use client";

import { useState } from "react";
import { useAssetAnalysis } from "@/hooks/useAssetAnalysis";
import { useStockFinancials } from "@/hooks/useStockFinancials";
import CandlestickChart from "./CandlestickChart";
import { useStockPrices } from "@/hooks/useStockPrices";
import { useMemo } from "react";

interface StockDetailTabsProps {
  ticker: string;
}

type TabType = "statistics" | "financials" | "chart";

export default function StockDetailTabs({ ticker }: StockDetailTabsProps) {
  const [activeTab, setActiveTab] = useState<TabType>("statistics");

  const { analysis, loading: analysisLoading } = useAssetAnalysis(ticker);
  const { financials, loading: financialsLoading } = useStockFinancials(ticker);
  const { getPrices } = useStockPrices();

  // Prepare chart data
  const chartData = useMemo(() => {
    const prices = getPrices(ticker);
    if (!prices) return [];

    const dates = Object.keys(prices).sort();
    return dates.slice(-90).map(date => ({
      date: new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      open: prices[date].open,
      high: prices[date].high,
      low: prices[date].low,
      close: prices[date].close,
      volume: prices[date].volume,
    }));
  }, [ticker, getPrices]);

  const tabs: Array<{ id: TabType; label: string; icon: string }> = [
    { id: "statistics", label: "Statistics", icon: "analytics" },
    { id: "financials", label: "Financials", icon: "account_balance" },
    { id: "chart", label: "Chart", icon: "show_chart" }
  ];

  return (
    <div className="mt-4 border-t border-border-color/30 pt-4">
      {/* Tab Buttons */}
      <div className="flex gap-1 mb-4">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-2xl transition-colors ${
              activeTab === tab.id
                ? "bg-primary text-white"
                : "text-muted hover:text-foreground hover:bg-surface-highlight"
            }`}
          >
            <span className="material-symbols-outlined !text-base">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="min-h-[300px]">
        {/* Statistics Tab */}
        {activeTab === "statistics" && (
          <div>
            {analysisLoading ? (
              <div className="grid grid-cols-2 gap-4">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="bg-surface-highlight rounded-2xl p-4 animate-pulse">
                    <div className="h-3 bg-border-color rounded w-1/2 mb-2"></div>
                    <div className="h-6 bg-border-color rounded w-3/4"></div>
                  </div>
                ))}
              </div>
            ) : analysis ? (
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-surface-highlight rounded-2xl p-4">
                  <p className="text-xs text-muted uppercase tracking-wider mb-1">Volatility</p>
                  <p className="text-2xl font-bold text-foreground">{(analysis.volatility * 100).toFixed(2)}%</p>
                </div>
                <div className="bg-surface-highlight rounded-2xl p-4">
                  <p className="text-xs text-muted uppercase tracking-wider mb-1">Sharpe Ratio</p>
                  <p className="text-2xl font-bold text-foreground">{analysis.sharpe_ratio.toFixed(2)}</p>
                </div>
                <div className="bg-surface-highlight rounded-2xl p-4">
                  <p className="text-xs text-muted uppercase tracking-wider mb-1">VaR (95%)</p>
                  <p className="text-2xl font-bold text-foreground">{(analysis.var_95 * 100).toFixed(2)}%</p>
                </div>
                <div className="bg-surface-highlight rounded-2xl p-4">
                  <p className="text-xs text-muted uppercase tracking-wider mb-1">CVaR (95%)</p>
                  <p className="text-2xl font-bold text-foreground">{(analysis.cvar_95 * 100).toFixed(2)}%</p>
                </div>
                <div className="bg-surface-highlight rounded-2xl p-4 col-span-2">
                  <p className="text-xs text-muted uppercase tracking-wider mb-1">Market Regime</p>
                  <p className="text-lg font-bold text-foreground capitalize">{analysis.regime.replace('_', ' ')}</p>
                </div>
              </div>
            ) : (
              <div className="text-center py-8 text-muted">
                <span className="material-symbols-outlined text-4xl mb-2 opacity-50">error</span>
                <p className="text-sm">Unable to load statistics</p>
              </div>
            )}
          </div>
        )}

        {/* Financials Tab */}
        {activeTab === "financials" && (
          <div>
            {financialsLoading ? (
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="h-16 bg-surface-highlight rounded animate-pulse"></div>
                ))}
              </div>
            ) : financials?.key_stats ? (
              <div className="grid grid-cols-2 gap-4">
                {financials.key_stats.market_cap && typeof financials.key_stats.market_cap === 'number' && (
                  <div className="bg-surface-highlight rounded-2xl p-4">
                    <p className="text-xs text-muted uppercase tracking-wider mb-1">Market Cap</p>
                    <p className="text-xl font-bold text-foreground">
                      ${(financials.key_stats.market_cap / 1e9).toFixed(2)}B
                    </p>
                  </div>
                )}
                {financials.key_stats.total_revenue && typeof financials.key_stats.total_revenue === 'number' && (
                  <div className="bg-surface-highlight rounded-2xl p-4">
                    <p className="text-xs text-muted uppercase tracking-wider mb-1">Revenue</p>
                    <p className="text-xl font-bold text-foreground">
                      ${(financials.key_stats.total_revenue / 1e9).toFixed(2)}B
                    </p>
                  </div>
                )}
                {financials.key_stats.gross_profit && typeof financials.key_stats.gross_profit === 'number' && (
                  <div className="bg-surface-highlight rounded-2xl p-4">
                    <p className="text-xs text-muted uppercase tracking-wider mb-1">Gross Profit</p>
                    <p className="text-xl font-bold text-foreground">
                      ${(financials.key_stats.gross_profit / 1e9).toFixed(2)}B
                    </p>
                  </div>
                )}
                {financials.key_stats.net_income && typeof financials.key_stats.net_income === 'number' && (
                  <div className="bg-surface-highlight rounded-2xl p-4">
                    <p className="text-xs text-muted uppercase tracking-wider mb-1">Net Income</p>
                    <p className="text-xl font-bold text-foreground">
                      ${(financials.key_stats.net_income / 1e9).toFixed(2)}B
                    </p>
                  </div>
                )}
                {financials.key_stats.eps_diluted && typeof financials.key_stats.eps_diluted === 'number' && (
                  <div className="bg-surface-highlight rounded-2xl p-4">
                    <p className="text-xs text-muted uppercase tracking-wider mb-1">EPS (Diluted)</p>
                    <p className="text-xl font-bold text-foreground">${financials.key_stats.eps_diluted.toFixed(2)}</p>
                  </div>
                )}
                {financials.key_stats.total_debt && typeof financials.key_stats.total_debt === 'number' && (
                  <div className="bg-surface-highlight rounded-2xl p-4">
                    <p className="text-xs text-muted uppercase tracking-wider mb-1">Total Debt</p>
                    <p className="text-xl font-bold text-foreground">
                      ${(financials.key_stats.total_debt / 1e9).toFixed(2)}B
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-8 text-muted">
                <span className="material-symbols-outlined text-4xl mb-2 opacity-50">account_balance</span>
                <p className="text-sm">No financial data available</p>
              </div>
            )}
          </div>
        )}

        {/* Chart Tab */}
        {activeTab === "chart" && (
          <div>
            {chartData.length > 0 ? (
              <CandlestickChart data={chartData} height={300} showVolume={true} />
            ) : (
              <div className="text-center py-8 text-muted">
                <span className="material-symbols-outlined text-4xl mb-2 opacity-50">show_chart</span>
                <p className="text-sm">No chart data available</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
