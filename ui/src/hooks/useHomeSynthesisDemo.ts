"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MarketSynthesisResponse } from "@/hooks/useMarketSynthesis";
import {
  getLandingDemoForPrompt,
  loadLandingDemoLibrary,
  type LandingDemoSynthesis,
  type DemoTicker,
  type DemoTickerExplanation,
} from "@/lib/landingDemoCache";

type DemoState = "idle" | "generating" | "streaming" | "completed";

export const DEMO_LOADING_STEPS = [
  "Parsing your strategy intent...",
  "Screening liquid large-cap candidates...",
  "Running quant scoring across candidates...",
  "Composing synthesis narrative...",
];

const DEFAULT_PROMPT = "";

const randomDelay = () => 30 + Math.floor(Math.random() * 51);

const buildBaseSynthesis = (demo: LandingDemoSynthesis): MarketSynthesisResponse => ({
  synthesis: demo.summary,
  timestamp: demo.savedAt || new Date().toISOString(),
  key_stats: demo.keyStats ?? {},
  source: demo.source === "homepage" ? "Homepage cache" : "Demo",
});

export function useHomeSynthesisDemo() {
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [state, setState] = useState<DemoState>("idle");
  const [summary, setSummary] = useState("");
  const [bullets, setBullets] = useState<string[]>([]);
  const [loadingStepIndex, setLoadingStepIndex] = useState(0);
  const [demoLibrary, setDemoLibrary] = useState<Record<string, LandingDemoSynthesis>>(() =>
    loadLandingDemoLibrary()
  );
  const [activeDemo, setActiveDemo] = useState<LandingDemoSynthesis>(() =>
    getLandingDemoForPrompt(DEFAULT_PROMPT, loadLandingDemoLibrary())
  );
  const [baseSynthesis, setBaseSynthesis] = useState<MarketSynthesisResponse | null>(null);

  const timersRef = useRef<number[]>([]);
  const runIdRef = useRef(0);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current = [];
  }, []);

  useEffect(() => () => clearTimers(), [clearTimers]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const syncFromStorage = () => {
      setDemoLibrary(loadLandingDemoLibrary());
    };

    window.addEventListener("storage", syncFromStorage);
    return () => window.removeEventListener("storage", syncFromStorage);
  }, []);

  const start = useCallback(() => {
    if (!prompt.trim()) return;

    clearTimers();
    runIdRef.current += 1;
    const runId = runIdRef.current;

    const demo = getLandingDemoForPrompt(prompt, demoLibrary);
    setActiveDemo(demo);
    setSummary("");
    setBullets([]);
    setLoadingStepIndex(0);
    setBaseSynthesis(buildBaseSynthesis(demo));
    setState("generating");

    const schedule = (fn: () => void, delay: number) => {
      const timer = window.setTimeout(() => {
        if (runIdRef.current !== runId) return;
        fn();
      }, delay);
      timersRef.current.push(timer);
    };

    // Cycle through loading steps before streaming starts
    const STEP_DURATION_MS = 650;
    DEMO_LOADING_STEPS.forEach((_, index) => {
      schedule(() => setLoadingStepIndex(index), index * STEP_DURATION_MS);
    });
    const streamStartDelay = DEMO_LOADING_STEPS.length * STEP_DURATION_MS + 100;

    const insightLines = demo.insights;
    const words = demo.summary.split(/\s+/).filter(Boolean);

    if (words.length === 0 && insightLines.length === 0) {
      schedule(() => setState("completed"), streamStartDelay);
      return;
    }

    let wordIndex = 0;
    let bulletIndex = 0;

    const streamBullets = () => {
      if (bulletIndex >= insightLines.length) {
        setState("completed");
        return;
      }
      setBullets((prev) => [...prev, insightLines[bulletIndex]]);
      bulletIndex += 1;
      schedule(streamBullets, randomDelay());
    };

    const streamSummary = () => {
      if (wordIndex >= words.length) {
        if (insightLines.length === 0) {
          setState("completed");
          return;
        }
        schedule(streamBullets, randomDelay());
        return;
      }
      setSummary((prev) => (prev ? `${prev} ${words[wordIndex]}` : words[wordIndex]));
      wordIndex += 1;
      schedule(streamSummary, randomDelay());
    };

    schedule(() => {
      setState("streaming");
      streamSummary();
    }, streamStartDelay);
  }, [clearTimers, demoLibrary, prompt]);

  const synthesis = useMemo(() => {
    if (!baseSynthesis) return null;
    const combined = [summary, ...bullets.map((line) => `- ${line}`)].filter(Boolean).join("\n");
    return { ...baseSynthesis, synthesis: combined };
  }, [baseSynthesis, summary, bullets]);

  return {
    prompt,
    setPrompt,
    state,
    start,
    synthesis,
    summary,
    bullets,
    activeDemo,
    loadingStepIndex,
    loadingSteps: DEMO_LOADING_STEPS,
    watchlistName: activeDemo.watchlistName,
    reasoning: activeDemo.reasoning ?? null,
    model: activeDemo.model ?? null,
    tickers: (activeDemo.tickers ?? []) as DemoTicker[],
    tickerExplanations: (activeDemo.tickerExplanations ?? []) as DemoTickerExplanation[],
  };
}
