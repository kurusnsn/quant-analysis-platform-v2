import React from "react";

const FINANCIAL_TERM_GLOSSARY = [
  {
    term: "8-K",
    definition:
      "SEC current report filed for material events (e.g., earnings releases, guidance, deals, major risks).",
    pattern: "\\b8-K\\b",
  },
  {
    term: "10-Q",
    definition:
      "SEC quarterly report with interim financial statements and management discussion (MD&A).",
    pattern: "\\b10-Q\\b",
  },
  {
    term: "10-K",
    definition:
      "SEC annual report with full-year financials, risk factors, and detailed business overview.",
    pattern: "\\b10-K\\b",
  },
  {
    term: "Delta",
    definition: "How much an option price moves for a $1 move in the underlying stock.",
    pattern: "\\bDelta\\b",
  },
  {
    term: "Gamma",
    definition: "How quickly Delta changes as the stock price moves.",
    pattern: "\\bGamma\\b",
  },
  {
    term: "Theta",
    definition: "Estimated option value decay from one day of time passing.",
    pattern: "\\bTheta\\b",
  },
  {
    term: "Vega",
    definition: "How much an option price changes when implied volatility changes by 1%.",
    pattern: "\\bVega\\b",
  },
  {
    term: "Rho",
    definition: "How much an option price changes when interest rates change by 1%.",
    pattern: "\\bRho\\b",
  },
  {
    term: "Sharpe",
    definition: "Risk-adjusted return: higher means better return per unit of volatility.",
    pattern: "\\bSharpe\\b",
  },
  {
    term: "VaR",
    definition:
      "Value at Risk: estimated loss threshold under normal conditions at a confidence level.",
    pattern: "\\bVaR",
  },
  {
    term: "CVaR",
    definition: "Expected average loss when losses are worse than VaR (tail-risk view).",
    pattern: "\\bCVaR",
  },
  {
    term: "Volatility",
    definition: "How much prices fluctuate; higher volatility usually means wider price swings.",
    pattern: "\\bVolatility\\b",
  },
  {
    term: "Regime",
    definition: "Current market environment label (e.g., calm, trending, high-volatility).",
    pattern: "\\bRegime\\b",
  },
  {
    term: "QoQ",
    definition: "Quarter-over-quarter: comparing a metric to the previous quarter.",
    pattern: "\\bQoQ\\b",
  },
  {
    term: "YoY",
    definition: "Year-over-year: comparing a metric to the same period last year.",
    pattern: "\\bYoY\\b",
  },
  {
    term: "EPS",
    definition: "Earnings per share: net income divided by shares outstanding.",
    pattern: "\\bEPS\\b",
  },
  {
    term: "P/E",
    definition: "Price-to-earnings ratio: stock price divided by earnings per share.",
    pattern: "\\bP/E\\b",
  },
  {
    term: "Market Cap",
    definition: "Total market value of a company's outstanding shares.",
    pattern: "\\bMarket Cap\\b",
  },
] as const;

const definitionByKey = new Map(
  FINANCIAL_TERM_GLOSSARY.map((item) => [item.term.toLowerCase(), item.definition])
);

const combinedRegexSource = FINANCIAL_TERM_GLOSSARY.map((item) => item.pattern).join("|");

// Sentiment words for color-coding
const POSITIVE_WORDS = new Set([
  "bullish", "growth", "upside", "gain", "gains", "rally", "rallied", "rallies",
  "surge", "surged", "surges", "outperform", "outperforms", "upgrade", "upgraded",
  "beat", "beats", "exceeded", "strong", "strength", "positive", "recovery",
  "recovered", "breakout", "momentum", "accumulate", "opportunity", "catalyst",
  "tailwind", "tailwinds", "expansion", "expanding", "accelerating",
]);
const NEGATIVE_WORDS = new Set([
  "bearish", "decline", "declined", "declines", "downside", "loss", "losses",
  "sell-off", "selloff", "crash", "plunge", "plunged",
  "underperform", "underperforms", "downgrade", "downgraded", "miss", "missed",
  "weak", "weakness", "negative", "correction", "breakdown", "headwind",
  "headwinds", "warning", "caution", "contraction", "contracting", "decelerating",
]);

// Combined regex: financial terms | signed percentages | sentiment words
const sentimentWordPattern = `\\b(?:${[...POSITIVE_WORDS, ...NEGATIVE_WORDS].join("|")})\\b`;
const percentPattern = `[+-]?\\d+(?:\\.\\d+)?%`;
const fullRegexSource = `${combinedRegexSource}|${percentPattern}|${sentimentWordPattern}`;

function TermTooltip({ term, definition, children }: { term: string; definition: string; children: React.ReactNode }) {
  return (
    <span className="relative inline-block group/term">
      <span className="cursor-help border-b border-dotted border-primary/50 text-foreground">
        {children}
      </span>
      <span
        className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 w-max max-w-[280px] rounded-2xl border border-border-color bg-surface px-3 py-2 text-xs text-foreground leading-relaxed shadow-xl opacity-0 group-hover/term:opacity-100 transition-opacity duration-150"
        role="tooltip"
      >
        <span className="font-bold text-primary">{term}</span>
        <span className="text-muted"> — </span>
        <span>{definition}</span>
        <span className="absolute top-full left-1/2 -translate-x-1/2 -mt-px border-4 border-transparent border-t-surface" />
      </span>
    </span>
  );
}

export function annotateFinancialTerms(text: string) {
  if (!text) return text;

  const regex = new RegExp(fullRegexSource, "gi");
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;

    if (start > lastIndex) {
      nodes.push(text.slice(lastIndex, start));
    }

    const matched = match[0];

    // Check if it's a financial term
    const definition = definitionByKey.get(matched.toLowerCase());
    if (definition) {
      nodes.push(
        <TermTooltip key={`term-${start}-${matched}`} term={matched} definition={definition}>
          {matched}
        </TermTooltip>
      );
    }
    // Check if it's a percentage
    else if (matched.endsWith("%")) {
      const num = parseFloat(matched);
      const colorClass = num > 0 ? "text-neon-green" : num < 0 ? "text-neon-red" : "";
      nodes.push(
        <span key={`pct-${start}`} className={`font-semibold ${colorClass}`}>
          {matched}
        </span>
      );
    }
    // Check if it's a sentiment word
    else if (POSITIVE_WORDS.has(matched.toLowerCase())) {
      nodes.push(
        <span key={`pos-${start}`} className="text-neon-green font-medium">
          {matched}
        </span>
      );
    } else if (NEGATIVE_WORDS.has(matched.toLowerCase())) {
      nodes.push(
        <span key={`neg-${start}`} className="text-neon-red font-medium">
          {matched}
        </span>
      );
    } else {
      nodes.push(matched);
    }

    lastIndex = end;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes.length ? nodes : text;
}
