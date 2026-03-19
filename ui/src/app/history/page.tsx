"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Header } from "@/components/Header";
import ShareDownloadButtons from "@/components/ShareDownloadButtons";
import { useRouter } from "next/navigation";
import { useHistory, type HistoryItem } from "@/hooks/useHistory";
import { useSearchHistory } from "@/hooks/useSearchHistory";

type KindOption = { value: string; label: string; icon: string };

const KIND_OPTIONS: KindOption[] = [
  { value: "", label: "All Activity", icon: "schedule" },
  { value: "watchlist_generate", label: "Watchlist Synthesis", icon: "auto_awesome" },
  { value: "watchlist_analyze", label: "Watchlist Analysis", icon: "query_stats" },
  { value: "market_overview", label: "Market Overview", icon: "insights" },
  { value: "asset_analyze", label: "Ticker Overview", icon: "monitoring" },
];

const coerceDateRange = (from: string, to: string) => {
  if (!from && !to) return { from: undefined, to: undefined };
  const fromIso = from ? `${from}T00:00:00Z` : undefined;
  const toIso = to ? `${to}T23:59:59Z` : undefined;
  return { from: fromIso, to: toIso };
};

const safeParseJson = (value: string) => {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
};

const extractPreview = (item: HistoryItem) => {
  const parsed = typeof item.payload === "string" ? safeParseJson(item.payload) : null;
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    const narrative = obj.narrative ?? obj.Narrative;
    if (typeof narrative === "string" && narrative.trim()) return narrative;
    const synthesis = obj.synthesis ?? obj.Synthesis;
    if (typeof synthesis === "string" && synthesis.trim()) return synthesis;
  }

  if (typeof item.payload === "string" && item.payload.trim()) return item.payload;
  return "";
};

const kindMeta = (kind: string): KindOption => {
  return (
    KIND_OPTIONS.find((option) => option.value === kind) ?? {
      value: kind,
      label: kind || "Unknown",
      icon: "description",
    }
  );
};

