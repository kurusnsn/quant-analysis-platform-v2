"use client";

import { useMemo, useState } from "react";
import type { MarketSynthesisResponse } from "@/hooks/useMarketSynthesis";
import { annotateFinancialTerms } from "@/lib/financialTerms";

type MarketSynthesisProps = {
  synthesis: MarketSynthesisResponse;
  summary?: string;
  bullets?: string[];
  title?: string;
  copyText?: string;
  showCopy?: boolean;
  variant?: "prose" | "card";
  className?: string;
};

const formatInsightText = (text: string) =>
  text
    .replace(/\*\*(.+?)\*\*/g, "\n$1\n")
    .replace(/\r?\n{2,}/g, "\n")
    .trim();

const extractBullets = (text: string) =>
  formatInsightText(text)
    .replace(/\*\*/g, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\d+\.\s*/, "").trim())
    .filter((line) => line.length > 0)
    .map((line) => line.replace(/^\-\s*/, ""));

export default function MarketSynthesis({
  synthesis,
  summary,
  bullets,
  title = "Market Summary",
  copyText,
  showCopy = true,
  variant = "prose",
  className,
}: MarketSynthesisProps) {
  const [copied, setCopied] = useState(false);

  const resolvedBullets = useMemo(() => {
    if (bullets && bullets.length > 0) {
      return bullets.filter(
        (line): line is string => typeof line === "string" && line.trim().length > 0
      );
    }
    if (variant === "prose") return [];
    if (!synthesis?.synthesis) return [];
    return extractBullets(synthesis.synthesis);
  }, [bullets, synthesis, variant]);

  const resolvedSummary =
    summary !== undefined
      ? summary
      : variant === "prose"
      ? synthesis.synthesis
      : resolvedBullets.length
      ? ""
      : synthesis.synthesis;

  const handleCopy = async () => {
    const payload = copyText ?? synthesis?.synthesis;
    if (!payload) return;
    try {
      await navigator.clipboard.writeText(payload);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const containerClass =
    variant === "card"
      ? `bg-surface/60 border border-border-color/40 rounded-lg p-4 ${className ?? ""}`
      : `prose prose-sm prose-invert max-w-none ${className ?? ""}`;

  return (
    <div className={containerClass}>
      {variant === "card" ? (
        <div className="flex items-center justify-between mb-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">{title}</p>
          {showCopy ? (
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 text-[10px] text-muted hover:text-primary transition-colors"
              title="Copy summary"
            >
              <span className="material-symbols-outlined text-sm">
                {copied ? "check_circle" : "content_copy"}
              </span>
              {copied ? "Copied" : "Copy"}
            </button>
          ) : null}
        </div>
      ) : showCopy ? (
        <div className="flex items-center justify-end mb-2">
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 text-[10px] text-muted hover:text-primary transition-colors"
            title="Copy summary"
          >
            <span className="material-symbols-outlined text-sm">
              {copied ? "check_circle" : "content_copy"}
            </span>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      ) : null}
      {resolvedSummary ? (
        <p
          className={`text-sm text-foreground leading-relaxed whitespace-pre-line ${
            resolvedBullets.length > 0 ? "mb-3" : ""
          }`}
        >
          {annotateFinancialTerms(resolvedSummary)}
        </p>
      ) : null}
      {resolvedBullets.length > 0 ? (
        <ul className="text-sm text-foreground leading-relaxed list-disc pl-4 space-y-2">
          {resolvedBullets.map((line, idx) => (
            <li key={`${idx}-${line.slice(0, 12)}`}>{annotateFinancialTerms(line)}</li>
          ))}
        </ul>
      ) : !resolvedSummary ? (
        <p className="text-sm text-foreground leading-relaxed whitespace-pre-line">
          {annotateFinancialTerms(synthesis.synthesis)}
        </p>
      ) : null}
    </div>
  );
}
