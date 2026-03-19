
export interface Ticker {
    symbol: string;
    name: string;
    price: string;
    change: string;
    isPositive: boolean;
    riskScore: number;
    logoUrl?: string | null;
}

export interface Watchlist {
    id: string;
    name: string;
    riskLevel: 'High' | 'Low' | 'Stable';
    correlation: number;
    tickers: Ticker[];
    dailyChange: string;
}

export interface RiskIndicator {
    id: string;
    name: string;
    correlation: number;
    status: 'Critical' | 'High Risk' | 'Normal' | 'Stable';
}

export interface Forecast {
    label: string;
    value: number;
    trend: 'up' | 'down';
}

export interface StockPopularity {
    symbol: string;
    watchlistCount: number;
    updatedAt?: string | null;
}
