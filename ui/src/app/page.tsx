"use client";

import { type ReactNode, useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import PromptInput from "@/components/PromptInput";
import CopyButton from "@/components/CopyButton";
import ShareDownloadButtons from "@/components/ShareDownloadButtons";
import { HoverWrapper } from "@/components/StockHoverCard";
import { useCompanyLogos } from "@/hooks/useCompanyLogos";
import { useStockPrices } from "@/hooks/useStockPrices";
import { useStockMetadata } from "@/hooks/useStockMetadata";
import {
  ArrowRight,
  BellRinging,
  Bookmark,
  Brain,
  ChartLineUp,
  CheckCircle2,
  ClockCounterClockwise,
  FlowArrow,
  RotateCw,
  ShieldCheck,
  Sparkles,
  StackSimple,
  Terminal,
  Target,
  XCircle,
  Zap,
} from "@/components/Icons";
import { BrandLogo } from "@/components/BrandLogo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useHomeSynthesisDemo } from "@/hooks/useHomeSynthesisDemo";
import { LANDING_DEMO_PROMPTS, type DemoTicker, type DemoTickerExplanation } from "@/lib/landingDemoCache";
import { annotateFinancialTerms } from "@/lib/financialTerms";

const stateLabels: Record<string, string> = {
  idle: "Idle",
  generating: "Generating",
  streaming: "Streaming",
  completed: "Completed",
};

const HOME_DEMO_PROMPT_SUGGESTIONS = [...LANDING_DEMO_PROMPTS];

function cx(...parts: Array<string | null | undefined | false>) {
  return parts.filter(Boolean).join(" ");
}

const sectionVariants = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: 0.07,
      delayChildren: 0.05,
    },
  },
};

const tileVariants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: "easeOut" } },
};

const STEPPER_STEPS = [
  {
    num: "01",
    label: "Idea input",
    body: "Start with a broad market theme or investment thesis. The more specific you get, the sharper the output.",
    icon: <Target className="h-4 w-4 text-primary" />,
  },
  {
    num: "02",
    label: "AI synthesis",
    body: "We pull in drivers, regime context, and risk posture — then condense it into a structured narrative.",
    icon: <Brain className="h-4 w-4 text-primary" />,
  },
  {
    num: "03",
    label: "Make it usable",
    body: "Turn the synthesis into watchlists, set alerts on catalysts, and save everything for later.",
    icon: <ChartLineUp className="h-4 w-4 text-primary" />,
  },
];

const STEP_DURATION_MS = 4000;

function HowItWorksStepper() {
  const [active, setActive] = useState(0);
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);

  const advance = useCallback(() => {
    setActive((prev) => (prev + 1) % STEPPER_STEPS.length);
    setProgress(0);
  }, []);

  useEffect(() => {
    if (paused) return;
    const tick = 50;
    const id = window.setInterval(() => {
      setProgress((prev) => {
        const next = prev + (tick / STEP_DURATION_MS) * 100;
        if (next >= 100) {
          advance();
          return 0;
        }
        return next;
      });
    }, tick);
    return () => window.clearInterval(id);
  }, [paused, advance]);

  return (
    <motion.div
      variants={tileVariants}
      className="relative overflow-hidden border-[2.5px] border-foreground bg-surface-highlight p-6 md:p-8 shadow-[4px_4px_0_0_#15110c] dark:shadow-[4px_4px_0_0_rgba(255,255,255,0.12)]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="space-y-2">
          <div className="relative inline-block">
            <span className="inline-flex items-center px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-surface text-foreground relative z-10">
              HOW IT WORKS
            </span>

          </div>
          <h3 className="text-lg font-bold leading-[1.2] tracking-tight">
            Three steps. One loop.
          </h3>
          <p className="text-sm text-muted/80 leading-relaxed font-medium max-w-md">
            A tight workflow designed for speed.
          </p>
        </div>
        <div className="shrink-0 flex items-center justify-center w-9 h-9">
          <FlowArrow className="h-5 w-5 text-primary" />
        </div>
      </div>

      {/* Stepper */}
      <div className="grid gap-3 md:grid-cols-3">
        {STEPPER_STEPS.map((step, i) => {
          const isActive = i === active;
          const isDone = i < active;
          return (
            <button
              key={step.num}
              type="button"
              onClick={() => { setActive(i); setProgress(0); }}
              className={cx(
                "relative text-left border-[2.5px] border-foreground px-5 py-4 transition-all duration-300 ease-out cursor-pointer",
                isActive
                  ? "bg-surface shadow-[4px_4px_0_0_#15110c] dark:shadow-[4px_4px_0_0_rgba(255,255,255,0.12)] translate-x-0 translate-y-0"
                  : isDone
                    ? "bg-surface/60 shadow-none translate-x-0 translate-y-0 opacity-70"
                    : "bg-surface/40 shadow-none translate-x-0 translate-y-0 opacity-50",
              )}
            >
              {/* Progress bar for active step */}
              <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-foreground/5">
                <motion.div
                  className="h-full bg-primary"
                  animate={{ width: isActive ? `${progress}%` : isDone ? "100%" : "0%" }}
                  transition={isActive ? { duration: 0.05, ease: "linear" } : { duration: 0.3 }}
                />
              </div>

              {/* Step number */}
              <div className="flex items-center gap-3 mb-2">
                <span
                  className={cx(
                    "inline-flex items-center justify-center w-7 h-7 border-[2px] border-foreground text-[11px] font-black",
                    isActive ? "bg-primary text-white" : "bg-transparent text-foreground",
                    "transition-colors duration-300",
                  )}
                >
                  {step.num}
                </span>
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted">
                  {step.label}
                </span>
                <div className="ml-auto shrink-0">{step.icon}</div>
              </div>

              {/* Body — only shown for active */}
              <AnimatePresence mode="wait">
                {isActive && (
                  <motion.p
                    key={`body-${i}`}
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.25, ease: "easeOut" }}
                    className="text-sm leading-relaxed font-medium overflow-hidden"
                  >
                    {step.body}
                  </motion.p>
                )}
              </AnimatePresence>
            </button>
          );
        })}
      </div>
    </motion.div>
  );
}


