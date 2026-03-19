"use client";
import { devConsole } from "@/lib/devLog";

import React, { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Header } from '@/components/Header';
import MarketMarquee from '@/components/MarketMarquee';
import { WatchlistCard } from '@/components/WatchlistCard';
import { EditWatchlistModal } from '@/components/EditWatchlistModal';
import { ActivityFeed } from '@/components/ActivityFeed';
import MarketSynthesisWidget from '@/components/MarketSynthesisWidget';
import MarketNewsSection from '@/components/MarketNewsSection';
import TopMoversWidget from '@/components/TopMoversWidget';
import TreemapHeatmap from '@/components/TreemapHeatmap';
import PromptInput from '@/components/PromptInput';
import ShareDownloadButtons from '@/components/ShareDownloadButtons';
import CopyButton from '@/components/CopyButton';
import { HoverWrapper } from '@/components/StockHoverCard';
import {
  Sparkles, Terminal, Zap, Bookmark,
  RotateCw, Plus
} from '@/components/Icons';
import { annotateFinancialTerms } from '@/lib/financialTerms';
import { MOCK_WATCHLISTS } from '@/constants';
import { generateStrategyWatchlist, type WatchlistResult } from '@/services/geminiService';
import { useFeatureAccess } from '@/hooks/useFeatureAccess';
import FeatureGateOverlay from '@/components/FeatureGateOverlay';
import { Watchlist } from '@/types';
import { useCompanyLogos } from '@/hooks/useCompanyLogos';
import { useStockPrices } from '@/hooks/useStockPrices';
import { useStockMetadata } from '@/hooks/useStockMetadata';
import { useLocalWatchlists } from '@/hooks/useLocalWatchlists';
import { useFollowedStocks } from '@/hooks/useFollowedStocks';
import { useSearchHistory } from '@/hooks/useSearchHistory';
import { useUserStorageKey } from '@/hooks/useUserStorageKey';
import { LANDING_DEMO_PROMPTS, saveLandingDemoSynthesis } from '@/lib/landingDemoCache';

const INTELLIGENCE_PROMPT_EXAMPLES = [...LANDING_DEMO_PROMPTS];

const INTELLIGENCE_PROMPT_SUGGESTIONS = INTELLIGENCE_PROMPT_EXAMPLES.map((example) => ({
  value: example,
  display: `Try "${example}"`,
}));

type GeneratedSynthesis = WatchlistResult;

const SYNTHESIS_STORAGE_BASE_KEY = 'quant-platform_home_synthesis';
const DEEP_RESEARCH_LOADING_STEPS = [
  'Parsing your strategy intent and risk objective...',
  'Screening liquid large-cap candidates...',
  'Pulling financial highlights and recent SEC filings...',
  'Running quant regime and loss simulations...',
  'Composing narrative and reasoning trace...',
];
const STANDARD_LOADING_STEPS = [
  'Parsing your strategy intent...',
  'Screening liquid large-cap candidates...',
  'Running quant scoring across candidates...',
  'Composing synthesis narrative...',
];

const DEEP_RESEARCH_PROVIDER_LOGOS = [
  { name: 'Groq', short: 'GQ', logoUrl: 'https://logo.clearbit.com/groq.com' },
  { name: 'GPT-OSS', short: 'AI', logoUrl: 'https://logo.clearbit.com/openai.com' },
  { name: 'LlamaIndex', short: 'LI', logoUrl: 'https://logo.clearbit.com/llamaindex.ai' },
  { name: 'SEC EDGAR', short: 'SEC', logoUrl: 'https://logo.clearbit.com/sec.gov' },
  { name: 'FinBERT', short: 'FB', logoUrl: 'https://logo.clearbit.com/huggingface.co' },
] as const;

const normalizeTickerSymbol = (value: string) =>
  value.toUpperCase().replace(/[^A-Z0-9.\-^]/g, '').slice(0, 10);

