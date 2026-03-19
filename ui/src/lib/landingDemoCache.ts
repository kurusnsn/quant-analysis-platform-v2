import type { MarketSynthesisResponse } from "@/hooks/useMarketSynthesis";
import landingDemoSeed from "@/lib/landingDemoSeed.json";

type DemoKeyStats = MarketSynthesisResponse["key_stats"];

type TickerSnapshot = {
  symbol?: string;
};

type TickerExplanationSnapshot = {
  symbol?: string;
  rationale?: string;
};

export type DemoTicker = { symbol: string; name?: string };

export type DemoFinancialHighlights = {
  marketCap?: number | null;
  totalRevenue?: number | null;
  netIncome?: number | null;
  epsDiluted?: number | null;
};

export type DemoIncomeChange = {
  revenueChange?: number | null;
  netIncomeChange?: number | null;
};

export type DemoFiling = {
  form?: string | null;
  filingDate?: string | null;
  url?: string | null;
};

export type DemoNewsArticle = {
  title: string;
  sentiment: "positive" | "negative" | "neutral";
};

export type DemoNewsSentiment = {
  aggregate?: { label: "positive" | "negative" | "neutral"; count: number } | null;
  articles?: DemoNewsArticle[];
};

export type DemoTickerExplanation = {
  symbol: string;
  rationale: string;
  sentiment?: "positive" | "negative" | "neutral";
  financialHighlights?: DemoFinancialHighlights;
  incomeChange?: DemoIncomeChange;
  filings?: DemoFiling[];
  newsSentiment?: DemoNewsSentiment;
};

type MetaSnapshot = {
  intent?: {
    theme?: string;
    risk_level?: string;
  };
  regime?: {
    current_regime?: string;
  };
};

export type LandingDemoSnapshotInput = {
  watchlistName?: string;
  narrative?: string | null;
  reasoning?: string | null;
  tickers?: TickerSnapshot[];
  tickerExplanations?: TickerExplanationSnapshot[];
  meta?: MetaSnapshot;
};

export type LandingDemoSynthesis = {
  prompt: string;
  watchlistName: string;
  summary: string;
  insights: string[];
  keyStats: DemoKeyStats;
  savedAt: string;
  source: "seed" | "homepage";
  reasoning?: string | null;
  model?: string | null;
  tickers?: DemoTicker[];
  tickerExplanations?: DemoTickerExplanation[];
};

type LandingDemoStoragePayload = {
  version: number;
  entries: Record<string, LandingDemoSynthesis>;
};

export const LANDING_DEMO_PROMPTS = [
  "AI stocks",
  "AI hardware leaders",
  "Cybersecurity leaders",
  "Defensive healthcare",
  "Semiconductor supply chain",
  "Energy transition winners",
  "Cash-flow compounders",
] as const;

const LANDING_DEMO_STORAGE_KEY = "quant-platform_landing_demo_synthesis_v2";
const LANDING_DEMO_STORAGE_VERSION = 2;
const DEFAULT_PROMPT_KEY = "ai stocks";

const PROMPT_ALIASES: Record<string, string> = {
  "high-risk ai stocks": "ai stocks",
  "high risk ai stocks": "ai stocks",
};

const FALLBACK_TIMESTAMP = "2025-01-01T00:00:00.000Z";

const DEFAULT_KEY_STATS: DemoKeyStats = {
  sp500_change: 0.62,
  nasdaq_change: 1.08,
  dow_change: 0.21,
  vix: 17.4,
};

