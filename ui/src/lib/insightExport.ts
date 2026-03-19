export type ShareOrCopyResult =
  | { ok: true; mode: "shared" }
  | { ok: true; mode: "copied" }
  | { ok: false; mode: "cancelled" | "failed" };

export function safeFilenamePart(value: string, fallback = "insight") {
  const trimmed = value.trim();
  const normalized = trimmed
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80);

  return normalized || fallback;
}

export function formatDateForFilename(value?: Date | string | null) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "unknown-date";

  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(
    date.getMinutes()
  )}`;
}

export function downloadTextFile(filename: string, content: string, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for older browsers / permissions.
    try {
      const el = document.createElement("textarea");
      el.value = text;
      el.setAttribute("readonly", "");
      el.style.position = "fixed";
      el.style.left = "-9999px";
      el.style.top = "0";
      document.body.appendChild(el);
      el.select();
      const ok = document.execCommand("copy");
      el.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export async function shareOrCopy(payload: { title: string; text: string; url?: string }): Promise<ShareOrCopyResult> {
  const { title, text, url } = payload;

  if (typeof navigator !== "undefined" && "share" in navigator && typeof navigator.share === "function") {
    try {
      await navigator.share({ title, text, url });
      return { ok: true, mode: "shared" };
    } catch (err) {
      const maybeDomErr = err as { name?: string } | null;
      if (maybeDomErr?.name === "AbortError") {
        return { ok: false, mode: "cancelled" };
      }
      // Fall through to copy
    }
  }

  const payloadText = url ? `${text}\n\n${url}` : text;
  const copied = await copyToClipboard(payloadText);
  return copied ? { ok: true, mode: "copied" } : { ok: false, mode: "failed" };
}

export type DailyInsightsExport = {
  watchlistId?: string;
  watchlistName?: string;
  lastUpdated?: string | null;
  watchlistNarrative?: string | null;
  stockAnalyses?: Array<{
    ticker: string;
    calculatedAt?: string;
    volatility?: number;
    sharpe?: number;
    var95?: number;
    cvar95?: number;
    narrative?: string | null;
    relatedNewsCount?: number;
    sentiment?: string | null;
  }>;
};

export function formatDailyInsightsMarkdown(insights: DailyInsightsExport) {
  const title = insights.watchlistName?.trim() || insights.watchlistId?.trim() || "Watchlist";
  const updatedAt = insights.lastUpdated ? new Date(insights.lastUpdated) : null;
  const updatedLine =
    updatedAt && !Number.isNaN(updatedAt.getTime())
      ? `Updated: ${updatedAt.toLocaleString("en-US", {
          year: "numeric",
          month: "short",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        })}`
      : null;

  const lines: string[] = [];
  lines.push(`# Daily AI Insights: ${title}`);
  if (updatedLine) lines.push(updatedLine);
  lines.push("");

  if (insights.watchlistNarrative?.trim()) {
    lines.push("## Portfolio Overview");
    lines.push(insights.watchlistNarrative.trim());
    lines.push("");
  }

  const stocks = insights.stockAnalyses ?? [];
  if (stocks.length) {
    lines.push(`## Stock Analysis (${stocks.length})`);
    for (const stock of stocks) {
      lines.push("");
      lines.push(`### ${stock.ticker}`);
      if (stock.sentiment) lines.push(`Sentiment: ${stock.sentiment}`);
      if (typeof stock.relatedNewsCount === "number") lines.push(`Related news: ${stock.relatedNewsCount}`);
      if (typeof stock.volatility === "number") lines.push(`Volatility: ${(stock.volatility * 100).toFixed(2)}%`);
      if (typeof stock.sharpe === "number") lines.push(`Sharpe: ${stock.sharpe.toFixed(2)}`);
      if (typeof stock.var95 === "number") lines.push(`VaR 95%: ${(stock.var95 * 100).toFixed(2)}%`);
      if (typeof stock.cvar95 === "number") lines.push(`CVaR 95%: ${(stock.cvar95 * 100).toFixed(2)}%`);
      if (stock.calculatedAt) lines.push(`Calculated at: ${stock.calculatedAt}`);
      if (stock.narrative?.trim()) {
        lines.push("");
        lines.push(stock.narrative.trim());
      }
    }
    lines.push("");
  }

  return lines.join("\n").trim() + "\n";
}

export type MarketSynthesisExport = {
  synthesis?: string;
  timestamp?: string;
  source?: string;
  key_stats?: {
    sp500_change?: number;
    nasdaq_change?: number;
    dow_change?: number;
    vix?: number;
  };
};

