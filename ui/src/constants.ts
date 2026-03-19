import { Watchlist, RiskIndicator, Forecast } from './types';

export const MOCK_WATCHLISTS: Watchlist[] = [
    {
        id: 'w1',
        name: 'AI Speculative',
        riskLevel: 'High',
        correlation: 0.84,
        dailyChange: '-2.15%',
        tickers: [
            { symbol: 'NVDA', name: 'NVIDIA Corp', price: '$875.24', change: '+2.4%', isPositive: true, riskScore: 72 },
            { symbol: 'ARM', name: 'Arm Holdings', price: '$120.10', change: '-1.5%', isPositive: false, riskScore: 85 },
            { symbol: 'TSM', name: 'TSMC', price: '$145.50', change: '-0.8%', isPositive: false, riskScore: 68 }
        ]
    },
    {
        id: 'w2',
        name: 'Dividend Safety',
        riskLevel: 'Low',
        correlation: 0.12,
        dailyChange: '+0.42%',
        tickers: [
            { symbol: 'JNJ', name: 'Johnson & Johnson', price: '$155.20', change: '+0.2%', isPositive: true, riskScore: 12 },
            { symbol: 'PG', name: 'Procter & Gamble', price: '$160.10', change: '+0.5%', isPositive: true, riskScore: 15 },
            { symbol: 'KO', name: 'Coca-Cola', price: '$60.50', change: '+0.1%', isPositive: true, riskScore: 18 }
        ]
    }
];

export const MOCK_RISK_RADAR: RiskIndicator[] = [
    { id: '01', name: 'Crypto vs Tech Correlation', correlation: 0.92, status: 'Critical' },
    { id: '02', name: 'USD/JPY vs S&P 500 Baselines', correlation: 0.84, status: 'High Risk' },
    { id: '03', name: 'Gold vs Real Yield Variance', correlation: 0.12, status: 'Stable' }
];

export const MOCK_FORECASTS: Forecast[] = [
    { label: 'Regime Shift Prob', value: 78, trend: 'down' },
    { label: 'Mean Reversion Risk', value: 82, trend: 'up' },
    { label: 'Volatility Breakout', value: 45, trend: 'down' }
];