const cleanText = (value: unknown) => {
  if (typeof value !== "string") return "";
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

const clampWords = (value: string, maxWords = 95) => {
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return value;
  return `${words.slice(0, maxWords).join(" ")}...`;
};

const clampChars = (value: string, maxChars = 190) => {
  if (value.length <= maxChars) return value;
  const truncated = value.slice(0, maxChars).trimEnd();
  return `${truncated}...`;
};

export const normalizeLandingDemoPrompt = (prompt: string) => {
  const normalized = prompt.trim().toLowerCase().replace(/\s+/g, " ");
  return PROMPT_ALIASES[normalized] ?? normalized;
};

const promptLabelByKey = LANDING_DEMO_PROMPTS.reduce<Record<string, string>>((acc, prompt) => {
  acc[normalizeLandingDemoPrompt(prompt)] = prompt;
  return acc;
}, {});

const knownPromptKeys = new Set(Object.keys(promptLabelByKey));

const cloneDemo = (demo: LandingDemoSynthesis): LandingDemoSynthesis => ({
  ...demo,
  insights: [...demo.insights],
  keyStats: { ...demo.keyStats },
  tickers: demo.tickers ? demo.tickers.map((t) => ({ ...t })) : undefined,
  tickerExplanations: demo.tickerExplanations
    ? demo.tickerExplanations.map((t) => ({
      ...t,
      financialHighlights: t.financialHighlights ? { ...t.financialHighlights } : undefined,
      incomeChange: t.incomeChange ? { ...t.incomeChange } : undefined,
      filings: t.filings ? t.filings.map((f) => ({ ...f })) : undefined,
      newsSentiment: t.newsSentiment
        ? {
          ...t.newsSentiment,
          aggregate: t.newsSentiment.aggregate ? { ...t.newsSentiment.aggregate } : undefined,
          articles: t.newsSentiment.articles ? t.newsSentiment.articles.map((a) => ({ ...a })) : undefined,
        }
        : undefined,
    }))
    : undefined,
});

const cloneLibrary = (library: Record<string, LandingDemoSynthesis>) =>
  Object.fromEntries(Object.entries(library).map(([key, demo]) => [key, cloneDemo(demo)]));

type DemoTickerData = Pick<DemoTickerExplanation, "financialHighlights" | "incomeChange" | "filings" | "newsSentiment">;

const DEMO_TICKER_FINANCIALS: Record<string, DemoTickerData> = {
  NVDA: {
    financialHighlights: { marketCap: 3.4e12, totalRevenue: 115e9, netIncome: 70e9, epsDiluted: 2.86 },
    incomeChange: { revenueChange: 78.4, netIncomeChange: 109.0 },
    filings: [{ form: "10-K", filingDate: "2025-02-26" }, { form: "10-Q", filingDate: "2024-11-20" }],
    newsSentiment: {
      aggregate: { label: "positive", count: 3 },
      articles: [
        { title: "Nvidia Blackwell GPU demand outpaces supply as hyperscalers ramp AI buildout", sentiment: "positive" },
        { title: "NVDA raises full-year revenue guidance on accelerating data-center orders", sentiment: "positive" },
        { title: "Supply chain constraints remain headwind for GB200 ramp pace", sentiment: "negative" },
      ],
    },
  },
  MSFT: {
    financialHighlights: { marketCap: 3.1e12, totalRevenue: 261e9, netIncome: 88e9, epsDiluted: 11.80 },
    incomeChange: { revenueChange: 12.3, netIncomeChange: 10.5 },
    filings: [{ form: "10-K", filingDate: "2024-07-30" }, { form: "10-Q", filingDate: "2025-01-29" }],
    newsSentiment: {
      aggregate: { label: "positive", count: 3 },
      articles: [
        { title: "Microsoft Azure revenue accelerates as enterprise AI adoption expands", sentiment: "positive" },
        { title: "Copilot seat count surpasses 400M users across Microsoft 365", sentiment: "positive" },
        { title: "Microsoft faces EU antitrust scrutiny over Teams bundling practices", sentiment: "negative" },
      ],
    },
  },
  GOOGL: {
    financialHighlights: { marketCap: 2.3e12, totalRevenue: 350e9, netIncome: 100e9, epsDiluted: 7.95 },
    incomeChange: { revenueChange: 14.8, netIncomeChange: 28.4 },
    filings: [{ form: "10-K", filingDate: "2025-01-31" }, { form: "10-Q", filingDate: "2024-10-29" }],
    newsSentiment: {
      aggregate: { label: "positive", count: 3 },
      articles: [
        { title: "Alphabet beats Q4 estimates as Google Cloud accelerates to $12B quarterly revenue", sentiment: "positive" },
        { title: "Gemini Ultra adoption gaining traction in enterprise accounts", sentiment: "positive" },
        { title: "DOJ antitrust remedies could structurally reshape Google's search business", sentiment: "negative" },
      ],
    },
  },
  META: {
    financialHighlights: { marketCap: 1.5e12, totalRevenue: 165e9, netIncome: 62e9, epsDiluted: 23.90 },
    incomeChange: { revenueChange: 22.1, netIncomeChange: 59.0 },
    filings: [{ form: "10-K", filingDate: "2025-01-31" }, { form: "10-Q", filingDate: "2024-10-30" }],
    newsSentiment: {
      aggregate: { label: "positive", count: 3 },
      articles: [
        { title: "Meta ad revenue surges 22% as Advantage+ AI targeting drives ROAS improvement", sentiment: "positive" },
        { title: "LLaMA 4 release draws enterprise developer interest; open-source strategy validated", sentiment: "positive" },
        { title: "Reality Labs losses widen to $5B as VR hardware adoption remains slow", sentiment: "negative" },
      ],
    },
  },
  AMZN: {
    financialHighlights: { marketCap: 2.3e12, totalRevenue: 638e9, netIncome: 60e9, epsDiluted: 5.53 },
    incomeChange: { revenueChange: 11.0, netIncomeChange: 94.0 },
    filings: [{ form: "10-K", filingDate: "2025-02-06" }, { form: "10-Q", filingDate: "2024-10-31" }],
    newsSentiment: {
      aggregate: { label: "positive", count: 3 },
      articles: [
        { title: "AWS Bedrock adds 50 new foundation models; enterprise AI consumption up 3x YoY", sentiment: "positive" },
        { title: "Amazon operating margin expands to record 11% as logistics efficiency improves", sentiment: "positive" },
        { title: "FTC scrutiny on Amazon marketplace pricing practices resurfaces", sentiment: "negative" },
      ],
    },
  },
  AMD: {
    financialHighlights: { marketCap: 280e9, totalRevenue: 34e9, netIncome: 4e9, epsDiluted: 2.45 },
    incomeChange: { revenueChange: 13.8, netIncomeChange: 75.0 },
    filings: [{ form: "10-K", filingDate: "2025-02-04" }, { form: "10-Q", filingDate: "2024-10-29" }],
    newsSentiment: {
      aggregate: { label: "positive", count: 3 },
      articles: [
        { title: "AMD MI300X GPU wins additional hyperscaler allocations for AI inference workloads", sentiment: "positive" },
        { title: "EPYC server CPU gains market share in cloud and HPC segments", sentiment: "positive" },
        { title: "AMD guides Q1 data-center revenue below consensus estimates", sentiment: "negative" },
      ],
    },
  },
  AVGO: {
    financialHighlights: { marketCap: 850e9, totalRevenue: 51e9, netIncome: 15e9, epsDiluted: 30.35 },
    incomeChange: { revenueChange: 47.2, netIncomeChange: 64.0 },
    filings: [{ form: "10-K", filingDate: "2024-12-12" }, { form: "10-Q", filingDate: "2025-03-06" }],
    newsSentiment: {
      aggregate: { label: "positive", count: 2 },
      articles: [
        { title: "Broadcom custom AI chip revenue from hyperscalers seen doubling in FY2025", sentiment: "positive" },
        { title: "VMware integration ahead of schedule; cross-sell synergies materializing faster than expected", sentiment: "positive" },
      ],
    },
  },
  AMAT: {
    financialHighlights: { marketCap: 160e9, totalRevenue: 27e9, netIncome: 7e9, epsDiluted: 8.15 },
    incomeChange: { revenueChange: 7.2, netIncomeChange: 9.5 },
    filings: [{ form: "10-K", filingDate: "2024-12-12" }, { form: "10-Q", filingDate: "2025-03-04" }],
    newsSentiment: {
      aggregate: { label: "neutral", count: 2 },
      articles: [
        { title: "Applied Materials wins new packaging tool orders tied to advanced AI chip production", sentiment: "positive" },
        { title: "Export controls limit AMAT tool shipments to certain Chinese fabs", sentiment: "negative" },
      ],
    },
  },
  LRCX: {
    financialHighlights: { marketCap: 95e9, totalRevenue: 16e9, netIncome: 5e9, epsDiluted: 38.50 },
    incomeChange: { revenueChange: -3.5, netIncomeChange: -5.0 },
    filings: [{ form: "10-K", filingDate: "2024-08-14" }, { form: "10-Q", filingDate: "2025-01-29" }],
    newsSentiment: {
      aggregate: { label: "neutral", count: 2 },
      articles: [
        { title: "Lam Research sees HBM etch demand recovering as memory capex cycle turns", sentiment: "positive" },
        { title: "NAND capex remains subdued; Lam revenue mix skews toward logic equipment", sentiment: "negative" },
      ],
    },
  },
  CRWD: {
    financialHighlights: { marketCap: 85e9, totalRevenue: 3.8e9, netIncome: 200e6, epsDiluted: 0.57 },
    incomeChange: { revenueChange: 33.0, netIncomeChange: 720.0 },
    filings: [{ form: "10-K", filingDate: "2024-03-06" }, { form: "10-Q", filingDate: "2024-12-03" }],
    newsSentiment: {
      aggregate: { label: "positive", count: 3 },
      articles: [
        { title: "CrowdStrike net retention above 120% confirms platform consolidation thesis", sentiment: "positive" },
        { title: "Falcon platform expands identity and cloud security modules in enterprise upsell", sentiment: "positive" },
        { title: "Outage fallout: some enterprise customers renegotiate contracts post-incident", sentiment: "negative" },
      ],
    },
  },
  PANW: {
    financialHighlights: { marketCap: 120e9, totalRevenue: 7e9, netIncome: 2.6e9, epsDiluted: 4.15 },
    incomeChange: { revenueChange: 15.8, netIncomeChange: 106.0 },
    filings: [{ form: "10-K", filingDate: "2024-09-19" }, { form: "10-Q", filingDate: "2024-12-11" }],
    newsSentiment: {
      aggregate: { label: "positive", count: 2 },
      articles: [
        { title: "Palo Alto Networks platformization drives XSIAM billings above expectations", sentiment: "positive" },
        { title: "Billing mix shift to multi-year deals creates near-term ARR headwind", sentiment: "negative" },
      ],
    },
  },
  ZS: {
    financialHighlights: { marketCap: 32e9, totalRevenue: 2.2e9, netIncome: -500e6, epsDiluted: -1.85 },
    incomeChange: { revenueChange: 23.4, netIncomeChange: null },
    filings: [{ form: "10-K", filingDate: "2024-09-12" }, { form: "10-Q", filingDate: "2025-03-04" }],
    newsSentiment: {
      aggregate: { label: "positive", count: 2 },
      articles: [
        { title: "Zscaler RPO growth of 26% signals strong forward revenue visibility", sentiment: "positive" },
        { title: "Large-deal cycle extends sales timelines; Q2 revenue below mid-point guidance", sentiment: "negative" },
      ],
    },
  },
  FTNT: {
    financialHighlights: { marketCap: 55e9, totalRevenue: 5.5e9, netIncome: 1.4e9, epsDiluted: 1.98 },
    incomeChange: { revenueChange: 9.5, netIncomeChange: 18.0 },
    filings: [{ form: "10-K", filingDate: "2025-02-18" }, { form: "10-Q", filingDate: "2024-11-07" }],
    newsSentiment: {
      aggregate: { label: "neutral", count: 2 },
      articles: [
        { title: "Fortinet firewall refresh cycle gains momentum in mid-market segment", sentiment: "positive" },
        { title: "SD-WAN growth decelerates as customers pause for next-gen platform evaluation", sentiment: "negative" },
      ],
    },
  },
  S: {
    financialHighlights: { marketCap: 19e9, totalRevenue: 800e6, netIncome: -700e6, epsDiluted: -2.45 },
    incomeChange: { revenueChange: 31.5, netIncomeChange: null },
    filings: [{ form: "10-K", filingDate: "2024-03-28" }, { form: "10-Q", filingDate: "2024-12-05" }],
    newsSentiment: {
      aggregate: { label: "positive", count: 2 },
      articles: [
        { title: "SentinelOne wins 30% of competitive CrowdStrike displacements post-outage", sentiment: "positive" },
        { title: "Path to profitability remains multi-year; cash burn rate a key watch item", sentiment: "negative" },
      ],
    },
  },
  JNJ: {
    financialHighlights: { marketCap: 385e9, totalRevenue: 88e9, netIncome: 14e9, epsDiluted: 5.28 },
    incomeChange: { revenueChange: 2.3, netIncomeChange: -8.5 },
    filings: [{ form: "10-K", filingDate: "2025-02-18" }, { form: "10-Q", filingDate: "2024-10-15" }],
    newsSentiment: {
      aggregate: { label: "neutral", count: 2 },
      articles: [
        { title: "J&J MedTech segment growth accelerates as surgical procedure volumes recover", sentiment: "positive" },
        { title: "Talc liability reserve remains a recurring investor concern despite ongoing settlements", sentiment: "negative" },
      ],
    },
  },
  UNH: {
    financialHighlights: { marketCap: 520e9, totalRevenue: 370e9, netIncome: 16e9, epsDiluted: 16.80 },
    incomeChange: { revenueChange: 8.9, netIncomeChange: 2.5 },
    filings: [{ form: "10-K", filingDate: "2025-02-20" }, { form: "10-Q", filingDate: "2024-10-15" }],
    newsSentiment: {
      aggregate: { label: "negative", count: 3 },
      articles: [
        { title: "UnitedHealth medical cost ratio rises to 87.3%; margin pressure intensifies", sentiment: "negative" },
        { title: "Optum Health clinic network expansion continues despite reimbursement headwinds", sentiment: "neutral" },
        { title: "Congressional scrutiny on PBM pricing practices adds regulatory overhang", sentiment: "negative" },
      ],
    },
  },
  LLY: {
    financialHighlights: { marketCap: 730e9, totalRevenue: 50e9, netIncome: 11e9, epsDiluted: 12.10 },
    incomeChange: { revenueChange: 45.0, netIncomeChange: 90.0 },
    filings: [{ form: "10-K", filingDate: "2025-02-18" }, { form: "10-Q", filingDate: "2024-11-06" }],
    newsSentiment: {
      aggregate: { label: "positive", count: 3 },
      articles: [
        { title: "Mounjaro and Zepbound prescriptions surge 40% QoQ as manufacturing ramp continues", sentiment: "positive" },
        { title: "Lilly Phase 3 orforglipron data strengthens oral GLP-1 competitive position", sentiment: "positive" },
        { title: "GLP-1 pricing pressure from PBM negotiations remains a multi-year overhang", sentiment: "negative" },
      ],
    },
  },
  ABT: {
    financialHighlights: { marketCap: 200e9, totalRevenue: 22e9, netIncome: 5e9, epsDiluted: 2.76 },
    incomeChange: { revenueChange: 4.0, netIncomeChange: 7.0 },
    filings: [{ form: "10-K", filingDate: "2025-02-21" }, { form: "10-Q", filingDate: "2024-10-16" }],
    newsSentiment: {
      aggregate: { label: "positive", count: 2 },
      articles: [
        { title: "FreeStyle Libre CGM sensor shipments reach record quarterly volume globally", sentiment: "positive" },
        { title: "Structural heart device pipeline adds optionality beyond core glucose monitoring", sentiment: "positive" },
      ],
    },
  },
  PFE: {
    financialHighlights: { marketCap: 130e9, totalRevenue: 63e9, netIncome: -2.2e9, epsDiluted: -0.37 },
    incomeChange: { revenueChange: -41.0, netIncomeChange: null },
    filings: [{ form: "10-K", filingDate: "2025-02-25" }, { form: "10-Q", filingDate: "2024-10-29" }],
    newsSentiment: {
      aggregate: { label: "negative", count: 3 },
      articles: [
        { title: "Pfizer oncology pipeline shows early promise; Padcev sales ahead of expectations", sentiment: "positive" },
        { title: "COVID revenue decline steeper than modeled; $1.5B cost-reduction plan accelerated", sentiment: "negative" },
        { title: "Seagen integration on track but revenue synergies slower to materialize", sentiment: "negative" },
      ],
    },
  },
  ASML: {
    financialHighlights: { marketCap: 320e9, totalRevenue: 28e9, netIncome: 8.5e9, epsDiluted: 21.40 },
    incomeChange: { revenueChange: 15.0, netIncomeChange: 12.0 },
    filings: [{ form: "20-F", filingDate: "2025-02-12" }, { form: "6-K", filingDate: "2025-01-29" }],
    newsSentiment: {
      aggregate: { label: "positive", count: 2 },
      articles: [
        { title: "ASML High-NA EUV deliveries begin; Intel and TSMC confirmed first customers", sentiment: "positive" },
        { title: "China export control expansion limits ASML DUV tool shipments to leading fabs", sentiment: "negative" },
      ],
    },
  },
  KLAC: {
    financialHighlights: { marketCap: 80e9, totalRevenue: 10.5e9, netIncome: 3.2e9, epsDiluted: 23.75 },
    incomeChange: { revenueChange: 12.5, netIncomeChange: 15.0 },
    filings: [{ form: "10-K", filingDate: "2024-08-07" }, { form: "10-Q", filingDate: "2025-01-30" }],
    newsSentiment: {
      aggregate: { label: "positive", count: 2 },
      articles: [
        { title: "KLA process control tools see strong demand for advanced packaging and HBM inspection", sentiment: "positive" },
        { title: "KLA reaffirms FY2025 guidance; services revenue mix reaches 35%", sentiment: "positive" },
      ],
    },
  },
  TSM: {
    financialHighlights: { marketCap: 900e9, totalRevenue: 90e9, netIncome: 35e9, epsDiluted: 6.50 },
    incomeChange: { revenueChange: 29.0, netIncomeChange: 54.0 },
    filings: [{ form: "20-F", filingDate: "2025-04-03" }, { form: "6-K", filingDate: "2025-01-16" }],
    newsSentiment: {
      aggregate: { label: "positive", count: 3 },
      articles: [
        { title: "TSMC N3 wafer demand fully booked through 2025; N2 yield tracking ahead of schedule", sentiment: "positive" },
        { title: "Arizona fab ramp on track; TSMC targets first N2 output in 2026", sentiment: "positive" },
        { title: "Geopolitical risk premium remains elevated; Taiwan Strait tensions closely watched", sentiment: "negative" },
      ],
    },
  },
  NEE: {
    financialHighlights: { marketCap: 135e9, totalRevenue: 24e9, netIncome: 7e9, epsDiluted: 1.62 },
    incomeChange: { revenueChange: 5.0, netIncomeChange: 8.0 },
    filings: [{ form: "10-K", filingDate: "2025-02-14" }, { form: "10-Q", filingDate: "2024-10-22" }],
    newsSentiment: {
      aggregate: { label: "positive", count: 2 },
      articles: [
        { title: "NextEra Energy wins 3GW of new renewable PPAs; backlog grows to record $100B", sentiment: "positive" },
        { title: "Rate environment headwind persists; FPL rate case timeline a key near-term event", sentiment: "negative" },
      ],
    },
  },
  ENPH: {
    financialHighlights: { marketCap: 8e9, totalRevenue: 2.3e9, netIncome: 350e6, epsDiluted: 2.55 },
    incomeChange: { revenueChange: -52.0, netIncomeChange: -78.0 },
    filings: [{ form: "10-K", filingDate: "2025-02-06" }, { form: "10-Q", filingDate: "2024-10-22" }],
    newsSentiment: {
      aggregate: { label: "negative", count: 3 },
      articles: [
        { title: "Enphase guides Q1 revenue below consensus as installer inventory remains elevated", sentiment: "negative" },
        { title: "IQ9 microinverter launch delays product refresh cycle into mid-year", sentiment: "negative" },
        { title: "International revenue recovery in Europe partly offsets weak U.S. demand", sentiment: "neutral" },
      ],
    },
  },
  FSLR: {
    financialHighlights: { marketCap: 20e9, totalRevenue: 4.2e9, netIncome: 1.6e9, epsDiluted: 15.17 },
    incomeChange: { revenueChange: 23.0, netIncomeChange: 45.0 },
    filings: [{ form: "10-K", filingDate: "2025-02-25" }, { form: "10-Q", filingDate: "2024-10-29" }],
    newsSentiment: {
      aggregate: { label: "positive", count: 2 },
      articles: [
        { title: "First Solar Series 7 thin-film module efficiency exceeds 22%; order book extends to 2027", sentiment: "positive" },
        { title: "IRA domestic content adders add $200M annually to First Solar project economics", sentiment: "positive" },
      ],
    },
  },
  BEP: {
    financialHighlights: { marketCap: 12e9, totalRevenue: 5.8e9, netIncome: -400e6, epsDiluted: -1.20 },
    incomeChange: { revenueChange: 7.5, netIncomeChange: null },
    filings: [{ form: "20-F", filingDate: "2025-03-14" }, { form: "6-K", filingDate: "2025-02-06" }],
    newsSentiment: {
      aggregate: { label: "neutral", count: 2 },
      articles: [
        { title: "Brookfield Renewable adds 7GW development pipeline through strategic joint ventures", sentiment: "positive" },
        { title: "Higher interest rates compress distribution coverage ratios for renewable yield-cos", sentiment: "negative" },
      ],
    },
  },
  RUN: {
    financialHighlights: { marketCap: 2.5e9, totalRevenue: 2.2e9, netIncome: -800e6, epsDiluted: -3.85 },
    incomeChange: { revenueChange: 14.0, netIncomeChange: null },
    filings: [{ form: "10-K", filingDate: "2025-02-20" }, { form: "10-Q", filingDate: "2024-11-07" }],
    newsSentiment: {
      aggregate: { label: "neutral", count: 2 },
      articles: [
        { title: "Sunrun battery attachment rate reaches 50%; grid services revenue gaining traction", sentiment: "positive" },
        { title: "NEM 3.0 policy headwind in California weighs on Sunrun new customer economics", sentiment: "negative" },
      ],
    },
  },
  AAPL: {
    financialHighlights: { marketCap: 3.7e12, totalRevenue: 395e9, netIncome: 97e9, epsDiluted: 6.42 },
    incomeChange: { revenueChange: 6.0, netIncomeChange: 7.5 },
    filings: [{ form: "10-K", filingDate: "2024-11-01" }, { form: "10-Q", filingDate: "2025-02-07" }],
    newsSentiment: {
      aggregate: { label: "positive", count: 3 },
      articles: [
        { title: "Apple Intelligence features drive upgrade cycle in iPhone 16; services revenue hits record", sentiment: "positive" },
        { title: "Greater China revenue declines 11% as Huawei competition intensifies in premium segment", sentiment: "negative" },
        { title: "App Store gross margins expand to 80%+ as developer fee collections grow", sentiment: "positive" },
      ],
    },
  },
  V: {
    financialHighlights: { marketCap: 610e9, totalRevenue: 36e9, netIncome: 19e9, epsDiluted: 9.52 },
    incomeChange: { revenueChange: 12.0, netIncomeChange: 15.0 },
    filings: [{ form: "10-K", filingDate: "2024-11-22" }, { form: "10-Q", filingDate: "2025-01-30" }],
    newsSentiment: {
      aggregate: { label: "positive", count: 2 },
      articles: [
        { title: "Visa cross-border volume growth of 16% exceeds expectations as travel spend remains elevated", sentiment: "positive" },
        { title: "Debit routing regulation risk remains a structural concern for Visa U.S. economics", sentiment: "negative" },
      ],
    },
  },
  MA: {
    financialHighlights: { marketCap: 480e9, totalRevenue: 28e9, netIncome: 13e9, epsDiluted: 14.07 },
    incomeChange: { revenueChange: 13.5, netIncomeChange: 18.0 },
    filings: [{ form: "10-K", filingDate: "2025-02-14" }, { form: "10-Q", filingDate: "2025-01-30" }],
    newsSentiment: {
      aggregate: { label: "positive", count: 2 },
      articles: [
        { title: "Mastercard value-added services revenue grows 19% as digital payment penetration deepens", sentiment: "positive" },
        { title: "EM exposure provides volume upside but currency headwinds pressure reported net revenue", sentiment: "negative" },
      ],
    },
  },
  "BRK-B": {
    financialHighlights: { marketCap: 970e9, totalRevenue: 365e9, netIncome: 96e9, epsDiluted: 16.67 },
    incomeChange: { revenueChange: 5.0, netIncomeChange: 13.0 },
    filings: [{ form: "10-K", filingDate: "2025-02-22" }, { form: "10-Q", filingDate: "2024-11-04" }],
    newsSentiment: {
      aggregate: { label: "positive", count: 2 },
      articles: [
        { title: "Berkshire cash hoard reaches $320B; Buffett signals patience for large acquisition opportunities", sentiment: "positive" },
        { title: "Operating earnings hit record $14B in Q3; insurance float grows to $170B", sentiment: "positive" },
      ],
    },
  },
};

function enrichTicker(base: { symbol: string; rationale: string; sentiment?: "positive" | "negative" | "neutral" }): DemoTickerExplanation {
  return { ...base, ...(DEMO_TICKER_FINANCIALS[base.symbol] ?? {}) };
}

const SEED_LIBRARY: Record<string, LandingDemoSynthesis> = {
  "ai stocks": {
    prompt: "AI stocks",
    watchlistName: "AI stocks — Moderate Risk",
    summary:
      "U.S. large-cap AI leaders are consolidating gains as cloud demand, GPU supply chains, and enterprise adoption remain the dominant drivers. Price action reflects a balance between strong revenue visibility and higher sensitivity to rate expectations and earnings revisions.",
    insights: [
      "Market theme: Infrastructure-led AI adoption with hyperscaler pricing power",
      "Risk profile: Elevated beta, momentum-sensitive with concentrated mega-cap exposure",
      "Semis remain the primary throughput bottleneck, keeping valuation dispersion high.",
      "Cloud capex guidance is the key near-term catalyst across the basket.",
      "Options positioning implies tighter downside hedging into the next earnings window.",
    ],
    keyStats: {
      sp500_change: 0.62,
      nasdaq_change: 1.08,
      dow_change: 0.21,
      vix: 17.4,
    },
    savedAt: FALLBACK_TIMESTAMP,
    source: "seed",
    reasoning: "Step 1 - Thesis: The basket captures the AI infrastructure buildout theme across hardware, cloud, and software layers with direct revenue exposure.\nStep 2 - Evidence: NVDA is highest-risk (risk 67, vol 38%, Sharpe 0.79); MSFT is the lowest-risk anchor (risk 42, Sharpe 1.84, diversified cloud revenue).\nStep 3 - Risk checks: Regime mid_vol; basket concentrated in correlated mega-cap tech names with 38% 30-day loss probability.\nStep 4 - Trigger: Re-evaluate if cloud capex guidance is cut 15%+ or NVDA Blackwell shipment guidance misses.",
    model: "openai/gpt-oss-120b",
    tickers: [
      { symbol: "NVDA", name: "NVIDIA Corp" },
      { symbol: "MSFT", name: "Microsoft Corp" },
      { symbol: "GOOGL", name: "Alphabet Inc" },
      { symbol: "META", name: "Meta Platforms" },
      { symbol: "AMZN", name: "Amazon.com" },
    ],
    tickerExplanations: [
      enrichTicker({ symbol: "NVDA", rationale: "Dominant GPU platform with >80% AI training market share; forward revenue tied directly to hyperscaler capex cycles and Blackwell architecture ramp.", sentiment: "positive" }),
      enrichTicker({ symbol: "MSFT", rationale: "Azure AI services and Copilot integration drive sustained cloud revenue growth; OpenAI partnership reinforces platform stickiness with high switching costs.", sentiment: "positive" }),
      enrichTicker({ symbol: "GOOGL", rationale: "Gemini model family and TPU infrastructure underpin AI monetization across Search and Cloud; advertising base provides durable cash-flow buffer.", sentiment: "positive" }),
      enrichTicker({ symbol: "META", rationale: "Open-source LLaMA strategy reduces inference costs while Reels and ad-targeting improvements drive ARPU expansion across a 3B+ user base.", sentiment: "positive" }),
      enrichTicker({ symbol: "AMZN", rationale: "AWS Bedrock and Trainium accelerator buildout position Amazon as a multi-model cloud host; logistics network synergies support margin recovery.", sentiment: "positive" }),
    ],
  },
  "ai hardware leaders": {
    prompt: "AI hardware leaders",
    watchlistName: "AI hardware leaders — High Risk",
    summary:
      "AI hardware leaders are reacting to tight accelerator supply, expanding data center buildouts, and shifting chip mix toward high-bandwidth memory and advanced packaging. Upside remains tied to forward order visibility, while near-term volatility tracks guidance, geopolitics, and inventory cycles.",
    insights: [
      "Market theme: Compute stack expansion driven by GPU demand, foundry capacity, and networking throughput",
      "Risk profile: Cyclical and capex-sensitive with concentration risk in a small set of platform suppliers",
      "Foundry and packaging capacity is still the binding constraint for incremental GPU throughput.",
      "Networking and power delivery are emerging as second-order bottlenecks in new builds.",
      "Watch for margin sensitivity to mix shifts, expedited logistics, and wafer pricing resets.",
    ],
    keyStats: {
      sp500_change: 0.44,
      nasdaq_change: 0.91,
      dow_change: 0.12,
      vix: 18.1,
    },
    savedAt: FALLBACK_TIMESTAMP,
    source: "seed",
    reasoning: "Step 1 - Thesis: Hardware pure-plays are the highest-leverage expression of AI compute demand with direct capex cycle sensitivity.\nStep 2 - Evidence: NVDA and AMD carry the highest risk scores (67, 62); AMAT and LRCX are more defensive on service revenue mix.\nStep 3 - Risk checks: Regime mid_vol; foundry capacity and export controls are the primary structural risk factors for the basket.\nStep 4 - Trigger: Re-evaluate if TSMC CoWoS capacity guides flat or new China export controls expand scope.",
    model: "openai/gpt-oss-120b",
    tickers: [
      { symbol: "NVDA", name: "NVIDIA Corp" },
      { symbol: "AMD", name: "Advanced Micro Devices" },
      { symbol: "AVGO", name: "Broadcom Inc" },
      { symbol: "AMAT", name: "Applied Materials" },
      { symbol: "LRCX", name: "Lam Research" },
    ],
    tickerExplanations: [
      enrichTicker({ symbol: "NVDA", rationale: "H200 and Blackwell architecture lead the GPU stack; order backlog visibility stretches well into the next year, with TSMC CoWoS packaging as the key supply constraint.", sentiment: "positive" }),
      enrichTicker({ symbol: "AMD", rationale: "MI300X gaining datacenter traction as a secondary compute option; CPU share gains in cloud and enterprise add a separate, less-cyclical earnings driver.", sentiment: "positive" }),
      enrichTicker({ symbol: "AVGO", rationale: "Custom ASIC opportunity with hyperscaler XPUs and networking switches creates durable revenue diversification beyond the core semiconductor cycle.", sentiment: "positive" }),
      enrichTicker({ symbol: "AMAT", rationale: "Applied Materials dominates deposition and etch steps for advanced packaging; high-margin service mix softens cycle volatility across memory and logic nodes.", sentiment: "positive" }),
      enrichTicker({ symbol: "LRCX", rationale: "Lam Research's etch tools are critical for HBM stacking; leading-edge intensity and memory capex recovery support pricing power through the next upcycle.", sentiment: "neutral" }),
    ],
  },
  "cybersecurity leaders": {
    prompt: "Cybersecurity leaders",
    watchlistName: "Cybersecurity leaders — Moderate Risk",
    summary:
      "Cybersecurity leaders remain supported by durable breach-driven spending, but buyers are consolidating vendors and stretching procurement cycles. Narrative momentum is strong for platform suites, while single-product names face tougher upsell math. Earnings revisions and billings trends drive the tape.",
    insights: [
      "Market theme: Budget-constrained enterprise demand with persistent breach risk and platform consolidation",
      "Risk profile: Moderate beta with event-driven spikes tied to incidents, renewals, and guidance",
      "Platform consolidation favors vendors that can bundle endpoint, identity, and cloud security.",
      "Contract duration and renewal cadence matter more than headline ARR growth in this regime.",
      "Incident headlines can create short-lived dislocations; confirmation comes from net retention.",
    ],
    keyStats: {
      sp500_change: 0.28,
      nasdaq_change: 0.55,
      dow_change: 0.09,
      vix: 16.9,
    },
    savedAt: FALLBACK_TIMESTAMP,
    source: "seed",
    reasoning: "Step 1 - Thesis: Platform cybersecurity vendors benefit from enterprise consolidation mandates and durable breach-driven spending regardless of macro.\nStep 2 - Evidence: CRWD is highest-risk (risk 58, revChg +33%); FTNT is the defensive anchor (risk 35, positive FCF, mid-market stability).\nStep 3 - Risk checks: Regime low_vol; primary risks are renewal compression and competitive displacement following outage events.\nStep 4 - Trigger: Re-evaluate if net retention rates fall below 115% or large-deal billings miss two consecutive quarters.",
    model: "openai/gpt-oss-120b",
    tickers: [
      { symbol: "CRWD", name: "CrowdStrike Holdings" },
      { symbol: "PANW", name: "Palo Alto Networks" },
      { symbol: "ZS", name: "Zscaler Inc" },
      { symbol: "FTNT", name: "Fortinet Inc" },
      { symbol: "S", name: "SentinelOne Inc" },
    ],
    tickerExplanations: [
      enrichTicker({ symbol: "CRWD", rationale: "Falcon platform covers endpoint, cloud, and identity in a single agent; net retention above 120% confirms the platform consolidation thesis is playing out.", sentiment: "positive" }),
      enrichTicker({ symbol: "PANW", rationale: "Platformization strategy drives cross-sell into SASE and XSIAM; billings durability across large enterprise accounts is the key watch item for the thesis.", sentiment: "positive" }),
      enrichTicker({ symbol: "ZS", rationale: "Zero-trust cloud proxy architecture wins in distributed workforce environments; RPO growth and large-deal momentum signal durable forward revenue visibility.", sentiment: "positive" }),
      enrichTicker({ symbol: "FTNT", rationale: "Unified ASIC-based security hardware plus cloud overlay maintains margin leadership in mid-market; firewall refresh cycle could accelerate into 2025.", sentiment: "neutral" }),
      enrichTicker({ symbol: "S", rationale: "SentinelOne's AI-native architecture attracts cloud-native buyers; billings acceleration and improving unit economics confirm competitive position is strengthening.", sentiment: "positive" }),
    ],
  },
  "defensive healthcare": {
    prompt: "Defensive healthcare",
    watchlistName: "Defensive healthcare — Lower Risk",
    summary:
      "Defensive healthcare screens as a stability basket when growth and rates are volatile. Managed care and large pharma benefit from steady demand, but forward returns depend on reimbursement discipline, regulatory headlines, and pipeline execution. Dispersion is driven by patent timelines and M&A.",
    insights: [
      "Market theme: Resilient demand and pricing power balanced against policy and pipeline risk",
      "Risk profile: Lower beta with idiosyncratic risk from regulation, reimbursement, and patent cliffs",
      "Policy and reimbursement changes can dominate fundamentals around election windows.",
      "Patent cliffs amplify the value of pipeline visibility and well-timed bolt-on acquisitions.",
      "Watch medical cost ratio and utilization trends as early signals for managed care names.",
    ],
    keyStats: {
      sp500_change: 0.18,
      nasdaq_change: 0.22,
      dow_change: 0.15,
      vix: 15.8,
    },
    savedAt: FALLBACK_TIMESTAMP,
    source: "seed",
    reasoning: "Step 1 - Thesis: Defensive healthcare provides lower-beta exposure with durable earnings from managed care and blockbuster pharma franchises.\nStep 2 - Evidence: LLY is highest-risk (risk 48, vol 28%, GLP-1 growth optionality); PFE is the recovery play with highest execution risk post-COVID reset.\nStep 3 - Risk checks: Regime low_vol; reimbursement compression and patent cliff timing are the structural risks for this basket.\nStep 4 - Trigger: Re-evaluate if CMS proposes GLP-1 reimbursement cuts exceeding 15% or medical cost ratios breach 90% for managed care names.",
    model: "openai/gpt-oss-120b",
    tickers: [
      { symbol: "JNJ", name: "Johnson & Johnson" },
      { symbol: "UNH", name: "UnitedHealth Group" },
      { symbol: "LLY", name: "Eli Lilly & Co" },
      { symbol: "ABT", name: "Abbott Laboratories" },
      { symbol: "PFE", name: "Pfizer Inc" },
    ],
    tickerExplanations: [
      enrichTicker({ symbol: "JNJ", rationale: "Diversified MedTech and pharma with strong pipeline coverage post-consumer split; dividend durability and balance-sheet strength make it a core defensive anchor.", sentiment: "neutral" }),
      enrichTicker({ symbol: "UNH", rationale: "Optum Health platform drives margin and revenue synergies across care delivery; managed care penetration and vertical integration support long-run growth visibility.", sentiment: "positive" }),
      enrichTicker({ symbol: "LLY", rationale: "GLP-1 franchise (Mounjaro, Zepbound) dominates the obesity and diabetes opportunity; multi-year manufacturing ramp and pricing power give the thesis unusual duration.", sentiment: "positive" }),
      enrichTicker({ symbol: "ABT", rationale: "Medical devices and diagnostics provide lower-volatility earnings; FreeStyle Libre continuous-glucose platform anchors durable recurring revenue.", sentiment: "positive" }),
      enrichTicker({ symbol: "PFE", rationale: "Post-COVID revenue reset is underway; oncology and rare-disease pipeline assets are the primary variable determining when and how far the multiple re-rates.", sentiment: "neutral" }),
    ],
  },
  "semiconductor supply chain": {
    prompt: "Semiconductor supply chain",
    watchlistName: "Semiconductor supply chain — Moderate Risk",
    summary:
      "The semiconductor supply chain is being pulled by advanced-node investment and AI-driven capacity adds, while legacy demand remains mixed. Equipment and foundry names trade on capex guidance, order backlog quality, and export-control uncertainty. The regime favors operators with strong service mix.",
    insights: [
      "Market theme: Equipment-led cycle with advanced node intensity and uneven end-market demand",
      "Risk profile: High sensitivity to capex revisions, export controls, and lead-time normalization",
      "Backlog composition matters: logic and advanced packaging strength can mask weakness elsewhere.",
      "Lead-time normalization is a margin swing factor for tool vendors and component suppliers.",
      "Export controls and regional subsidy programs can shift demand between nodes and geographies.",
    ],
    keyStats: {
      sp500_change: 0.36,
      nasdaq_change: 0.74,
      dow_change: 0.11,
      vix: 17.2,
    },
    savedAt: FALLBACK_TIMESTAMP,
    source: "seed",
    reasoning: "Step 1 - Thesis: Semiconductor equipment and foundry names are the infrastructure layer of AI compute with durable capex tailwinds.\nStep 2 - Evidence: ASML is highest-risk (risk 55, EUV monopoly with geopolitical exposure); KLAC is the defensive anchor (risk 32, non-discretionary process control with 35% service mix).\nStep 3 - Risk checks: Regime mid_vol; China export controls and capex revision risk are the primary structural overhangs.\nStep 4 - Trigger: Re-evaluate if leading-edge capex guidance is cut 20%+ or ASML order book misses consensus by more than one quarter.",
    model: "openai/gpt-oss-120b",
    tickers: [
      { symbol: "ASML", name: "ASML Holding" },
      { symbol: "AMAT", name: "Applied Materials" },
      { symbol: "LRCX", name: "Lam Research" },
      { symbol: "KLAC", name: "KLA Corporation" },
      { symbol: "TSM", name: "Taiwan Semiconductor" },
    ],
    tickerExplanations: [
      enrichTicker({ symbol: "ASML", rationale: "EUV monopoly positions ASML as the irreplaceable bottleneck in leading-edge chip production globally; High-NA transition adds a new pricing tier above current EUV.", sentiment: "positive" }),
      enrichTicker({ symbol: "AMAT", rationale: "Breadth across etch, CVD, and CMP gives Applied Materials leverage across memory and logic nodes; subscription-like service revenue cushions the tool cycle.", sentiment: "positive" }),
      enrichTicker({ symbol: "LRCX", rationale: "Memory-weighted revenue makes Lam Research a high-beta play on NAND and DRAM capex recovery; HBM stacking requirements are an emerging incremental demand driver.", sentiment: "neutral" }),
      enrichTicker({ symbol: "KLAC", rationale: "Process control tools are non-discretionary at advanced nodes; KLAC benefits from rising defect density requirements and the near-zero switching cost for customers who standardize.", sentiment: "positive" }),
      enrichTicker({ symbol: "TSM", rationale: "N3 and N2 node ramp defines the pace of AI chip production for NVIDIA, Apple, and others; customer concentration is simultaneously a risk and a structural moat.", sentiment: "positive" }),
    ],
  },
  "energy transition winners": {
    prompt: "Energy transition winners",
    watchlistName: "Energy transition winners — Moderate Risk",
    summary:
      "Energy transition names are balancing long-duration electrification tailwinds with near-term headwinds from rates, permitting timelines, and shifting subsidy guidance. The market is rewarding cash-flow durability and execution, while punitive drawdowns follow inventory risk and demand resets.",
    insights: [
      "Market theme: Electrification buildout with rate sensitivity and policy-linked demand signals",
      "Risk profile: High dispersion with macro sensitivity to rates, subsidy shifts, and commodity inputs",
      "Rates and financing costs are first-order drivers for solar, storage, and utility buildout cadence.",
      "Policy clarity and tax-credit transfer markets affect visibility more than spot demand headlines.",
      "Look for margin stabilization signals in inventory normalization and pricing discipline.",
    ],
    keyStats: {
      sp500_change: 0.21,
      nasdaq_change: 0.31,
      dow_change: 0.14,
      vix: 18.6,
    },
    savedAt: FALLBACK_TIMESTAMP,
    source: "seed",
    reasoning: "Step 1 - Thesis: Energy transition pure-plays and utilities provide long-duration electrification exposure with highly variable risk profiles.\nStep 2 - Evidence: ENPH is highest-risk (risk 72, revChg -52%, inventory reset); NEE is the defensive anchor (risk 28, contracted PPA cash flows).\nStep 3 - Risk checks: Regime mid_vol; rate sensitivity and IRA policy risk are the primary macro overhangs across the basket.\nStep 4 - Trigger: Re-evaluate if 10-year Treasury yields breach 5.5% or IRA domestic content credits face legislative rollback.",
    model: "openai/gpt-oss-120b",
    tickers: [
      { symbol: "NEE", name: "NextEra Energy" },
      { symbol: "ENPH", name: "Enphase Energy" },
      { symbol: "FSLR", name: "First Solar" },
      { symbol: "BEP", name: "Brookfield Renewable" },
      { symbol: "RUN", name: "Sunrun Inc" },
    ],
    tickerExplanations: [
      enrichTicker({ symbol: "NEE", rationale: "Largest U.S. wind and solar operator with a multi-year PPA backlog; rate sensitivity is real but contracted cash flows provide a durable earnings floor.", sentiment: "positive" }),
      enrichTicker({ symbol: "ENPH", rationale: "Microinverter technology leads residential solar; installer loyalty and IQ8 product cycle create stickiness, though demand normalization post-IRA is a near-term watch item.", sentiment: "neutral" }),
      enrichTicker({ symbol: "FSLR", rationale: "Domestic thin-film manufacturing and utility-scale focus benefits directly from IRA incentives; supply chain onshoring reduces geopolitical risk versus peers.", sentiment: "positive" }),
      enrichTicker({ symbol: "BEP", rationale: "Brookfield Renewable's global diversification across hydro, wind, and solar smooths cash flow across regional and weather cycles; development pipeline adds organic upside.", sentiment: "positive" }),
      enrichTicker({ symbol: "RUN", rationale: "Sunrun captures residential solar-plus-storage growth; customer acquisition cost management and grid services monetization are the key metrics for the investment thesis.", sentiment: "neutral" }),
    ],
  },
  "cash-flow compounders": {
    prompt: "Cash-flow compounders",
    watchlistName: "Cash-flow compounders — Lower Risk",
    summary:
      "Cash-flow compounders tend to outperform when investors prioritize balance-sheet strength and durable margins. Returns are driven by steady reinvestment, buybacks, and operating leverage rather than narrative catalysts. Multiple compression risk increases when real yields rise or growth expectations reset.",
    insights: [
      "Market theme: High-quality franchises with durable margins, pricing power, and reinvestment runway",
      "Risk profile: Lower drawdown profile but valuation risk when rates reprice upward",
      "The key filter is free-cash-flow conversion and discipline around incremental ROIC.",
      "Pricing power and subscription-like revenue reduce sensitivity to macro soft patches.",
      "Watch valuation spreads versus the market as the main timing lever for entries.",
    ],
    keyStats: {
      sp500_change: 0.25,
      nasdaq_change: 0.29,
      dow_change: 0.19,
      vix: 15.9,
    },
    savedAt: FALLBACK_TIMESTAMP,
    source: "seed",
    reasoning: "Step 1 - Thesis: Cash-flow compounders deliver durable risk-adjusted returns through buybacks, pricing power, and disciplined reinvestment regardless of the growth cycle.\nStep 2 - Evidence: AAPL is highest-risk (risk 38, China revenue concentration); BRK-B is the defensive anchor (risk 18, diversified earnings and record cash reserves).\nStep 3 - Risk checks: Regime low_vol; valuation compression risk from rising real yields is the primary macro threat to the basket.\nStep 4 - Trigger: Re-evaluate if real 10-year yields breach 2.5% or FCF yield compression across the basket narrows the risk-reward margin below 150bps.",
    model: "openai/gpt-oss-120b",
    tickers: [
      { symbol: "AAPL", name: "Apple Inc" },
      { symbol: "V", name: "Visa Inc" },
      { symbol: "MA", name: "Mastercard Inc" },
      { symbol: "MSFT", name: "Microsoft Corp" },
      { symbol: "BRK-B", name: "Berkshire Hathaway" },
    ],
    tickerExplanations: [
      enrichTicker({ symbol: "AAPL", rationale: "Services segment drives margin expansion and recurring revenue; ~$90B annual buyback program anchors valuation and offsets slower hardware unit growth.", sentiment: "positive" }),
      enrichTicker({ symbol: "V", rationale: "Network effects create near-unassailable payment rails moat; cross-border volume recovery and value-added services layer are the incremental growth levers.", sentiment: "positive" }),
      enrichTicker({ symbol: "MA", rationale: "Mirrors Visa with stronger emerging-market exposure; value-added services layer adds high-margin revenue streams with less cyclicality than core payment volumes.", sentiment: "positive" }),
      enrichTicker({ symbol: "MSFT", rationale: "Cloud and software subscription model provides predictable free-cash-flow; operating leverage across Azure and Office remains one of the most durable in large-cap tech.", sentiment: "positive" }),
      enrichTicker({ symbol: "BRK-B", rationale: "Berkshire compounds through diversified ownership, insurance float utilization, and disciplined capital allocation; concentrated equity positions add periodic rebalancing optionality.", sentiment: "positive" }),
    ],
  },
};

const asObject = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

const sanitizeKeyStats = (value: unknown): DemoKeyStats => {
  const record = asObject(value);
  const toNumber = (entry: unknown) => (typeof entry === "number" && Number.isFinite(entry) ? entry : undefined);
  return {
    sp500_change: toNumber(record.sp500_change),
    nasdaq_change: toNumber(record.nasdaq_change),
    dow_change: toNumber(record.dow_change),
    vix: toNumber(record.vix),
  };
};

const sanitizeDemo = (value: unknown): LandingDemoSynthesis | null => {
  const record = asObject(value);
  const prompt = cleanText(record.prompt);
  const watchlistName = cleanText(record.watchlistName);
  const summary = cleanText(record.summary);
  const savedAt = cleanText(record.savedAt);
  const source = record.source === "homepage" ? "homepage" : record.source === "seed" ? "seed" : null;

  if (!prompt || !watchlistName || !summary || !savedAt || !source) return null;

  const insights = Array.isArray(record.insights)
    ? record.insights
      .map((line) => cleanText(line))
      .filter((line): line is string => Boolean(line))
      .slice(0, 6)
    : [];

  return {
    prompt,
    watchlistName,
    summary,
    insights,
    keyStats: sanitizeKeyStats(record.keyStats),
    savedAt,
    source,
    reasoning: typeof record.reasoning === 'string' ? record.reasoning : undefined,
    model: typeof record.model === 'string' ? record.model : undefined,
    tickers: Array.isArray(record.tickers) ? record.tickers as DemoTicker[] : undefined,
    tickerExplanations: Array.isArray(record.tickerExplanations) ? record.tickerExplanations as DemoTickerExplanation[] : undefined,
  };
};

Object.entries(asObject(landingDemoSeed)).forEach(([key, value]) => {
  const normalized = normalizeLandingDemoPrompt(key);
  if (!knownPromptKeys.has(normalized)) return;
  const sanitized = sanitizeDemo(value);
  if (!sanitized) return;
  SEED_LIBRARY[normalized] = sanitized;
});

const pickInsightLines = (snapshot: LandingDemoSnapshotInput) => {
  const lines: string[] = [];
  const theme = cleanText(snapshot.meta?.intent?.theme);
  const risk = cleanText(snapshot.meta?.intent?.risk_level);
  const regime = cleanText(snapshot.meta?.regime?.current_regime);

  if (theme) lines.push(`Market theme: ${clampChars(theme, 165)}`);
  if (risk && regime) {
    lines.push(`Risk profile: ${risk} | Regime: ${regime}`);
  } else if (risk) {
    lines.push(`Risk profile: ${risk}`);
  } else if (regime) {
    lines.push(`Regime signal: ${regime}`);
  }

  const symbols = (snapshot.tickers ?? [])
    .map((ticker) => cleanText(ticker.symbol).toUpperCase())
    .filter((symbol): symbol is string => Boolean(symbol))
    .slice(0, 5);

  if (symbols.length > 0) {
    lines.push(`Top candidates: ${symbols.join(", ")}`);
  }

  const rationaleLines = (snapshot.tickerExplanations ?? [])
    .map((item) => {
      const symbol = cleanText(item.symbol).toUpperCase();
      const rationale = cleanText(item.rationale);
      if (!symbol || !rationale) return null;
      return `${symbol}: ${clampChars(rationale, 170)}`;
    })
    .filter((line): line is string => Boolean(line));

  lines.push(...rationaleLines.slice(0, 2));

  if (lines.length < 4) {
    const reasoning = cleanText(snapshot.reasoning)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    lines.push(...reasoning.slice(0, 2).map((line) => clampChars(line, 170)));
  }

  const uniqueLines = Array.from(new Set(lines.map((line) => line.trim()).filter(Boolean)));
  return uniqueLines.slice(0, 6);
};

export const getLandingDemoSeedLibrary = () => cloneLibrary(SEED_LIBRARY);

export const loadLandingDemoLibrary = () => {
  const merged = getLandingDemoSeedLibrary();

  if (typeof window === "undefined") return merged;

  let parsed: LandingDemoStoragePayload | null = null;
  try {
    const raw = window.localStorage.getItem(LANDING_DEMO_STORAGE_KEY);
    if (!raw) return merged;
    const payload = JSON.parse(raw) as LandingDemoStoragePayload;
    if (!payload || payload.version !== LANDING_DEMO_STORAGE_VERSION) return merged;
    if (!payload.entries || typeof payload.entries !== "object") return merged;
    parsed = payload;
  } catch {
    return merged;
  }

  Object.entries(parsed.entries).forEach(([key, value]) => {
    const normalized = normalizeLandingDemoPrompt(key);
    if (!knownPromptKeys.has(normalized)) return;
    const sanitized = sanitizeDemo(value);
    if (!sanitized) return;
    merged[normalized] = sanitized;
  });

  return merged;
};

const persistLandingDemoLibrary = (library: Record<string, LandingDemoSynthesis>) => {
  if (typeof window === "undefined") return;

  const entries: Record<string, LandingDemoSynthesis> = {};
  Object.entries(library).forEach(([key, value]) => {
    const normalized = normalizeLandingDemoPrompt(key);
    if (!knownPromptKeys.has(normalized)) return;
    if (value.source !== "homepage") return;
    entries[normalized] = cloneDemo(value);
  });

  if (Object.keys(entries).length === 0) {
    window.localStorage.removeItem(LANDING_DEMO_STORAGE_KEY);
    return;
  }

  const payload: LandingDemoStoragePayload = {
    version: LANDING_DEMO_STORAGE_VERSION,
    entries,
  };
  window.localStorage.setItem(LANDING_DEMO_STORAGE_KEY, JSON.stringify(payload));
};

const buildSummary = (snapshot: LandingDemoSnapshotInput, fallbackSummary: string) => {
  const narrative = cleanText(snapshot.narrative);
  if (narrative) return clampWords(narrative);
  const reasoning = cleanText(snapshot.reasoning);
  if (reasoning) return clampWords(reasoning);
  return fallbackSummary;
};

export const isLandingDemoPrompt = (prompt: string) =>
  knownPromptKeys.has(normalizeLandingDemoPrompt(prompt));

export const saveLandingDemoSynthesis = (prompt: string, snapshot: LandingDemoSnapshotInput) => {
  const normalized = normalizeLandingDemoPrompt(prompt);
  if (!knownPromptKeys.has(normalized)) return;

  const fallback = SEED_LIBRARY[normalized] ?? SEED_LIBRARY[DEFAULT_PROMPT_KEY];
  const summary = buildSummary(snapshot, fallback?.summary ?? "");
  const insights = pickInsightLines(snapshot);

  const synthesized: LandingDemoSynthesis = {
    prompt: promptLabelByKey[normalized] || prompt.trim() || fallback?.prompt || "AI stocks",
    watchlistName:
      cleanText(snapshot.watchlistName) || fallback?.watchlistName || promptLabelByKey[normalized] || "AI stocks",
    summary: summary || fallback?.summary || "Synthesis unavailable.",
    insights: insights.length > 0 ? insights : fallback?.insights ?? [],
    keyStats: fallback?.keyStats ?? DEFAULT_KEY_STATS,
    savedAt: new Date().toISOString(),
    source: "homepage",
  };

  const next = loadLandingDemoLibrary();
  next[normalized] = synthesized;
  persistLandingDemoLibrary(next);
};

export const getLandingDemoForPrompt = (
  prompt: string,
  library: Record<string, LandingDemoSynthesis>
) => {
  const normalized = normalizeLandingDemoPrompt(prompt);
  return (
    library[normalized] ??
    library[DEFAULT_PROMPT_KEY] ??
    Object.values(library)[0] ??
    cloneDemo(SEED_LIBRARY[DEFAULT_PROMPT_KEY])
  );
};
