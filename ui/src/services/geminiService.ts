"use server";
import { devConsole } from "@/lib/devLog";

import { cookies, headers } from "next/headers";
import {
    DEV_USER_COOKIE,
    DEV_USER_HEADER,
    decodeDevUser,
    encodeDevUser,
    getConfiguredDevUser,
} from "@/lib/devAuth";
import { buildGatewayAuthorization } from "@/lib/gatewayAuth";

const rawApiUrl =
    process.env.API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    "http://localhost:8000/api";
const normalizedApiUrl = rawApiUrl.replace(/\/+$/, "");
const API_URL = normalizedApiUrl.endsWith("/api")
    ? normalizedApiUrl
    : `${normalizedApiUrl}/api`;

export interface GeneratedTicker {
    symbol: string;
    name: string;
    sector: string;
    price?: number;
    riskScore: number;
    volatility_30d?: number;
    sharpe_ratio?: number;
    var_95?: number;
    cvar_95?: number;
}

export interface GeneratedCitation {
    source: string;
    title?: string;
    url?: string | null;
    chunk?: string;
}

export interface GeneratedFiling {
    form?: string;
    filingDate?: string;
    description?: string;
    url?: string | null;
}

export interface GeneratedFinancialHighlights {
    marketCap?: number;
    totalRevenue?: number;
    netIncome?: number;
    totalDebt?: number;
    epsDiluted?: number;
    trailingPE?: number;
    forwardPE?: number;
    priceToSales?: number;
    priceToBook?: number;
    evToEbitda?: number;
    pegRatio?: number;
}

export interface NewsSentimentArticle {
    title: string;
    publisher?: string;
    providerPublishTime?: string | number;
    sentiment: string;
    positive: number;
    negative: number;
    neutral: number;
}

export interface NewsSentimentAggregate {
    positive: number;
    negative: number;
    neutral: number;
    label: string;
    count: number;
}

export interface IncomeChange {
    revenueChange?: number;
    netIncomeChange?: number;
    latestRevenue?: number;
    prevRevenue?: number;
    latestNetIncome?: number;
    prevNetIncome?: number;
}

export interface GeneratedTickerExplanation {
    symbol: string;
    rationale: string;
    filings: GeneratedFiling[];
    financialHighlights?: GeneratedFinancialHighlights;
    newsSentiment?: {
        articles: NewsSentimentArticle[];
        aggregate: NewsSentimentAggregate | null;
    };
    incomeChange?: IncomeChange;
}

export interface WatchlistResult {
    watchlistId?: string;
    watchlistName: string;
    narrative: string;
    reasoning?: string | null;
    model?: string | null;
    deepResearch?: boolean;
    citations?: GeneratedCitation[];
    tickerExplanations?: GeneratedTickerExplanation[];
    tickers: GeneratedTicker[];
    meta?: {
        intent?: {
            sector?: string;
            risk_level?: string;
            theme?: string;
        };
        regime?: {
            current_regime?: string;
            persistence_probability?: number;
        };
        simulation?: {
            loss_probability_30d?: number;
            expected_return?: number;
        };
        constraints?: {
            min_market_cap?: number;
            min_volume?: number;
            max_tickers?: number;
        };
        rag?: {
            enabled?: boolean;
            context_hits?: number;
        };
    };
}

export type GenerateWatchlistResponse =
    | { ok: true; data: WatchlistResult }
    | { ok: false; error: string; status?: number };

const coerceErrorText = (value: unknown, maxLen = 240) => {
    const text = typeof value === "string" ? value : "";
    const normalized = text.replace(/\s+/g, " ").trim();
    if (normalized.length <= maxLen) return normalized;
    return `${normalized.slice(0, maxLen)}...`;
};

const tryParseJson = <T,>(value: string): T | null => {
    try {
        return JSON.parse(value) as T;
    } catch {
        return null;
    }
};

const asString = (value: unknown): string | undefined => {
    if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed ? trimmed : undefined;
    }
    return undefined;
};

const asNumber = (value: unknown): number | undefined => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
};

const extractGatewayErrorText = (bodyText: string): string => {
    const trimmed = bodyText.trim();
    if (!trimmed) return "";

    const parsed = tryParseJson<unknown>(trimmed);
    if (!parsed) return trimmed;

    if (typeof parsed === "string") return parsed;

    if (typeof parsed === "object" && parsed) {
        const record = parsed as Record<string, unknown>;
        const candidate = record.error ?? record.detail ?? record.message;
        if (typeof candidate === "string" && candidate.trim()) {
            const normalized = candidate.trim();
            const prefix = "AI Engine error:";
            if (normalized.startsWith(prefix)) {
                const nested = normalized.slice(prefix.length).trim();
                const nestedParsed = tryParseJson<Record<string, unknown>>(nested);
                const nestedDetail = nestedParsed?.detail ?? nestedParsed?.error ?? nestedParsed?.message;
                if (typeof nestedDetail === "string" && nestedDetail.trim()) {
                    return nestedDetail.trim();
                }
            }
            return normalized;
        }
    }

    return trimmed;
};