function OrigamiTile({
  className,
  tape,
  tapeClassName,
  title,
  description,
  icon,
  children,
  tone = "paper",
}: {
  className?: string;
  tape?: string;
  tapeClassName?: string;
  title: string;
  description?: string;
  icon?: ReactNode;
  children?: ReactNode;
  tone?: "paper" | "highlight";
}) {
  const toneClasses =
    tone === "highlight"
      ? "bg-surface-highlight"
      : "bg-surface";

  return (
    <motion.div
      variants={tileVariants}
      className={cx(
        "relative h-full",
        className,
      )}
    >
      <div
        className={cx(
          "group relative h-full overflow-hidden border-[2.5px] border-foreground p-6 shadow-[4px_4px_0_0_#15110c] dark:shadow-[4px_4px_0_0_rgba(255,255,255,0.12)]",
          "transition-transform duration-200 ease-out will-change-transform",
          toneClasses,
        )}
      >
        {/* Paper fold effect */}
        <div className="absolute top-0 right-0 w-8 h-8 pointer-events-none">
          {/* Background cutout to show the main page background through the "fold" */}
          <div className="absolute top-[-1px] right-[-1px] w-0 h-0 border-t-[24px] border-t-background border-l-[24px] border-l-transparent z-20" />

          {/* The folded corner piece */}
          <div className="absolute top-[-1px] right-[-1px] w-0 h-0 border-b-[22px] border-b-foreground/10 border-r-[22px] border-r-transparent z-10" />

          {/* Stark border for the fold */}
          <div className="absolute top-[-1px] right-[-1px] w-0 h-0 border-b-[1.5px] border-b-foreground border-r-[1.5px] border-r-foreground z-10" />
          <div className="absolute top-[21px] right-0 w-[1.5px] h-[1.5px] bg-foreground z-10" />
          <div className="absolute top-0 right-[21px] w-[1.5px] h-[1.5px] bg-foreground z-10" />
        </div>

        <div className="relative flex h-full flex-col gap-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-4">
              {tape ? (
                <div className="relative">
                  <span
                    className={cx(
                      "inline-flex items-center px-2 py-0.5",
                      "text-[10px] font-bold uppercase tracking-wider",
                      "relative z-10",
                      tapeClassName ?? "bg-primary/20 text-foreground border-x border-foreground/10",
                    )}
                  >
                    {tape}
                  </span>
                  {/* Tape "jagged" edges effect */}

                </div>
              ) : null}
            </div>

            {icon ? (
              <div className="shrink-0 flex items-center justify-center w-9 h-9">
                {icon}
              </div>
            ) : null}
          </div>

          <div className="space-y-2">
            <h3 className="text-lg font-bold leading-[1.2] tracking-tight">
              {title}
            </h3>
            {description ? (
              <p className="text-sm text-muted/80 leading-relaxed font-medium">
                {description}
              </p>
            ) : null}
          </div>

          {children ? <div className="mt-auto">{children}</div> : null}
        </div>
      </div>
    </motion.div>
  );
}