const formatCompactCurrency = (value?: number) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'N/A';
  const absValue = Math.abs(value);
  if (absValue >= 1_000_000_000_000) return `$${(value / 1_000_000_000_000).toFixed(2)}T`;
  if (absValue >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (absValue >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  return `$${value.toFixed(0)}`;
};

const cleanSynthesisText = (value?: string | null) => {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\bpasses\s+(?:the\s+)?universe\s+screen\b/gi, 'meets baseline size and liquidity filters')
    .replace(/\bpasses[^.\n]*market cap[^.\n]*rule\b/gi, 'meets baseline size and liquidity filters')
    .replace(/\s*\(minimum[^)\n]*\)/gi, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

export default function Home() {
  return (
    <Suspense>
      <HomeContent />
    </Suspense>
  );
}

function HomeContent() {
  const {
    watchlists,
    setWatchlists,
    toggleTickerInWatchlist,
    isInWatchlist,
  } = useLocalWatchlists({ fallback: MOCK_WATCHLISTS });
  const { canUseLLM, reason: accessReason, isLoading: accessLoading } = useFeatureAccess();
  const { followed, toggleFollow } = useFollowedStocks();
  const { addSearch } = useSearchHistory();
  const { storageKey: synthesisStorageKey } = useUserStorageKey(SYNTHESIS_STORAGE_BASE_KEY);
  const searchParams = useSearchParams();
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [synthesis, setSynthesis] = useState<GeneratedSynthesis | null>(null);
  const [deepResearchEnabled, setDeepResearchEnabled] = useState(true);
  const [targetWatchlistId, setTargetWatchlistId] = useState('');
  const [manualTicker, setManualTicker] = useState('');
  const [manualTickerError, setManualTickerError] = useState<string | null>(null);
  const [synthesisHydrated, setSynthesisHydrated] = useState(false);
  const [loadingStepIndex, setLoadingStepIndex] = useState(0);
  const [isSynthesisExpanded, setIsSynthesisExpanded] = useState(true);
  const [selectedWatchlist, setSelectedWatchlist] = useState<Watchlist | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  // Fetch logos for synthesized tickers
  const synthesisSymbols = useMemo(
    () => synthesis?.tickers?.map((ticker) => ticker.symbol) || [],
    [synthesis?.tickers]
  );
  const followedSymbols = useMemo(() => followed ?? [], [followed]);
  const logoSymbols = useMemo(
    () => Array.from(new Set([...synthesisSymbols, ...followedSymbols])),
    [synthesisSymbols, followedSymbols]
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

  // Pre-fill prompt from query param (e.g. from history page click)
  useEffect(() => {
    const q = searchParams.get('prompt');
    if (q) setPrompt(q);
  }, [searchParams]);

  useEffect(() => {
    setSynthesisHydrated(false);
  }, [synthesisStorageKey]);

  useEffect(() => {
    if (typeof window === 'undefined' || synthesisHydrated) return;

    try {
      const raw = localStorage.getItem(synthesisStorageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as {
          synthesis?: GeneratedSynthesis | null;
          prompt?: string;
          deepResearchEnabled?: boolean;
        };
        if (parsed.synthesis) {
          setSynthesis(parsed.synthesis);
        }
        if (typeof parsed.prompt === 'string') {
          setPrompt(parsed.prompt);
        }
        if (typeof parsed.deepResearchEnabled === 'boolean') {
          setDeepResearchEnabled(parsed.deepResearchEnabled);
        }
      }
    } catch {
      // Ignore local storage parse issues.
    } finally {
      setSynthesisHydrated(true);
    }
  }, [synthesisHydrated, synthesisStorageKey]);

  useEffect(() => {
    if (!synthesisHydrated || typeof window === 'undefined') return;

    if (!synthesis) {
      localStorage.removeItem(synthesisStorageKey);
      return;
    }

    const payload = JSON.stringify({
      synthesis,
      prompt,
      deepResearchEnabled,
    });
    localStorage.setItem(synthesisStorageKey, payload);
  }, [deepResearchEnabled, prompt, synthesis, synthesisHydrated, synthesisStorageKey]);

  useEffect(() => {
    if (watchlists.length === 0) {
      setTargetWatchlistId('');
      return;
    }
    if (targetWatchlistId && !watchlists.some((watchlist) => watchlist.id === targetWatchlistId)) {
      setTargetWatchlistId('');
    }
  }, [targetWatchlistId, watchlists]);

  useEffect(() => {
    if (!isGenerating) {
      setLoadingStepIndex(0);
      return;
    }

    const steps = deepResearchEnabled ? DEEP_RESEARCH_LOADING_STEPS : STANDARD_LOADING_STEPS;
    const intervalId = window.setInterval(() => {
      setLoadingStepIndex((prev) => (prev + 1) % steps.length);
    }, 1800);

    return () => window.clearInterval(intervalId);
  }, [deepResearchEnabled, isGenerating]);

  const selectedTargetWatchlist = useMemo(
    () => watchlists.find((watchlist) => watchlist.id === targetWatchlistId) ?? null,
    [targetWatchlistId, watchlists]
  );
  const loadingSteps = deepResearchEnabled ? DEEP_RESEARCH_LOADING_STEPS : STANDARD_LOADING_STEPS;
  const narrativeText = useMemo(() => cleanSynthesisText(synthesis?.narrative), [synthesis?.narrative]);
  const reasoningText = useMemo(() => cleanSynthesisText(synthesis?.reasoning), [synthesis?.reasoning]);

  const synthesisShareText = useMemo(() => {
    if (!synthesis) return '';
    const lines: string[] = [];
    lines.push(`Synthesis Report: ${synthesis.watchlistName}`);

    if (synthesis.meta?.constraints?.min_market_cap) {
      lines.push(
        `Universe filter: market cap >= ${formatCompactCurrency(synthesis.meta.constraints.min_market_cap)}`
      );
    }
    lines.push('');
    lines.push(narrativeText);

    if (reasoningText) {
      lines.push('');
      lines.push('Reasoning Trace');
      lines.push(reasoningText);
    }

    if (synthesis.tickerExplanations?.length) {
      lines.push('');
      lines.push('Ticker Explanations');
      synthesis.tickerExplanations.forEach((item) => {
        lines.push(`- ${item.symbol}: ${cleanSynthesisText(item.rationale)}`);
      });
    }

    lines.push('');
    lines.push(`Generated Tickers (${synthesis.tickers.length})`);
    synthesis.tickers.forEach((ticker) => {
      lines.push(`- ${ticker.symbol} (${ticker.sector}) risk ${ticker.riskScore}`);
    });

    return lines.join('\n');
  }, [narrativeText, reasoningText, synthesis]);

  const synthesisMarkdown = useMemo(() => {
    if (!synthesis) return '';

    const lines: string[] = [];
    lines.push(`# Synthesis Report: ${synthesis.watchlistName}`);
    lines.push('');

    lines.push('## Narrative');
    lines.push('');
    lines.push(narrativeText);

    if (reasoningText) {
      lines.push('');
      lines.push('## Reasoning Trace');
      lines.push('');
      lines.push(reasoningText);
    }

    if (synthesis.tickerExplanations?.length) {
      lines.push('');
      lines.push('## Why Each Stock Was Picked');
      lines.push('');
      synthesis.tickerExplanations.forEach((item) => {
        lines.push(`### ${item.symbol}`);
        lines.push(cleanSynthesisText(item.rationale));
        if (item.filings?.length) {
          lines.push('');
          lines.push('Recent filings:');
          item.filings.forEach((filing) => {
            const filingLabel = [filing.form, filing.filingDate].filter(Boolean).join(' ');
            if (filing.url) {
              lines.push(`- [${filingLabel || 'SEC Filing'}](${filing.url})`);
            } else {
              lines.push(`- ${filingLabel || 'SEC Filing'}`);
            }
          });
        }
        lines.push('');
      });
    }

    lines.push('## Generated Tickers');
    lines.push('');
    synthesis.tickers.forEach((ticker) => {
      lines.push(`- ${ticker.symbol} (${ticker.sector}) - risk score ${ticker.riskScore}`);
    });

    return lines.join('\n');
  }, [narrativeText, reasoningText, synthesis]);

  const synthesisFilename = useMemo(() => {
    if (!synthesis?.watchlistName) return 'synthesis-report';
    const slug = synthesis.watchlistName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return slug || 'synthesis-report';
  }, [synthesis?.watchlistName]);

  const removeTickerFromSynthesis = (symbol: string) => {
    setSynthesis((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        tickers: prev.tickers.filter((ticker) => ticker.symbol !== symbol),
        tickerExplanations: prev.tickerExplanations?.filter((item) => item.symbol !== symbol) ?? [],
      };
    });
  };

  const addManualTicker = () => {
    const symbol = normalizeTickerSymbol(manualTicker);
    if (!symbol) {
      setManualTickerError('Enter a valid ticker symbol.');
      return;
    }

    if (synthesis?.tickers.some((ticker) => ticker.symbol === symbol)) {
      setManualTickerError(`${symbol} is already in this synthesis.`);
      return;
    }

    setSynthesis((prev) => {
      if (!prev) return prev;

      const nextTicker = {
        symbol,
        name: symbol,
        sector: 'Unknown',
        riskScore: 50,
      };
      const nextExplanation = {
        symbol,
        rationale: `${symbol} was manually added by the user for review.`,
        filings: [],
        financialHighlights: {},
      };

      return {
        ...prev,
        tickers: [...prev.tickers, nextTicker],
        tickerExplanations: [...(prev.tickerExplanations ?? []), nextExplanation],
      };
    });

    setManualTicker('');
    setManualTickerError(null);
  };

  const handleGenerate = async () => {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    if (trimmed.length < 2) {
      setGenerationError("Prompt too short. Please enter at least 2 characters.");
      return;
    }
    setIsGenerating(true);
    setGenerationError(null);
    setManualTickerError(null);
    try {
      // Call Server Action
      const result = await generateStrategyWatchlist(trimmed, {
        deepResearch: deepResearchEnabled,
      });
      if (!result.ok) {
        setGenerationError(result.error || "Could not generate a synthesis.");
        return;
      }
      setSynthesis(result.data);
      saveLandingDemoSynthesis(trimmed, result.data);
      setIsSynthesisExpanded(true);
      addSearch(trimmed, deepResearchEnabled, result.data.watchlistName);
    } catch (error) {
      devConsole.error("Failed to generate synthesis:", error);
      setGenerationError("Could not generate a synthesis. Please try again.");
    } finally {
      setIsGenerating(false);
    }
  };

  const saveSynthesisAsWatchlist = () => {
    if (!synthesis) return;
    const newWatchlist: Watchlist = {
      id: `w-${Date.now()}`,
      name: synthesis.watchlistName,
      riskLevel: 'High',
      correlation: parseFloat((Math.random() * 0.9).toFixed(2)),
      dailyChange: '0.00%',
      tickers: synthesis.tickers.map((ticker) => ({
        symbol: ticker.symbol,
        name: ticker.name,
        price: '$0.00',
        change: '0.0%',
        isPositive: true,
        riskScore: ticker.riskScore
      }))
    };
    setWatchlists(prev => [newWatchlist, ...prev]);
    setSynthesis(null);
    setPrompt('');
  };

  const deleteWatchlist = (id: string) => {
    setWatchlists(prev => prev.filter(w => w.id !== id));
  };

  return (
    <div className="min-h-screen flex flex-col bg-background-dark font-sans">
      <Header />

      <main className="flex-1 max-w-[1550px] mx-auto w-full p-6 space-y-6">
        {/* Market Marquee - Fixed indices + scrolling gainers/losers */}
        <MarketMarquee />

        {/* AI Prompt Input */}
        <div className="relative">
          {!canUseLLM && !accessLoading && (
            <FeatureGateOverlay reason={accessReason} featureLabel="AI Watchlist Generator" />
          )}
          <PromptInput
            label="Watchlist Generator"
            description="Describe a market theme or strategy and we'll generate a watchlist of matching stocks."
            placeholder="Type a market theme..."
            suggestions={INTELLIGENCE_PROMPT_SUGGESTIONS}
            suggestionAnimation="typewriter"
            maxLength={1200}
            value={prompt}
            onChange={(value) => {
              setPrompt(value);
              setGenerationError(null);
            }}
            onSubmit={canUseLLM ? handleGenerate : undefined}
            icon={<Terminal className="text-primary w-4 h-4" />}
            action={{
              label: "Generate",
              loadingLabel: "Synthesizing...",
              onClick: canUseLLM ? handleGenerate : undefined,
              isLoading: isGenerating,
              icon: <Zap className="w-3 h-3" />,
              loadingIcon: <RotateCw className="w-3 h-3 animate-spin" />,
            }}
            footer={
              <button
                type="button"
                onClick={() => setDeepResearchEnabled((prev) => !prev)}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] transition-colors ${deepResearchEnabled
                  ? "border-primary/50 bg-primary/10 text-primary"
                  : "border-border-color bg-surface text-muted hover:text-foreground"
                  }`}
              >
                <span className="material-symbols-outlined text-xs">
                  {deepResearchEnabled ? "psychology_alt" : "bolt"}
                </span>
                Deep Research {deepResearchEnabled ? "On" : "Off"}
              </button>
            }
          />
        </div>

        {generationError ? (
          <div className="bg-surface border border-risk-red/40 rounded-2xl p-5 text-sm leading-relaxed text-neon-red whitespace-pre-wrap break-words">
            {generationError}
          </div>
        ) : null}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Main Feed Column */}
          <div className="lg:col-span-8 space-y-6">

            {/* Empty State vs Analysis Feed */}
            {watchlists.length === 0 && !synthesis && !isGenerating ? (
              <div className="flex-1 flex flex-col items-center justify-center p-12 min-h-[400px]">
                <div className="max-w-md w-full text-center space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
                  <div className="relative mx-auto w-32 h-32 flex items-center justify-center bg-background-dark rounded-full border border-border-color">
                    <div className="absolute inset-0 bg-primary/5 rounded-full animate-pulse"></div>
                    <span className="material-symbols-outlined text-5xl text-muted relative z-10">satellite</span>
                    <div className="absolute -top-2 -right-2 w-10 h-10 bg-surface border border-border-color rounded-full flex items-center justify-center">
                      <span className="material-symbols-outlined text-primary text-sm font-bold">add</span>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <h1 className="text-3xl font-bold tracking-tight text-foreground">Create Your First Watchlist</h1>
                    <p className="text-muted text-base leading-relaxed">
                      Use AI to generate a watchlist from any strategy, or add stocks manually to start monitoring risk signals.
                    </p>
                  </div>
                  <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                    <button onClick={handleGenerate} className="flex items-center gap-2 px-8 h-12 bg-primary hover:bg-primary/90 text-white font-bold rounded-full transition-all shadow-lg shadow-primary/20 hover:shadow-primary/30 active:scale-95">
                      <span className="material-symbols-outlined text-xl">bolt</span>
                      <span>Generate with AI</span>
                    </button>
                    <button onClick={() => setIsEditModalOpen(true)} className="flex items-center gap-2 px-8 h-12 bg-transparent hover:bg-surface-highlight text-muted font-semibold rounded-full border border-border-color transition-all active:scale-95">
                      <span className="material-symbols-outlined text-xl">add</span>
                      <span>Add Stocks Manually</span>
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="space-y-4">
                  <div className="flex items-center justify-between px-1">
                    <h2 className="text-[11px] font-bold text-foreground flex items-center gap-2 uppercase tracking-[0.15em]">
                      <Sparkles className="w-4 h-4 text-primary" />
                      Synthesis Report
                    </h2>
                  </div>
                  <div className="bg-surface border border-border-color p-8 rounded-2xl relative overflow-hidden text-left">
                    {isGenerating ? (
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary">
                            {deepResearchEnabled ? 'Deep Research Running' : 'Synthesis Running'}
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
                            style={{ gridTemplateColumns: `repeat(${loadingSteps.length}, minmax(0, 1fr))` }}
                          >
                            {loadingSteps.map((_, index) => (
                              <div
                                key={`loading-step-${index}`}
                                className={`h-1.5 rounded-full transition-all duration-500 ${index === loadingStepIndex
                                  ? 'bg-primary'
                                  : index < loadingStepIndex
                                    ? 'bg-primary/40'
                                    : 'bg-border-color'
                                  }`}
                              />
                            ))}
                          </div>
                          <RotateCw className="h-3 w-3 animate-spin text-primary" />
                        </div>
                        <p className="text-[10px] text-muted">
                          Reasoning steps cycle while market and filing data loads.
                        </p>
                      </div>
                    ) : synthesis ? (
                      <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
                        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                          <h3 className="text-lg font-bold text-foreground tracking-tight">
                            Structural Risk: {synthesis.watchlistName}
                          </h3>
                          <div className="flex items-center gap-2">
                            <CopyButton
                              getText={() => synthesisShareText}
                              label="Copy"
                            />
                            <ShareDownloadButtons
                              content={synthesisShareText}
                              markdownContent={synthesisMarkdown}
                              pdfContent={synthesisMarkdown}
                              title={`Synthesis Report: ${synthesis.watchlistName}`}
                              filename={synthesisFilename}
                              variant="compact"
                              enableMarkdownExport
                              enablePdfExport
                            />
                            <button
                              type="button"
                              onClick={saveSynthesisAsWatchlist}
                              disabled={synthesis.tickers.length === 0}
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
                        {isSynthesisExpanded ? (
                          <div className="mb-4 space-y-4 text-sm text-muted leading-relaxed">
                            <p className="whitespace-pre-wrap">{annotateFinancialTerms(narrativeText)}</p>


                            {reasoningText && (
                              <div className="space-y-1">
                                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">
                                  Reasoning Trace {synthesis.model ? `(${synthesis.model})` : ''}
                                </p>
                                <p className="text-xs whitespace-pre-wrap">{annotateFinancialTerms(reasoningText)}</p>
                              </div>
                            )}

                            {synthesis.citations && synthesis.citations.length > 0 && (
                              <div className="space-y-1">
                                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
                                  Deep Research Context ({synthesis.citations.length})
                                </p>
                                <ul className="list-disc space-y-1 pl-4 text-xs">
                                  {synthesis.citations.slice(0, 4).map((citation, index) => (
                                    <li key={`${citation.source}-${index}`}>
                                      {citation.url ? (
                                        <a
                                          href={citation.url}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="font-semibold text-primary hover:underline"
                                        >
                                          {citation.title || citation.source}
                                        </a>
                                      ) : (
                                        <span className="font-semibold text-foreground">
                                          {citation.title || citation.source}
                                        </span>
                                      )}
                                      {citation.chunk ? `: ${cleanSynthesisText(citation.chunk)}` : ''}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {synthesis.tickerExplanations && synthesis.tickerExplanations.length > 0 && (
                              <div className="space-y-3">
                                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
                                  Stock Analysis ({synthesis.tickerExplanations.length})
                                </p>
                                {synthesis.tickerExplanations.map((item) => {
                                  const highlights: Array<{ label: string; value: string; positive?: boolean }> = [];
                                  if (typeof item.financialHighlights?.marketCap === 'number') {
                                    highlights.push({ label: 'Mkt Cap', value: formatCompactCurrency(item.financialHighlights.marketCap) });
                                  }
                                  if (typeof item.financialHighlights?.totalRevenue === 'number') {
                                    highlights.push({ label: 'Revenue', value: formatCompactCurrency(item.financialHighlights.totalRevenue) });
                                  }
                                  if (typeof item.financialHighlights?.netIncome === 'number') {
                                    const ni = item.financialHighlights.netIncome;
                                    highlights.push({ label: 'Net Income', value: formatCompactCurrency(ni), positive: ni > 0 });
                                  }
                                  if (typeof item.financialHighlights?.epsDiluted === 'number') {
                                    const eps = item.financialHighlights.epsDiluted;
                                    highlights.push({ label: 'EPS', value: eps.toFixed(2), positive: eps > 0 });
                                  }

                                  const tickerPrice = getLatestPrice(item.symbol);
                                  const changePct = getDailyChangePct(item.symbol);
                                  const logoUrl = getLogo(item.symbol);

                                  // Income change data
                                  const incomeChange = item.incomeChange;
                                  const revChg = typeof incomeChange?.revenueChange === 'number' ? incomeChange.revenueChange : null;
                                  const niChg = typeof incomeChange?.netIncomeChange === 'number' ? incomeChange.netIncomeChange : null;

                                  // News sentiment data
                                  const newsSentiment = item.newsSentiment;
                                  const sentimentAgg = newsSentiment?.aggregate;
                                  const sentimentArticles = newsSentiment?.articles ?? [];

                                  // Determine overall tone
                                  const isPositiveSentiment = sentimentAgg?.label === 'positive';
                                  const isNegativeSentiment = sentimentAgg?.label === 'negative';
                                  const hasUpside = isPositiveSentiment || (revChg !== null && revChg > 5) || (niChg !== null && niChg > 10);

                                  return (
                                    <div key={item.symbol} className="rounded-lg border border-border-color/60 bg-background-dark/50 p-4 space-y-3">
                                      {/* Stock header */}
                                      <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                          <HoverWrapper
                                            symbol={item.symbol}
                                            price={tickerPrice?.close ?? null}
                                            changePct={changePct}
                                            prices={prices}
                                            logoUrl={logoUrl}
                                            metadata={getMetadata(item.symbol)}
                                          >
                                            <div className="flex items-center gap-2">
                                              {logoUrl ? (
                                                <img src={logoUrl} alt="" className="h-6 w-6 rounded-full bg-white object-cover p-0.5" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                                              ) : (
                                                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-highlight text-[8px] font-bold text-muted">{item.symbol.slice(0, 2)}</div>
                                              )}
                                              <Link href={`/stock/${item.symbol}`} className="text-sm font-bold text-primary hover:underline">
                                                {item.symbol}
                                              </Link>
                                            </div>
                                          </HoverWrapper>
                                          {tickerPrice && (
                                            <span className="text-xs font-mono text-muted">${tickerPrice.close.toFixed(2)}</span>
                                          )}
                                          {changePct !== null && Number.isFinite(changePct) && (
                                            <span className={`text-xs font-mono font-semibold ${changePct >= 0 ? 'text-neon-green' : 'text-neon-red'}`}>
                                              {changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%
                                            </span>
                                          )}
                                        </div>
                                        {/* Sentiment / Outlook badge */}
                                        {sentimentAgg && typeof sentimentAgg.count === 'number' && sentimentAgg.count > 0 && (
                                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${isPositiveSentiment ? 'border border-neon-green/30 bg-neon-green/10 text-neon-green'
                                            : isNegativeSentiment ? 'border border-neon-red/30 bg-neon-red/10 text-neon-red'
                                              : 'border border-border-color bg-surface text-muted'
                                            }`}>
                                            <span className="material-symbols-outlined text-[11px]">
                                              {isPositiveSentiment ? 'trending_up' : isNegativeSentiment ? 'trending_down' : 'trending_flat'}
                                            </span>
                                            {hasUpside && !isNegativeSentiment ? 'Upside' : String(sentimentAgg.label)}
                                          </span>
                                        )}
                                      </div>

                                      {/* Thesis / rationale */}
                                      <p className="text-sm text-foreground leading-relaxed">
                                        {annotateFinancialTerms(cleanSynthesisText(item.rationale))}
                                      </p>

                                      {/* Key metrics pills */}
                                      {highlights.length > 0 && (
                                        <div className="flex flex-wrap gap-2">
                                          {highlights.map((h) => (
                                            <span key={h.label} className="inline-flex items-center gap-1 rounded-md border border-border-color/40 bg-surface/60 px-2 py-1 text-[10px]">
                                              <span className="text-muted">{h.label}</span>
                                              <span className={`font-semibold ${h.positive === true ? 'text-neon-green' : h.positive === false ? 'text-neon-red' : 'text-foreground'}`}>{h.value}</span>
                                            </span>
                                          ))}
                                          {/* QoQ changes */}
                                          {revChg !== null && (
                                            <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-semibold ${revChg >= 0 ? 'border-neon-green/30 bg-neon-green/5 text-neon-green' : 'border-neon-red/30 bg-neon-red/5 text-neon-red'}`}>
                                              Rev {revChg >= 0 ? '+' : ''}{revChg.toFixed(1)}% QoQ
                                            </span>
                                          )}
                                          {niChg !== null && (
                                            <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-semibold ${niChg >= 0 ? 'border-neon-green/30 bg-neon-green/5 text-neon-green' : 'border-neon-red/30 bg-neon-red/5 text-neon-red'}`}>
                                              NI {niChg >= 0 ? '+' : ''}{niChg.toFixed(1)}% QoQ
                                            </span>
                                          )}
                                        </div>
                                      )}

                                      {/* Filings */}
                                      {item.filings && item.filings.length > 0 && (
                                        <div className="flex items-center gap-2 text-[10px] text-muted">
                                          <span className="material-symbols-outlined text-[12px]">description</span>
                                          <span>SEC filings: </span>
                                          {item.filings.map((filing, fi) => {
                                            const label = [filing.form, filing.filingDate].filter(Boolean).join(' ');
                                            if (!label) return null;
                                            return (
                                              <React.Fragment key={fi}>
                                                {fi > 0 && <span className="text-border-color">·</span>}
                                                {filing.url ? (
                                                  <a href={filing.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{label}</a>
                                                ) : (
                                                  <span>{label}</span>
                                                )}
                                              </React.Fragment>
                                            );
                                          })}
                                        </div>
                                      )}

                                      {/* News - show actual headlines, not just sentiment label */}
                                      {sentimentArticles.length > 0 && (
                                        <div className="space-y-1.5">
                                          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted flex items-center gap-1">
                                            <span className="material-symbols-outlined text-[12px]">newspaper</span>
                                            Recent Headlines ({sentimentAgg?.count ?? sentimentArticles.length} articles)
                                          </p>
                                          {sentimentArticles.slice(0, 3).map((art, ai) => (
                                            <div key={ai} className="flex items-start gap-2 text-xs">
                                              <span className={`mt-0.5 text-[10px] ${art.sentiment === 'positive' ? 'text-neon-green'
                                                : art.sentiment === 'negative' ? 'text-neon-red'
                                                  : 'text-muted'
                                                }`}>
                                                <span className="material-symbols-outlined text-[12px]">
                                                  {art.sentiment === 'positive' ? 'arrow_upward' : art.sentiment === 'negative' ? 'arrow_downward' : 'remove'}
                                                </span>
                                              </span>
                                              <span className="text-foreground/80 leading-snug">{String(art.title ?? '')}</span>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        ) : (
                          <p className="mb-4 text-xs text-muted">
                            Synthesis text is collapsed. Expand text to view narrative, reasoning, and per-stock rationale.
                          </p>
                        )}

                        {synthesis.tickers && synthesis.tickers.length > 0 && (
                          <div className="space-y-3 border-t border-border-color pt-4">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <p className="text-[10px] font-bold text-muted uppercase tracking-wider">
                                Generated Tickers ({synthesis.tickers.length})
                              </p>
                              <div className="flex flex-wrap items-center gap-2">
                                <select
                                  value={targetWatchlistId}
                                  onChange={(event) => setTargetWatchlistId(event.target.value)}
                                  className="h-9 rounded-lg border border-border-color bg-background-dark pl-3 pr-8 text-[11px] text-foreground appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%23888%22%20stroke-width%3D%222%22%3E%3Cpath%20d%3D%22M6%209l6%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-[length:12px] bg-[right_8px_center] bg-no-repeat"
                                >
                                  <option value="">
                                    {watchlists.length === 0 ? 'Create a watchlist first' : 'Select watchlist (optional)'}
                                  </option>
                                  {watchlists.map((watchlist) => (
                                    <option key={watchlist.id} value={watchlist.id}>
                                      {watchlist.name}
                                    </option>
                                  ))}
                                </select>
                                <div className="flex items-center rounded-lg border border-border-color bg-background-dark">
                                  <input
                                    value={manualTicker}
                                    onChange={(event) => {
                                      setManualTicker(normalizeTickerSymbol(event.target.value));
                                      setManualTickerError(null);
                                    }}
                                    onKeyDown={(event) => {
                                      if (event.key === 'Enter') {
                                        event.preventDefault();
                                        addManualTicker();
                                      }
                                    }}
                                    placeholder="Add ticker"
                                    className="h-9 w-28 bg-transparent px-2 text-[11px] uppercase tracking-[0.1em] text-foreground outline-none"
                                  />
                                  <button
                                    type="button"
                                    onClick={addManualTicker}
                                    className="h-9 border-l border-border-color px-3 text-[10px] font-bold uppercase tracking-[0.1em] text-primary hover:bg-primary/10"
                                  >
                                    Add
                                  </button>
                                </div>
                              </div>
                            </div>
                            {manualTickerError ? (
                              <p className="text-[11px] text-neon-red">{manualTickerError}</p>
                            ) : null}
                            <p className="text-[10px] text-muted">
                              Prompt generation creates a new synthesis from scratch. Selecting a watchlist only controls quick add/remove.
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {synthesis.tickers.map((ticker) => {
                                const logoUrl = getLogo(ticker.symbol);
                                const price = getLatestPrice(ticker.symbol);
                                const changePct = getDailyChangePct(ticker.symbol);
                                const inTargetWatchlist = selectedTargetWatchlist
                                  ? isInWatchlist(selectedTargetWatchlist.id, ticker.symbol)
                                  : false;
                                return (
                                  <HoverWrapper
                                    key={ticker.symbol}
                                    symbol={ticker.symbol}
                                    price={price?.close ?? null}
                                    changePct={changePct}
                                    prices={prices}
                                    logoUrl={logoUrl}
                                    metadata={getMetadata(ticker.symbol)}
                                  >
                                    <div
                                      className="flex items-center gap-2 rounded-lg border border-border-color bg-background-dark px-3 py-2 transition-colors hover:border-primary/50"
                                    >
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
                                            {price ? `$${price.close.toFixed(2)}` : ticker.name}
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
                                        onClick={() => {
                                          if (!selectedTargetWatchlist) return;
                                          toggleTickerInWatchlist(selectedTargetWatchlist.id, ticker.symbol);
                                        }}
                                        disabled={!selectedTargetWatchlist}
                                        className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border-color text-muted hover:text-primary disabled:cursor-not-allowed disabled:opacity-60"
                                        title={
                                          selectedTargetWatchlist
                                            ? inTargetWatchlist
                                              ? `Remove ${ticker.symbol} from ${selectedTargetWatchlist.name}`
                                              : `Add ${ticker.symbol} to ${selectedTargetWatchlist.name}`
                                            : 'Select a watchlist first'
                                        }
                                      >
                                        <span className="material-symbols-outlined text-[12px] leading-none">
                                          {inTargetWatchlist ? 'playlist_remove' : 'playlist_add'}
                                        </span>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => removeTickerFromSynthesis(ticker.symbol)}
                                        className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border-color text-muted hover:bg-surface-highlight hover:text-foreground transition-colors"
                                        title={`Remove ${ticker.symbol} from synthesis`}
                                      >
                                        <span className="material-symbols-outlined text-[12px] leading-none">close</span>
                                      </button>
                                    </div>
                                  </HoverWrapper>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="text-sm text-muted opacity-90 leading-relaxed">
                        Market dynamics this morning are dominated by a sharp acceleration in the <span className="text-primary font-semibold">Yen Carry Trade unwinding</span>.
                        Use the prompt above to generate a new watchlist synthesis from scratch, then save it or add names into existing lists.
                      </p>
                    )}
                  </div>
                </div>

                {/* Market Synthesis Widget */}
                <MarketSynthesisWidget watchlists={watchlists} />

                {/* Activity Feed - hidden for now */}
                {/* <ActivityFeed /> */}

                {/* Market News Section */}
                <MarketNewsSection />
              </>
            )}
          </div>

          <div className="lg:col-span-4 space-y-6">
            <TopMoversWidget />
            <TreemapHeatmap />

            <div className="space-y-4">
              <div className="flex items-center justify-between px-1">
                <h3 className="font-bold text-foreground text-[11px] uppercase tracking-[0.15em]">Followed Stocks</h3>
                <span className="text-[10px] font-semibold text-muted uppercase tracking-wider">
                  {followed.length} tracked
                </span>
              </div>
              {followed.length === 0 ? (
                <div className="bg-surface border border-border-color rounded-2xl p-4 text-sm text-muted">
                  Follow stocks from any ticker page to track them here.
                </div>
              ) : (
                <div className="space-y-2">
                  {followed.map((symbol) => {
                    const logoUrl = getLogo(symbol);
                    const price = getLatestPrice(symbol);
                    return (
                      <div
                        key={symbol}
                        className="flex items-center justify-between bg-surface border border-border-color rounded-2xl px-3 py-2"
                      >
                        <Link href={`/stock/${symbol}`} className="flex items-center gap-3 min-w-0">
                          <div className="size-9 rounded-full bg-surface-highlight border border-border-color flex items-center justify-center overflow-hidden">
                            {logoUrl ? (
                              <img
                                src={logoUrl}
                                alt={`${symbol} logo`}
                                className="size-9 rounded-full object-cover"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).style.display = 'none';
                                }}
                              />
                            ) : (
                              <span className="text-[10px] font-bold text-muted">{symbol.slice(0, 2)}</span>
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-foreground">{symbol}</p>
                            <p className="text-[10px] text-muted truncate">
                              {price ? `$${price.close.toFixed(2)}` : "Price unavailable"}
                            </p>
                          </div>
                        </Link>
                        <button
                          onClick={() => toggleFollow(symbol)}
                          className="text-[10px] font-bold uppercase tracking-wider text-neon-red border border-risk-red/40 px-2.5 py-1 rounded-lg hover:bg-risk-red/10 transition-colors"
                        >
                          Unfollow
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="space-y-4">
              <div className="flex items-center justify-between px-1">
                <h3 className="font-bold text-foreground text-[11px] uppercase tracking-[0.15em]">Your Watchlists</h3>
                <button
                  onClick={() => setIsEditModalOpen(true)}
                  className="text-muted hover:text-foreground bg-surface p-1.5 rounded-full border border-border-color"
                >
                  <Plus className="w-3 h-3" />
                </button>
              </div>
              <div className="space-y-4">
                {watchlists.map(watchlist => (
                  <WatchlistCard
                    key={watchlist.id}
                    watchlist={watchlist}
                    onSelect={() => { setSelectedWatchlist(watchlist); setIsEditModalOpen(true); }}
                    onDelete={() => deleteWatchlist(watchlist.id)}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>

      <EditWatchlistModal
        isOpen={isEditModalOpen}
        onClose={() => { setIsEditModalOpen(false); setSelectedWatchlist(null); }}
        watchlist={selectedWatchlist}
        onSave={(name, tickers) => {
          if (selectedWatchlist) {
            setWatchlists(prev => prev.map(w => w.id === selectedWatchlist.id ? { ...w, name, tickers: tickers.map(s => ({ symbol: s, name: s, price: '$0.00', change: '0.0%', isPositive: true, riskScore: 50 })) } : w));
          } else {
            setWatchlists(prev => [{
              id: `w-${Date.now()}`,
              name,
              riskLevel: 'Stable',
              correlation: 0.5,
              dailyChange: '0.00%',
              tickers: tickers.map(s => ({ symbol: s, name: s, price: '$0.00', change: '0.0%', isPositive: true, riskScore: 50 }))
            }, ...prev]);
          }
        }}
        onDelete={deleteWatchlist}
      />
    </div>
  );
}