export function formatMarketSynthesisMarkdown(
  synthesis: MarketSynthesisExport,
  derivedInsights?: Array<{ label: string; value: string }>
) {
  const lines: string[] = [];
  lines.push("# Market Overview");

  if (synthesis.timestamp) {
    const ts = new Date(synthesis.timestamp);
    if (!Number.isNaN(ts.getTime())) {
      lines.push(
        `Generated: ${ts.toLocaleString("en-US", {
          year: "numeric",
          month: "short",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        })}`
      );
    }
  }

  if (synthesis.source) lines.push(`Source: ${synthesis.source}`);
  lines.push("");

  const stats = synthesis.key_stats ?? {};
  const statLines: string[] = [];
  if (typeof stats.sp500_change === "number") statLines.push(`- S&P 500: ${stats.sp500_change >= 0 ? "+" : ""}${stats.sp500_change.toFixed(2)}%`);
  if (typeof stats.nasdaq_change === "number") statLines.push(`- NASDAQ: ${stats.nasdaq_change >= 0 ? "+" : ""}${stats.nasdaq_change.toFixed(2)}%`);
  if (typeof stats.dow_change === "number") statLines.push(`- DOW: ${stats.dow_change >= 0 ? "+" : ""}${stats.dow_change.toFixed(2)}%`);
  if (typeof stats.vix === "number") statLines.push(`- VIX: ${stats.vix.toFixed(2)}`);

  if (statLines.length) {
    lines.push("## Key Stats");
    lines.push(...statLines);
    lines.push("");
  }

  if (derivedInsights && derivedInsights.length) {
    lines.push("## Insights");
    for (const item of derivedInsights) lines.push(`- ${item.label}: ${item.value}`);
    lines.push("");
  }

  if (synthesis.synthesis?.trim()) {
    lines.push("## Synthesis");
    lines.push(synthesis.synthesis.trim());
    lines.push("");
  }

  return lines.join("\n").trim() + "\n";
}

export type StrategySynthesisExport = {
  prompt?: string;
  watchlistName?: string;
  narrative?: string;
  tickers?: Array<{ symbol?: string; name?: string; riskScore?: number }>;
};

export function formatStrategySynthesisMarkdown(synthesis: StrategySynthesisExport) {
  const name = synthesis.watchlistName?.trim() || "Strategy Watchlist";
  const lines: string[] = [];
  lines.push(`# Synthesis Report: ${name}`);
  lines.push("");
  if (synthesis.prompt?.trim()) {
    lines.push("## Prompt");
    lines.push(synthesis.prompt.trim());
    lines.push("");
  }
  if (synthesis.narrative?.trim()) {
    lines.push("## Narrative");
    lines.push(synthesis.narrative.trim());
    lines.push("");
  }

  const tickers = synthesis.tickers ?? [];
  if (tickers.length) {
    lines.push(`## Generated Tickers (${tickers.length})`);
    for (const ticker of tickers) {
      const symbol = ticker.symbol?.trim();
      if (!symbol) continue;
      const parts = [symbol];
      if (ticker.name) parts.push(`(${ticker.name})`);
      if (typeof ticker.riskScore === "number") parts.push(`riskScore=${ticker.riskScore}`);
      lines.push(`- ${parts.join(" ")}`);
    }
    lines.push("");
  }

  return lines.join("\n").trim() + "\n";
}

export type HistoryExportItem = {
  id?: string;
  kind?: string;
  createdAt?: string;
  title?: string | null;
  prompt?: string | null;
  watchlistId?: string | null;
  watchlistName?: string | null;
  tickers?: string[];
  payload?: string;
};

export function formatHistoryItemMarkdown(args: {
  item: HistoryExportItem;
  label?: string;
  preview?: string;
}) {
  const { item, label, preview } = args;
  const title = (item.title || item.watchlistName || label || "History Item").toString().trim();

  const lines: string[] = [];
  lines.push(`# ${title}`);
  if (label || item.kind) lines.push(`Type: ${label ?? item.kind}`);
  if (item.createdAt) {
    const created = new Date(item.createdAt);
    if (!Number.isNaN(created.getTime())) {
      lines.push(
        `Created: ${created.toLocaleString("en-US", {
          year: "numeric",
          month: "short",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        })}`
      );
    }
  }
  if (item.watchlistId || item.watchlistName) {
    lines.push(`Watchlist: ${item.watchlistName || item.watchlistId}`);
  }
  if (item.tickers && item.tickers.length) lines.push(`Tickers: ${item.tickers.join(", ")}`);
  lines.push("");

  if (item.prompt?.trim()) {
    lines.push("## Prompt");
    lines.push(item.prompt.trim());
    lines.push("");
  }

  if (preview?.trim()) {
    lines.push("## Output (Preview)");
    lines.push(preview.trim());
    lines.push("");
  }

  if (item.payload?.trim()) {
    lines.push("## Raw Payload");
    lines.push("```");
    lines.push(item.payload.trim());
    lines.push("```");
    lines.push("");
  }

  return lines.join("\n").trim() + "\n";
}