function formatCompactCurrency(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  const abs = Math.abs(value);
  if (abs >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function DemoStockCard({
  item,
  logoUrl,
  price,
  changePct,
  prices,
  metadata
}: {
  item: DemoTickerExplanation;
  logoUrl?: string | null;
  price: number | null;
  changePct: number | null;
  prices: Record<string, any>;
  metadata: any;
}) {
  const isPositive = item.sentiment === "positive";
  const isNegative = item.sentiment === "negative";

  const highlights: Array<{ label: string; value: string; positive?: boolean }> = [];
  if (typeof item.financialHighlights?.marketCap === "number") {
    highlights.push({ label: "Mkt Cap", value: formatCompactCurrency(item.financialHighlights.marketCap) });
  }
  if (typeof item.financialHighlights?.totalRevenue === "number") {
    highlights.push({ label: "Revenue", value: formatCompactCurrency(item.financialHighlights.totalRevenue) });
  }
  if (typeof item.financialHighlights?.netIncome === "number") {
    const ni = item.financialHighlights.netIncome;
    highlights.push({ label: "Net Income", value: formatCompactCurrency(ni), positive: ni > 0 });
  }
  if (typeof item.financialHighlights?.epsDiluted === "number") {
    const eps = item.financialHighlights.epsDiluted;
    highlights.push({ label: "EPS", value: eps.toFixed(2), positive: eps > 0 });
  }

  const revChg = typeof item.incomeChange?.revenueChange === "number" ? item.incomeChange.revenueChange : null;
  const niChg = typeof item.incomeChange?.netIncomeChange === "number" ? item.incomeChange.netIncomeChange : null;

  const sentimentAgg = item.newsSentiment?.aggregate;
  const sentimentArticles = item.newsSentiment?.articles ?? [];

  const isPositiveSentiment = sentimentAgg?.label === 'positive';
  const isNegativeSentiment = sentimentAgg?.label === 'negative';
  const hasUpside = isPositiveSentiment || (revChg !== null && revChg > 5) || (niChg !== null && niChg > 10);

  return (
    <div className="rounded-lg border border-border-color/60 bg-background-dark/50 p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <HoverWrapper
            symbol={item.symbol}
            price={price}
            changePct={changePct}
            prices={prices}
            logoUrl={logoUrl ?? null}
            metadata={metadata}
          >
            <div className="flex items-center gap-2">
              {logoUrl ? (
                <img src={logoUrl} alt="" className="h-6 w-6 rounded-full bg-white object-cover p-0.5" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              ) : (
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-highlight text-[8px] font-bold text-muted">
                  {item.symbol.slice(0, 2)}
                </div>
              )}
              <Link href={`/stock/${item.symbol}`} className="text-sm font-bold text-primary hover:underline">
                {item.symbol}
              </Link>
            </div>
          </HoverWrapper>
          {price !== null && (
            <span className="text-xs font-mono text-muted">${price.toFixed(2)}</span>
          )}
          {changePct !== null && Number.isFinite(changePct) && (
            <span className={`text-xs font-mono font-semibold ${changePct >= 0 ? 'text-neon-green' : 'text-neon-red'}`}>
              {changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%
            </span>
          )}
        </div>
        {sentimentAgg && sentimentAgg.count > 0 && (
          <span
            className={cx(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
              isPositiveSentiment
                ? "border border-neon-green/30 bg-neon-green/10 text-neon-green"
                : isNegativeSentiment
                  ? "border border-neon-red/30 bg-neon-red/10 text-neon-red"
                  : "border border-border-color bg-surface text-muted",
            )}
          >
            <span className="material-symbols-outlined text-[11px]">
              {isPositiveSentiment ? "trending_up" : isNegativeSentiment ? "trending_down" : "trending_flat"}
            </span>
            {hasUpside && !isNegativeSentiment ? "Upside" : String(sentimentAgg.label)}
          </span>
        )}
      </div>

      {/* Rationale */}
      <p className="text-sm text-foreground leading-relaxed">
        {annotateFinancialTerms(item.rationale)}
      </p>

      {/* Financial metrics pills */}
      {(highlights.length > 0 || revChg !== null || niChg !== null) && (
        <div className="flex flex-wrap gap-2">
          {highlights.map((h) => (
            <span key={h.label} className="inline-flex items-center gap-1 rounded-md border border-border-color/40 bg-surface/60 px-2 py-1 text-[10px]">
              <span className="text-muted">{h.label}</span>
              <span className={`font-semibold ${h.positive === true ? "text-neon-green" : h.positive === false ? "text-neon-red" : "text-foreground"}`}>{h.value}</span>
            </span>
          ))}
          {revChg !== null && (
            <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-semibold ${revChg >= 0 ? "border-neon-green/30 bg-neon-green/5 text-neon-green" : "border-neon-red/30 bg-neon-red/5 text-neon-red"}`}>
              Rev {revChg >= 0 ? "+" : ""}{revChg.toFixed(1)}% QoQ
            </span>
          )}
          {niChg !== null && (
            <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-semibold ${niChg >= 0 ? "border-neon-green/30 bg-neon-green/5 text-neon-green" : "border-neon-red/30 bg-neon-red/5 text-neon-red"}`}>
              NI {niChg >= 0 ? "+" : ""}{niChg.toFixed(1)}% QoQ
            </span>
          )}
        </div>
      )}

      {/* SEC Filings */}
      {item.filings && item.filings.length > 0 && (
        <div className="flex items-center gap-2 text-[10px] text-muted flex-wrap">
          <span className="material-symbols-outlined text-[12px]">description</span>
          <span>SEC filings:</span>
          {item.filings.map((filing, fi) => {
            const label = [filing.form, filing.filingDate].filter(Boolean).join(" ");
            if (!label) return null;
            return (
              <span key={fi} className="flex items-center gap-1">
                {fi > 0 && <span className="text-border-color">·</span>}
                {filing.url ? (
                  <a href={filing.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{label}</a>
                ) : (
                  <span>{label}</span>
                )}
              </span>
            );
          })}
        </div>
      )}

      {/* Recent Headlines */}
      {sentimentArticles.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted flex items-center gap-1">
            <span className="material-symbols-outlined text-[12px]">newspaper</span>
            Recent Headlines ({sentimentAgg?.count ?? sentimentArticles.length} articles)
          </p>
          {sentimentArticles.slice(0, 3).map((art, ai) => (
            <div key={ai} className="flex items-start gap-2 text-xs">
              <span className={`mt-0.5 text-[10px] ${art.sentiment === "positive" ? "text-neon-green" : art.sentiment === "negative" ? "text-neon-red" : "text-muted"}`}>
                <span className="material-symbols-outlined text-[12px]">
                  {art.sentiment === "positive" ? "arrow_upward" : art.sentiment === "negative" ? "arrow_downward" : "remove"}
                </span>
              </span>
              <span className="text-foreground/80 leading-snug">{String(art.title ?? "")}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DemoTickerChip({
  ticker,
  logoUrl,
  price,
  changePct,
  prices,
  metadata
}: {
  ticker: DemoTicker;
  logoUrl?: string | null;
  price: number | null;
  changePct: number | null;
  prices: Record<string, any>;
  metadata: any;
}) {
  return (
    <HoverWrapper
      symbol={ticker.symbol}
      price={price}
      changePct={changePct}
      prices={prices}
      logoUrl={logoUrl ?? null}
      metadata={metadata}
    >
      <div className="flex items-center gap-2 rounded-lg border border-border-color bg-background-dark px-3 py-2 transition-colors hover:border-primary/50">
        {logoUrl ? (
          <img
            src={logoUrl}
            alt={`${ticker.symbol} logo`}
            className="h-5 w-5 rounded-full bg-white object-cover p-0.5"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <div className="flex h-5 w-5 items-center justify-center rounded bg-surface-highlight text-[8px] font-bold text-muted">
            {ticker.symbol.slice(0, 2)}
          </div>
        )}
        <div className="flex flex-col">
          <Link
            href={`/stock/${ticker.symbol}`}
            className="text-xs font-bold text-foreground hover:text-primary"
          >
            {ticker.symbol}
          </Link>
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[9px] text-muted">
              {price !== null ? `$${price.toFixed(2)}` : ticker.name}
            </span>
            {changePct !== null && Number.isFinite(changePct) && (
              <span className={`font-mono text-[9px] font-semibold ${changePct >= 0 ? 'text-neon-green' : 'text-neon-red'}`}>
                {changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          disabled
          className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border-color text-muted opacity-60 cursor-not-allowed"
          title={`Add ${ticker.symbol} to watchlist`}
        >
          <span className="material-symbols-outlined text-[12px] leading-none">
            playlist_add
          </span>
        </button>
        <button
          type="button"
          disabled
          className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border-color text-muted opacity-60 cursor-not-allowed transition-colors"
          title={`Remove ${ticker.symbol} from synthesis`}
        >
          <span className="material-symbols-outlined text-[12px] leading-none">close</span>
        </button>
      </div>
    </HoverWrapper>
  );
}

export default function HomeLanding() {
  const {
    prompt,
    setPrompt,
    state,
    start,
    summary,
    bullets,
    loadingStepIndex,
    loadingSteps,
    watchlistName,
    reasoning,
    model,
    tickers,
    tickerExplanations,
  } = useHomeSynthesisDemo();

  const [showPricing, setShowPricing] = useState(false);
  const [isSynthesisExpanded, setIsSynthesisExpanded] = useState(true);

  // Fetch logos for synthesized tickers exactly like app/home/page.tsx
  const synthesisSymbols = useMemo(
    () => tickers?.map((ticker) => ticker.symbol) || [],
    [tickers]
  );
  const logoSymbols = useMemo(
    () => Array.from(new Set(synthesisSymbols)),
    [synthesisSymbols]
  );
  const { getLogo } = useCompanyLogos(logoSymbols);
  const { prices, getLatestPrice, getPrices } = useStockPrices();
  const { getMetadata } = useStockMetadata();

  const getDailyChangePct = (symbol: string): number | null => {
    const series = getPrices(symbol);
    if (!series) return null;
    const dates = Object.keys(series).sort();
    if (dates.length < 2) return null;
    const latest = series[dates[dates.length - 1]];
    const prev = series[dates[dates.length - 2]];
    if (!latest || !prev || !Number.isFinite(prev.close) || prev.close === 0) return null;
    return ((latest.close - prev.close) / prev.close) * 100;
  };

  const isCompleted = state === "completed";
  const isGenerating = state === "generating";
  const showOutput = state !== "idle";

  return (
    <div className="min-h-screen bg-background text-foreground relative overflow-hidden">
      {/* Keep background videos pinned to viewport so size stays constant as content grows */}
      <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
        <video
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          className="absolute inset-0 w-full h-full object-cover hidden dark:block"
        >
          <source src="/bg-dark-v4.webm" type="video/webm" />
        </video>
        <video
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          className="absolute inset-0 w-full h-full object-cover block dark:hidden"
        >
          <source src="/bg-light-v4.webm" type="video/webm" />
        </video>
      </div>

      <main className="relative z-10 max-w-[1200px] mx-auto px-6 py-12 space-y-16">
        <header className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3" aria-label="QuantPlatform home">
            <BrandLogo height={34} />
            <span className="text-[11px] font-bold tracking-[0.32em] text-white uppercase">
              QUANT PLATFORM
            </span>
          </Link>
          <div className="flex items-center gap-4">
            <ThemeToggle />
            <Link
              href="/signin"
              className="text-xs font-semibold uppercase tracking-[0.2em] text-white/90 hover:text-white transition-colors"
            >
              Sign in
            </Link>
            <Link
              href="/signup"
              className={cx(
                "inline-flex items-center justify-center px-4 py-2",
                "border-[2px] border-foreground bg-primary text-white text-[10px] font-bold uppercase tracking-[0.2em]",
                "shadow-[2px_2px_0_0_#15110c] dark:shadow-[2px_2px_0_0_rgba(255,255,255,0.12)]",
                "transition-transform active:scale-95",
              )}
            >
              Create account
            </Link>
          </div>
        </header>

        <section id="demo" className="grid gap-10 items-start">
          <div className="space-y-6">
            <div className="space-y-3">
              <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-white">
                QuantPlatform
              </h1>
              <p className="text-lg md:text-xl font-semibold tracking-tight text-white">
                Test a market idea and watch the synthesis build live.
              </p>
              <p className="text-base text-white leading-relaxed">
                Enter a high-level theme and preview how QuantPlatform structures market
                context, risk posture, and actionable insights in seconds.
              </p>
            </div>

            <PromptInput
              label="Watchlist Generator"
              placeholder="Type a market theme..."
              suggestions={HOME_DEMO_PROMPT_SUGGESTIONS}
              suggestionAnimation="typewriter"
              maxLength={1200}
              readOnly
              value={prompt}
              onChange={setPrompt}
              onSubmit={start}
              icon={<Terminal className="text-primary w-4 h-4" />}
              action={{
                label: "Generate",
                loadingLabel: "Synthesizing...",
                onClick: start,
                isLoading: state === "generating" || state === "streaming",
                isDisabled: prompt.trim().length === 0,
                icon: <Zap className="w-3 h-3" />,
                loadingIcon: <RotateCw className="w-3 h-3 animate-spin" />,
              }}
            />

            <div className="flex items-center gap-3 text-xs text-white/90">
              <span
                className={`h-2 w-2 rounded-full ${state === "idle"
                  ? "bg-muted/40"
                  : state === "generating"
                    ? "bg-primary/40"
                    : state === "streaming"
                      ? "bg-primary"
                      : "bg-primary"
                  }`}
              />
              <AnimatePresence mode="wait">
                <motion.span
                  key={state}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  className="uppercase tracking-[0.2em]"
                >
                  {stateLabels[state]}
                </motion.span>
              </AnimatePresence>
              <span className="text-[10px] uppercase tracking-[0.2em] text-white/85">
                Press Enter to run
              </span>
            </div>


            <AnimatePresence>
              {showOutput ? (
                <motion.div
                  key="synthesis-report"
                  layout
                  initial={{ opacity: 0, y: 18 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 12 }}
                  transition={{ duration: 0.25, ease: "easeOut" }}
                  className="space-y-4"
                >
                  <div className="flex items-center justify-between px-1">
                    <h2 className="text-[11px] font-bold text-foreground flex items-center gap-2 uppercase tracking-[0.15em]">
                      <Sparkles className="w-4 h-4 text-primary" />
                      Synthesis Report
                    </h2>
                    <span className="text-[10px] uppercase tracking-[0.2em] text-muted">
                      {stateLabels[state]}
                    </span>
                  </div>

                  <div className="bg-surface border border-border-color p-6 md:p-8 rounded-2xl relative overflow-hidden text-left">
                    {isGenerating ? (
                      /* Loading steps — mirrors the dashboard generating state exactly */
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary">
                            Synthesis Running
                          </p>
                          <span className="rounded-full border border-border-color bg-background-dark px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-muted">
                            Step {loadingStepIndex + 1}/{loadingSteps.length}
                          </span>
                        </div>
                        <p className="text-sm text-muted leading-relaxed">
                          {loadingSteps[loadingStepIndex]}
                        </p>
                        <div className="flex items-center gap-2">
                          <div
                            className="grid flex-1 gap-1"
                            style={{
                              gridTemplateColumns: `repeat(${loadingSteps.length}, minmax(0, 1fr))`,
                            }}
                          >
                            {loadingSteps.map((_, index) => (
                              <div
                                key={`step-${index}`}
                                className={cx(
                                  "h-1.5 rounded-full transition-all duration-500",
                                  index === loadingStepIndex
                                    ? "bg-primary"
                                    : index < loadingStepIndex
                                      ? "bg-primary/40"
                                      : "bg-border-color",
                                )}
                              />
                            ))}
                          </div>
                          <RotateCw className="h-3 w-3 animate-spin text-primary" />
                        </div>
                        <p className="text-[10px] text-muted">
                          Reasoning steps cycle while market data loads.
                        </p>
                      </div>
                    ) : (
                      /* Synthesis output — mirrors dashboard synthesis result layout */
                      <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
                        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                          <h3 className="text-lg font-bold text-foreground tracking-tight">
                            Structural Risk: {watchlistName}
                          </h3>
                          <div className="flex items-center gap-2">
                            <CopyButton
                              getText={() => ""}
                              label="Copy"
                            />
                            <ShareDownloadButtons
                              content={""}
                              markdownContent={""}
                              pdfContent={""}
                              title={`Synthesis Report: ${watchlistName}`}
                              filename={"synthesis-report"}
                              variant="compact"
                              enableMarkdownExport
                              enablePdfExport
                            />
                            <button
                              type="button"
                              disabled
                              className="text-[9px] font-black bg-primary text-white px-3 py-2 rounded-lg uppercase tracking-widest flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              <Bookmark className="w-3 h-3" /> Save As New Watchlist
                            </button>
                            <button
                              type="button"
                              onClick={() => setIsSynthesisExpanded((prev) => !prev)}
                              className="text-[9px] font-black border border-border-color px-3 py-2 rounded-lg uppercase tracking-widest text-muted hover:text-foreground"
                            >
                              {isSynthesisExpanded ? 'Collapse Text' : 'Expand Text'}
                            </button>
                          </div>
                        </div>

                        {/* Narrative + bullets */}
                        {isSynthesisExpanded ? (
                          <div className="mb-6 space-y-4 text-sm text-muted leading-relaxed">
                            {summary.length > 0 && (
                              <p className="whitespace-pre-wrap">
                                {annotateFinancialTerms(summary)}
                              </p>
                            )}
                            {bullets.length > 0 && (
                              <ul className="list-disc pl-4 space-y-1.5">
                                {bullets.map((bullet, idx) => (
                                  <li key={`${idx}-${bullet.slice(0, 12)}`} className="text-xs leading-relaxed">
                                    {annotateFinancialTerms(bullet)}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        ) : (
                          <p className="mb-4 text-xs text-muted">
                            Synthesis text is collapsed. Expand text to view narrative, reasoning, and per-stock rationale.
                          </p>
                        )}

                        {/* Reasoning Trace */}
                        {isSynthesisExpanded && reasoning && (
                          <div className="mb-6 space-y-1">
                            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">
                              Reasoning Trace{model ? ` (${model})` : ""}
                            </p>
                            <p className="text-xs whitespace-pre-wrap text-muted leading-relaxed">
                              {annotateFinancialTerms(reasoning)}
                            </p>
                          </div>
                        )}

                        {/* Per-stock analysis cards */}
                        {isSynthesisExpanded && tickerExplanations.length > 0 && (
                          <div className="space-y-3 mb-6">
                            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
                              Stock Analysis ({tickerExplanations.length})
                            </p>
                            {tickerExplanations.map((item) => {
                              const logoUrl = getLogo(item.symbol);
                              const price = getLatestPrice(item.symbol);
                              const changePct = getDailyChangePct(item.symbol);
                              return (
                                <DemoStockCard
                                  key={item.symbol}
                                  item={item}
                                  logoUrl={logoUrl}
                                  price={price?.close ?? null}
                                  changePct={changePct}
                                  prices={prices}
                                  metadata={getMetadata(item.symbol)}
                                />
                              );
                            })}
                          </div>
                        )}

                        {/* Generated tickers chips */}
                        {tickers.length > 0 && (
                          <div className="space-y-3 border-t border-border-color pt-4">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <p className="text-[10px] font-bold text-muted uppercase tracking-wider">
                                Generated Tickers ({tickers.length})
                              </p>
                              <div className="flex flex-wrap items-center gap-2">
                                <select
                                  disabled
                                  className="h-9 rounded-lg border border-border-color bg-background-dark pl-3 pr-8 text-[11px] text-foreground appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%23888%22%20stroke-width%3D%222%22%3E%3Cpath%20d%3D%22M6%209l6%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-[length:12px] bg-[right_8px_center] bg-no-repeat opacity-60 cursor-not-allowed"
                                >
                                  <option value="">
                                    Select watchlist (optional)
                                  </option>
                                </select>
                                <div className="flex items-center rounded-lg border border-border-color bg-background-dark opacity-60 cursor-not-allowed">
                                  <input
                                    disabled
                                    placeholder="Add ticker"
                                    className="h-9 w-28 bg-transparent px-2 text-[11px] uppercase tracking-[0.1em] text-foreground outline-none cursor-not-allowed"
                                  />
                                  <button
                                    type="button"
                                    disabled
                                    className="h-9 border-l border-border-color px-3 text-[10px] font-bold uppercase tracking-[0.1em] text-primary cursor-not-allowed"
                                  >
                                    Add
                                  </button>
                                </div>
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {tickers.map((ticker) => {
                                const logoUrl = getLogo(ticker.symbol);
                                const price = getLatestPrice(ticker.symbol);
                                const changePct = getDailyChangePct(ticker.symbol);
                                return (
                                  <DemoTickerChip
                                    key={ticker.symbol}
                                    ticker={ticker}
                                    logoUrl={logoUrl}
                                    price={price?.close ?? null}
                                    changePct={changePct}
                                    prices={prices}
                                    metadata={getMetadata(ticker.symbol)}
                                  />
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>

            <AnimatePresence>
              {isCompleted && !showPricing ? (
                <motion.div
                  initial={{ opacity: 0, y: 18 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0, overflow: "hidden", marginTop: 0 }}
                  transition={{ duration: 0.35, ease: "easeOut", delay: 0.2 }}
                  className="flex justify-center pt-2 pb-4"
                >
                  <button
                    onClick={() => {
                      setShowPricing(true);
                      setTimeout(() => {
                        document.getElementById("pricing")?.scrollIntoView({ behavior: "smooth" });
                      }, 100);
                    }}
                    className={cx(
                      "inline-flex items-center justify-center gap-2 px-8 py-4 w-full md:w-auto",
                      "bg-neon-green text-[#15110c] border-[2.5px] border-foreground",
                      "shadow-[4px_4px_0_0_#15110c] dark:shadow-[4px_4px_0_0_rgba(255,255,255,0.12)]",
                      "text-sm font-bold uppercase tracking-[0.15em]",
                      "transition-transform active:scale-95 hover:bg-[#4eff63] group"
                    )}
                  >
                    Create Account
                    <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
                  </button>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        </section>

        <motion.section
          id="features"
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.2 }}
          variants={sectionVariants}
          className="relative hidden"
        >
          <motion.div variants={tileVariants} className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div className="space-y-3 max-w-2xl">
              <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-muted">
                Features
              </span>
              <h2 className="text-2xl md:text-3xl font-bold leading-tight tracking-tight">
                Deep context. Zero friction.
              </h2>
              <p className="text-sm md:text-base text-muted leading-relaxed">
                QuantPlatform strips away the noise. We transform complex market signals into
                a physical-first research environment designed for clarity and speed.
              </p>
            </div>
            <Link
              href="/signup"
              className={cx(
                "inline-flex items-center justify-center gap-2 px-5 py-3",
                "border-[2.5px] border-foreground bg-surface shadow-[4px_4px_0_0_#15110c] dark:shadow-[4px_4px_0_0_rgba(255,255,255,0.12)]",
                "text-[10px] font-bold uppercase tracking-[0.2em] transition-transform duration-200 ease-out",
                "active:scale-95",
              )}
            >
              Create account
              <ArrowRight className="h-4 w-4" />
            </Link>
          </motion.div>

          <div className="mt-8 grid gap-8 md:grid-cols-2">
            <OrigamiTile
              className="md:row-span-2"
              tape="CORE"
              title="Live synthesis that builds while you watch."
              description="Start with a theme. We assemble drivers, regime signals, and risk posture into a clean narrative you can act on."
              icon={<Brain className="h-5 w-5 text-primary" />}
            >
              <ul className="space-y-3 text-sm">
                {[
                  "Brief and Deep views (same structure, different depth).",
                  "Market + sector context to anchor the story.",
                  "Actionable bullets you can copy into your research notes.",
                ].map((line) => (
                  <li key={line} className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 text-neon-green" />
                    <span className="leading-relaxed">{line}</span>
                  </li>
                ))}
              </ul>
            </OrigamiTile>

            <OrigamiTile
              tape="MODES"
              title="Brief vs Deep Syntheses."
              description="Skim the narrative at a glance or drill into data-backed depth with a single toggle."
              icon={<StackSimple className="h-5 w-5 text-primary" />}
            />

            <OrigamiTile
              tape="RISK"
              tapeClassName="bg-surface-highlight/50 text-foreground"
              title="Risk signals, not vibes."
              description="Surface hidden correlations and regime shifts before they impact your PnL."
              icon={<ShieldCheck className="h-5 w-5 text-primary" />}
            />

            <OrigamiTile
              tape="ALERTS"
              tapeClassName="bg-surface-highlight text-foreground border border-foreground/10"
              title="Smart catalysts alerts."
              description="Get notified when specific narrative drivers change or key price levels are hit."
              icon={<BellRinging className="h-5 w-5 text-primary" />}
            />

            <OrigamiTile
              tape="HISTORY"
              tapeClassName="bg-primary/10 text-foreground border border-primary/20"
              title="Your personal research alpha."
              description="Every synthesis is stored, searchable, and comparative. Build your library of market context."
              icon={<ClockCounterClockwise className="h-5 w-5 text-primary" />}
            />
          </div>

          <div className="mt-4">
            <HowItWorksStepper />
          </div>
        </motion.section>

        <AnimatePresence>
          {showPricing && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              transition={{ duration: 0.5, ease: "easeInOut" }}
              className="overflow-hidden"
            >
              <section id="pricing" className="relative pb-16 pt-8">
                <motion.div variants={tileVariants} className="text-center space-y-3">
                  <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-muted">
                    Pricing
                  </span>
                  <h2 className="text-2xl md:text-3xl font-bold leading-tight tracking-tight">
                    Pick a tier. Keep the edges sharp.
                  </h2>
                  <p className="text-sm md:text-base text-muted leading-relaxed max-w-2xl mx-auto">
                    Start free with the demo. Upgrade when you want saved history, workflows, and real-time signals.
                  </p>
                </motion.div>

                <div className="mt-8 space-y-6 lg:space-y-0 lg:grid lg:grid-cols-2 lg:gap-8 max-w-4xl mx-auto">
                  {/* Free */}
                  <motion.div
                    variants={tileVariants}
                    className="relative flex flex-col border-[2.5px] border-foreground p-6 shadow-[4px_4px_0_0_#15110c] dark:shadow-[4px_4px_0_0_rgba(255,255,255,0.12)] bg-surface"
                  >
                    <div className="relative flex flex-col h-full">
                      <div className="flex items-start justify-between mb-6">
                        <span className="bg-neon-green text-[#15110c] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.15em]">
                          START HERE
                        </span>
                      </div>
                      <h4 className="text-xl font-bold">Free (Demo)</h4>
                      <p className="text-xs text-muted uppercase font-bold tracking-tight mt-1 mb-4">
                        No card required
                      </p>
                      <p className="text-3xl font-bold mb-6">$0</p>
                      <ul className="space-y-3 mb-8">
                        <li className="flex items-center gap-2 text-xs">
                          <CheckCircle2 className="h-4 w-4 text-neon-green shrink-0" />
                          Interactive market synthesis preview
                        </li>
                        <li className="flex items-center gap-2 text-xs">
                          <CheckCircle2 className="h-4 w-4 text-neon-green shrink-0" />
                          Brief-mode structure + bullets
                        </li>
                        <li className="flex items-center gap-2 text-xs opacity-50">
                          <XCircle className="h-4 w-4 shrink-0" />
                          No saved history
                        </li>
                      </ul>
                      <Link
                        href="#demo"
                        className={cx(
                          "mt-auto flex items-center justify-center gap-2 w-full py-4",
                          "bg-surface border-[2px] border-foreground",
                          "text-xs font-bold uppercase tracking-[0.15em]",
                          "transition-transform active:scale-95 group/btn",
                        )}
                      >
                        Run the Demo
                        <ArrowRight className="h-4 w-4 transition-transform group-hover/btn:translate-x-0.5" />
                      </Link>
                    </div>
                  </motion.div>

                  {/* Pro – featured */}
                  <motion.div
                    variants={tileVariants}
                    className="relative flex flex-col border-[2.5px] border-foreground p-6 shadow-[4px_4px_0_0_#15110c] dark:shadow-[4px_4px_0_0_rgba(255,255,255,0.12)] bg-surface-highlight"
                  >
                    <div className="relative flex flex-col h-full">
                      <div className="flex items-start justify-between mb-6">
                        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted">
                          Pro
                        </span>
                      </div>
                      <h4 className="text-xl font-bold">Pro</h4>
                      <p className="text-xs text-muted uppercase font-bold tracking-tight mt-1 mb-4">
                        Billed monthly
                      </p>
                      <div className="flex items-baseline gap-1 mb-6">
                        <span className="text-3xl font-bold">$2.99</span>
                        <span className="text-sm text-muted">/mo</span>
                      </div>
                      <ul className="space-y-3 mb-8">
                        <li className="flex items-center gap-2 text-xs">
                          <CheckCircle2 className="h-4 w-4 text-neon-green shrink-0" />
                          Saved synthesis history + filtering
                        </li>
                        <li className="flex items-center gap-2 text-xs">
                          <CheckCircle2 className="h-4 w-4 text-neon-green shrink-0" />
                          Watchlists, alerts, and workflows
                        </li>
                        <li className="flex items-center gap-2 text-xs">
                          <CheckCircle2 className="h-4 w-4 text-neon-green shrink-0" />
                          Deep insights + richer context
                        </li>
                      </ul>
                      <Link
                        href="/signup"
                        className={cx(
                          "mt-auto flex items-center justify-center gap-2 w-full py-4",
                          "bg-neon-green text-[#15110c] border-[2px] border-foreground",
                          "text-xs font-bold uppercase tracking-[0.15em]",
                          "transition-transform duration-200 ease-out active:scale-95 group/btn",
                        )}
                      >
                        Start Pro
                        <ArrowRight className="h-4 w-4 transition-transform group-hover/btn:translate-x-0.5" />
                      </Link>
                    </div>
                  </motion.div>
                </div>
              </section>

            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