export default function HistoryPage() {
  const router = useRouter();
  const { history: searchHistory, clearHistory } = useSearchHistory();
  const [kind, setKind] = useState("");
  const [watchlistId, setWatchlistId] = useState("");
  const [ticker, setTicker] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const tickerNormalized = useMemo(() => ticker.trim().toUpperCase(), [ticker]);
  const tickerValid = useMemo(() => {
    if (!tickerNormalized) return true;
    return /^[A-Z0-9.^-]{1,10}$/.test(tickerNormalized);
  }, [tickerNormalized]);

  const dateRange = useMemo(() => coerceDateRange(fromDate, toDate), [fromDate, toDate]);

  const filters = useMemo(
    () => ({
      kind: kind || undefined,
      watchlistId: watchlistId || undefined,
      ticker: tickerValid && tickerNormalized ? tickerNormalized : undefined,
      from: dateRange.from,
      to: dateRange.to,
      page,
      pageSize,
    }),
    [kind, watchlistId, tickerValid, tickerNormalized, dateRange.from, dateRange.to, page]
  );

  const { data, loading, error, refetch } = useHistory(filters);

  const watchlistOptions = useMemo(() => {
    const items = data?.items ?? [];
    const map = new Map<string, string>();
    for (const item of items) {
      if (!item.watchlistId) continue;
      const label = item.watchlistName || item.watchlistId;
      map.set(item.watchlistId, label);
    }
    return Array.from(map.entries())
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [data?.items]);

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const items = data?.items ?? [];

  const canPrev = page > 1;
  const canNext = page < totalPages;

  const handlePrev = () => setPage((p) => Math.max(1, p - 1));
  const handleNext = () => setPage((p) => Math.min(totalPages, p + 1));

  return (
    <div className="min-h-screen flex flex-col bg-background-dark font-sans">
      <Header />

      <main className="flex-1 max-w-[1550px] mx-auto w-full p-6 space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">History</h1>
            <p className="text-xs text-muted">
              Browse your generated market overviews, ticker overviews, and watchlist analyses.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => refetch()}
              className="h-10 px-4 rounded-2xl border border-border-color bg-surface hover:bg-surface-highlight text-xs font-bold uppercase tracking-wider text-foreground transition-colors"
            >
              Refresh
            </button>
          </div>
        </div>

        {/* Recent Searches */}
        {searchHistory.length > 0 && (
          <div className="bg-surface border border-border-color rounded-2xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted flex items-center gap-2">
                <span className="material-symbols-outlined !text-[16px] text-primary">manage_search</span>
                Recent Searches
              </h2>
              <button
                type="button"
                onClick={clearHistory}
                className="text-[10px] font-bold uppercase tracking-wider text-muted hover:text-foreground transition-colors"
              >
                Clear
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {searchHistory.map((item) => (
                <button
                  key={item.timestamp}
                  type="button"
                  onClick={() => router.push(`/?prompt=${encodeURIComponent(item.prompt)}`)}
                  className="group flex items-center gap-2 rounded-lg border border-border-color bg-background-dark px-3 py-2 text-left transition-colors hover:border-primary/50"
                >
                  <span className="material-symbols-outlined !text-[14px] text-muted group-hover:text-primary">
                    {item.deepResearch ? "psychology_alt" : "bolt"}
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-foreground truncate max-w-[220px]">
                      {item.prompt}
                    </p>
                    <p className="text-[10px] text-muted">
                      {new Date(item.timestamp).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {item.watchlistName ? ` · ${item.watchlistName}` : ""}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="bg-surface border border-border-color rounded-2xl p-4">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
            <div className="md:col-span-3">
              <label className="block text-[10px] font-bold uppercase tracking-wider text-muted mb-1">
                Type
              </label>
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-muted !text-[18px]">
                  {kindMeta(kind).icon}
                </span>
                <select
                  value={kind}
                  onChange={(e) => {
                    setKind(e.target.value);
                    setPage(1);
                  }}
                  className="w-full h-10 pl-10 pr-3 rounded-lg border border-border-color bg-background-dark text-foreground text-sm outline-none focus:ring-1 focus:ring-primary focus:border-primary"
                >
                  {KIND_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="md:col-span-3">
              <label className="block text-[10px] font-bold uppercase tracking-wider text-muted mb-1">
                Watchlist
              </label>
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-muted !text-[18px]">
                  list_alt
                </span>
                <select
                  value={watchlistId}
                  onChange={(e) => {
                    setWatchlistId(e.target.value);
                    setPage(1);
                  }}
                  className="w-full h-10 pl-10 pr-3 rounded-lg border border-border-color bg-background-dark text-foreground text-sm outline-none focus:ring-1 focus:ring-primary focus:border-primary"
                >
                  <option value="">All watchlists</option>
                  {watchlistOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="md:col-span-2">
              <label className="block text-[10px] font-bold uppercase tracking-wider text-muted mb-1">
                Stock (Ticker)
              </label>
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-muted !text-[18px]">
                  search
                </span>
                <input
                  value={ticker}
                  onChange={(e) => {
                    setTicker(e.target.value);
                    setPage(1);
                  }}
                  placeholder="AAPL"
                  className={`w-full h-10 pl-10 pr-3 rounded-lg border bg-background-dark text-foreground text-sm outline-none focus:ring-1 focus:ring-primary focus:border-primary ${tickerValid ? "border-border-color" : "border-risk-red/60"}`}
                />
              </div>
              {!tickerValid ? (
                <p className="mt-1 text-[10px] text-neon-red">
                  Invalid ticker format (A-Z, 0-9, . ^ -; max 10 chars).
                </p>
              ) : null}
            </div>

            <div className="md:col-span-2">
              <label className="block text-[10px] font-bold uppercase tracking-wider text-muted mb-1">
                From
              </label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => {
                  setFromDate(e.target.value);
                  setPage(1);
                }}
                className="w-full h-10 px-3 rounded-lg border border-border-color bg-background-dark text-foreground text-sm outline-none focus:ring-1 focus:ring-primary focus:border-primary"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-[10px] font-bold uppercase tracking-wider text-muted mb-1">
                To
              </label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => {
                  setToDate(e.target.value);
                  setPage(1);
                }}
                className="w-full h-10 px-3 rounded-lg border border-border-color bg-background-dark text-foreground text-sm outline-none focus:ring-1 focus:ring-primary focus:border-primary"
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between text-xs text-muted">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-foreground">{total}</span>
            <span>items</span>
            {loading ? <span className="opacity-70">(loading)</span> : null}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrev}
              disabled={!canPrev}
              className="h-9 px-3 rounded-2xl border border-border-color bg-surface hover:bg-surface-highlight disabled:opacity-40 disabled:hover:bg-surface text-foreground transition-colors"
            >
              Prev
            </button>
            <span className="tabular-nums">
              Page {page} / {totalPages}
            </span>
            <button
              type="button"
              onClick={handleNext}
              disabled={!canNext}
              className="h-9 px-3 rounded-2xl border border-border-color bg-surface hover:bg-surface-highlight disabled:opacity-40 disabled:hover:bg-surface text-foreground transition-colors"
            >
              Next
            </button>
          </div>
        </div>

        {error ? (
          <div className="bg-surface border border-border-color rounded-2xl p-8 text-center">
            <span className="material-symbols-outlined text-4xl text-muted mb-2">error</span>
            <p className="text-sm text-muted">{error}</p>
            <button
              type="button"
              onClick={() => refetch()}
              className="mt-4 h-10 px-4 rounded-lg bg-primary text-white font-bold text-xs uppercase tracking-wider"
            >
              Try again
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="bg-surface border border-border-color rounded-2xl p-10 text-center">
            <span className="material-symbols-outlined text-4xl text-muted mb-3">history</span>
            <p className="text-sm text-muted">No history items found for these filters.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {items.map((item) => {
              const meta = kindMeta(item.kind);
              const preview = extractPreview(item);
              const createdAt = new Date(item.createdAt);
              const tickers = item.tickers ?? [];
              const tickerLimit = 16;
              const shown = tickers.slice(0, tickerLimit);
              const remaining = tickers.length - shown.length;

              return (
                <div
                  key={item.id}
                  className="bg-surface border border-border-color rounded-2xl p-6"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-primary !text-[20px]">
                          {meta.icon}
                        </span>
                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted">
                          {meta.label}
                        </p>
                        {preview && (
                          <ShareDownloadButtons
                            content={preview}
                            title={item.title || item.watchlistName || meta.label}
                            filename={`${item.kind}-${createdAt.toISOString().slice(0, 10)}`}
                            variant="compact"
                          />
                        )}
                      </div>

                      <h3 className="mt-2 text-sm font-bold text-foreground truncate">
                        {item.title || item.watchlistName || meta.label}
                      </h3>

                      <p className="mt-1 text-[11px] text-muted">
                        {createdAt.toLocaleString("en-US", {
                          year: "numeric",
                          month: "short",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>

                      {item.watchlistId ? (
                        <p className="mt-2 text-[11px] text-muted">
                          Watchlist:{" "}
                          <Link
                            href={`/watchlist/${item.watchlistId}`}
                            className="text-primary hover:text-primary/80"
                          >
                            {item.watchlistName || item.watchlistId}
                          </Link>
                        </p>
                      ) : null}
                    </div>

                    {tickers.length > 0 ? (
                      <div className="flex flex-wrap gap-2 justify-start sm:justify-end">
                        {shown.map((symbol) => (
                          <Link
                            key={symbol}
                            href={`/stock/${symbol}`}
                            className="px-2.5 py-1 rounded-full border border-border-color bg-background-dark text-[10px] font-bold uppercase tracking-wider text-foreground hover:border-primary/60 transition-colors"
                          >
                            {symbol}
                          </Link>
                        ))}
                        {remaining > 0 ? (
                          <span className="px-2.5 py-1 rounded-full border border-border-color bg-background-dark text-[10px] font-bold uppercase tracking-wider text-muted">
                            +{remaining}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  {item.prompt ? (
                    <div className="mt-4 bg-background-dark border border-border-color rounded-xl p-4">
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted mb-2">
                        Prompt
                      </p>
                      <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                        {item.prompt}
                      </p>
                    </div>
                  ) : null}

                  {preview ? (
                    <div className="mt-4">
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted mb-2">
                        Output
                      </p>
                      <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed line-clamp-6">
                        {preview}
                      </p>
                    </div>
                  ) : null}

                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