const humanizeGatewayError = (message: string): string => {
    const normalized = message.replace(/\s+/g, " ").trim();
    if (!normalized) return "";

    if (normalized.toLowerCase() === "prompt too short") {
        return "Prompt too short. Please enter at least 2 characters.";
    }

    if (normalized.toLowerCase() === "prompt too long") {
        return "Prompt too long. Please shorten your prompt and try again.";
    }

    return normalized;
};

export const generateStrategyWatchlist = async (
    prompt: string,
    options?: { deepResearch?: boolean }
): Promise<GenerateWatchlistResponse> => {
    try {
        const cookieStore = await cookies();
        const headerStore = await headers();
        const isDev = process.env.NODE_ENV === "development";
        const forwardedHost =
            headerStore
                .get("x-forwarded-host")
                ?.split(",")[0]
                ?.trim()
                .toLowerCase() ?? "";
        const hostHeader = headerStore.get("host")?.toLowerCase() ?? "";
        const requestHost = forwardedHost || hostHeader;
        const isLocalHostRequest =
            requestHost === "localhost" ||
            requestHost.startsWith("localhost:") ||
            requestHost === "127.0.0.1" ||
            requestHost.startsWith("127.0.0.1:");
        const devAuthEnabled =
            isDev || process.env.NEXT_PUBLIC_DEV_AUTH === "true" || isLocalHostRequest;

        const gatewayAuthorization = await buildGatewayAuthorization(
            cookieStore.getAll().map((entry) => ({ name: entry.name, value: entry.value })),
        );

        const devCookie = devAuthEnabled ? cookieStore.get(DEV_USER_COOKIE)?.value : null;
        const devUserFromCookie = devCookie ? decodeDevUser(devCookie) : null;
        const devUser = devUserFromCookie ?? (devAuthEnabled ? getConfiguredDevUser() : null);

        if (!gatewayAuthorization && !devUser) {
            return {
                ok: false,
                error: "Not authenticated. Sign in or enable DevAuth for this deployment.",
                status: 401,
            };
        }

        const response = await fetch(`${API_URL}/watchlists/generate`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(gatewayAuthorization ? { Authorization: gatewayAuthorization } : {}),
                ...(devUser ? { [DEV_USER_HEADER]: encodeDevUser(devUser) } : {}),
            },
            body: JSON.stringify({
                prompt,
                deepResearch: Boolean(options?.deepResearch),
            }),
        });

        if (!response.ok) {
            const bodyText = await response.text().catch(() => "");
            const extracted = extractGatewayErrorText(bodyText);
            const humanized = humanizeGatewayError(extracted);
            const bestMessage = coerceErrorText(humanized || extracted);

            const safeMessage =
                // Always show safe, human-readable errors when we can.
                bestMessage ||
                // Keep dev useful for debugging, but avoid dumping raw JSON when possible.
                (isDev ? coerceErrorText(bodyText) : "") ||
                `Gateway error (${response.status}).`;
            return {
                ok: false,
                status: response.status,
                error: safeMessage,
            };
        }

        const result = await response.json();
        const asRecord = (value: unknown): Record<string, unknown> =>
            typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
        const raw = asRecord(result);
        const rawTickers =
            Array.isArray(raw.tickers) ? raw.tickers :
                Array.isArray(raw.Tickers) ? raw.Tickers :
                    [];
        const rawCitations =
            Array.isArray(raw.citations) ? raw.citations :
                Array.isArray(raw.Citations) ? raw.Citations :
                    [];
        const rawTickerExplanations =
            Array.isArray(raw.tickerExplanations) ? raw.tickerExplanations :
                Array.isArray(raw.TickerExplanations) ? raw.TickerExplanations :
                    [];

        // Normalize response to match expected interface
        const normalized: WatchlistResult = {
            watchlistId: asString(raw.watchlistId) ?? asString(raw.WatchlistId),
            watchlistName:
                asString(raw.watchlistName) ??
                asString(raw.WatchlistName) ??
                "Strategy Portfolio",
            narrative: asString(raw.narrative) ?? asString(raw.Narrative) ?? "",
            reasoning: asString(raw.reasoning) ?? asString(raw.Reasoning) ?? null,
            model: asString(raw.model) ?? asString(raw.Model) ?? null,
            deepResearch:
                typeof raw.deepResearch === "boolean"
                    ? raw.deepResearch
                    : typeof raw.DeepResearch === "boolean"
                        ? raw.DeepResearch
                        : Boolean(options?.deepResearch),
            tickers: rawTickers
                .map((item): GeneratedTicker | null => {
                    const ticker = asRecord(item);
                    const symbol = asString(ticker.symbol) ?? asString(ticker.Symbol);
                    if (!symbol) return null;
                    return {
                        symbol,
                        name: asString(ticker.name) ?? asString(ticker.Name) ?? symbol,
                        sector: asString(ticker.sector) ?? asString(ticker.Sector) ?? "Unknown",
                        price: asNumber(ticker.price) ?? asNumber(ticker.Price),
                        riskScore: asNumber(ticker.riskScore) ?? asNumber(ticker.RiskScore) ?? 50,
                        volatility_30d: asNumber(ticker.volatility_30d) ?? asNumber(ticker.Volatility_30d),
                        sharpe_ratio: asNumber(ticker.sharpe_ratio) ?? asNumber(ticker.Sharpe_ratio),
                        var_95: asNumber(ticker.var_95) ?? asNumber(ticker.Var_95),
                        cvar_95: asNumber(ticker.cvar_95) ?? asNumber(ticker.Cvar_95),
                    };
                })
                .filter((item): item is GeneratedTicker => item !== null),
            citations: rawCitations
                .map((item): GeneratedCitation | null => {
                    const citation = asRecord(item);
                    const source = asString(citation.source) ?? asString(citation.Source);
                    if (!source) return null;
                    return {
                        source,
                        title: asString(citation.title) ?? asString(citation.Title),
                        url: asString(citation.url) ?? asString(citation.Url) ?? null,
                        chunk: asString(citation.chunk) ?? asString(citation.Chunk),
                    };
                })
                .filter((item): item is GeneratedCitation => item !== null),
            tickerExplanations: rawTickerExplanations
                .map((item): GeneratedTickerExplanation | null => {
                    const explanation = asRecord(item);
                    const symbol = asString(explanation.symbol) ?? asString(explanation.Symbol);
                    if (!symbol) return null;
                    const rationale =
                        asString(explanation.rationale) ??
                        asString(explanation.Rationale) ??
                        "Selected by the generator.";
                    const financials = asRecord(explanation.financialHighlights ?? explanation.FinancialHighlights);
                    const filingsRaw = Array.isArray(explanation.filings)
                        ? explanation.filings
                        : Array.isArray(explanation.Filings)
                            ? explanation.Filings
                            : [];
                    // Pass through news sentiment and income change from backend
                    const rawSentiment = asRecord(explanation.newsSentiment);
                    const rawIncomeChange = asRecord(explanation.incomeChange);

                    return {
                        symbol,
                        rationale,
                        financialHighlights: {
                            marketCap: asNumber(financials.marketCap) ?? asNumber(financials.MarketCap),
                            totalRevenue: asNumber(financials.totalRevenue) ?? asNumber(financials.TotalRevenue),
                            netIncome: asNumber(financials.netIncome) ?? asNumber(financials.NetIncome),
                            totalDebt: asNumber(financials.totalDebt) ?? asNumber(financials.TotalDebt),
                            epsDiluted: asNumber(financials.epsDiluted) ?? asNumber(financials.EpsDiluted),
                            trailingPE: asNumber(financials.trailingPE),
                            forwardPE: asNumber(financials.forwardPE),
                            priceToSales: asNumber(financials.priceToSales),
                            priceToBook: asNumber(financials.priceToBook),
                            evToEbitda: asNumber(financials.evToEbitda),
                            pegRatio: asNumber(financials.pegRatio),
                        },
                        filings: filingsRaw
                            .map((filing): GeneratedFiling | null => {
                                const f = asRecord(filing);
                                return {
                                    form: asString(f.form) ?? asString(f.Form),
                                    filingDate: asString(f.filingDate) ?? asString(f.FilingDate),
                                    description: asString(f.description) ?? asString(f.Description),
                                    url: asString(f.url) ?? asString(f.Url) ?? null,
                                };
                            })
                            .filter((entry): entry is GeneratedFiling => entry !== null),
                        ...(rawSentiment && Object.keys(rawSentiment).length > 0
                            ? { newsSentiment: rawSentiment as unknown as GeneratedTickerExplanation["newsSentiment"] }
                            : {}),
                        ...(rawIncomeChange && Object.keys(rawIncomeChange).length > 0
                            ? { incomeChange: rawIncomeChange as unknown as IncomeChange }
                            : {}),
                    };
                })
                .filter((item): item is GeneratedTickerExplanation => item !== null),
            meta: asRecord(raw.meta ?? raw.Meta) as WatchlistResult["meta"],
        };

        return { ok: true, data: normalized };
    } catch (e) {
        devConsole.error("Failed to generate watchlist:", e);
        const message = e instanceof Error ? e.message : "Failed to generate watchlist.";
        return { ok: false, error: coerceErrorText(message) || "Failed to generate watchlist." };
    }
};
