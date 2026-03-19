"use client";
import { devConsole } from "@/lib/devLog";

import { useState, useRef, useCallback, useEffect } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import NewsCard from "./NewsCard";
import { NewsArticle } from "@/hooks/useStockNews";
import { authFetch } from "@/lib/authFetch";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

interface WatchlistNewsAggregatorProps {
  tickers: string[];
}

export default function WatchlistNewsAggregator({ tickers }: WatchlistNewsAggregatorProps) {
  const [perTickerLimit, setPerTickerLimit] = useState(3);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const scrollRootRef = useRef<HTMLDivElement>(null);

  const tickersKey = tickers.join(",");
  const query = useQuery({
    queryKey: ["watchlistNews", tickersKey, perTickerLimit],
    enabled: tickers.length > 0,
    queryFn: async ({ signal }) => {
      const newsPromises = tickers.map(async (ticker) => {
        try {
          const response = await authFetch(`${API_URL}/stocks/${ticker}/news?limit=${perTickerLimit}`, { signal });
          if (response.ok) {
            const data = await response.json();
            return (data.news || []).map((article: NewsArticle) => ({
              ...article,
              ticker,
            }));
          }
        } catch (err) {
          if (!(err instanceof Error && err.name === "AbortError")) {
            devConsole.error(`Failed to fetch news for ${ticker}:`, err);
          }
        }
        return [];
      });

      const newsArrays = await Promise.all(newsPromises);
      const allNews = newsArrays.flat();

      // Deduplicate by title
      const seen = new Set<string>();
      const uniqueNews = allNews.filter((article) => {
        if (seen.has(article.title)) return false;
        seen.add(article.title);
        return true;
      });

      // Sort by timestamp (most recent first)
      uniqueNews.sort((a, b) => {
        const timeA = typeof a.providerPublishTime === "number" ? a.providerPublishTime : 0;
        const timeB = typeof b.providerPublishTime === "number" ? b.providerPublishTime : 0;
        return timeB - timeA;
      });

      return uniqueNews;
    },
    placeholderData: keepPreviousData,
    staleTime: 60 * 1000,
  });

  const news = query.data ?? [];
  const loading = query.isLoading;
  const fetching = query.isFetching;
  const error = query.error instanceof Error ? query.error.message : query.error ? "Failed to load news" : null;

  // We can load more if we haven't maxed out the per-ticker limit
  const hasMore = perTickerLimit < 15;

  const loadMore = useCallback(() => {
    setPerTickerLimit((prev) => Math.min(prev + 3, 15));
  }, []);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    const scrollRoot = scrollRootRef.current;
    if (!sentinel || !scrollRoot) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !fetching && hasMore) {
          loadMore();
        }
      },
      { root: scrollRoot, rootMargin: "200px" }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [fetching, hasMore, loadMore]);

  if (loading) {
    return (
      <div className="bg-surface border border-border-color rounded-2xl p-6">
        <h2 className="text-lg font-bold text-foreground mb-4">Recent News</h2>
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="flex gap-3 p-4 rounded-lg border border-border-color/50 animate-pulse">
              <div className="w-20 h-20 bg-surface-highlight rounded-md"></div>
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-surface-highlight rounded w-3/4"></div>
                <div className="h-3 bg-surface-highlight rounded w-1/2"></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-surface border border-border-color rounded-2xl p-6">
        <h2 className="text-lg font-bold text-foreground mb-4">Recent News</h2>
        <div className="text-center py-8 text-muted">
          <span className="material-symbols-outlined text-4xl mb-2 opacity-50">error</span>
          <p className="text-sm">{error}</p>
        </div>
      </div>
    );
  }

  if (news.length === 0) {
    return (
      <div className="bg-surface border border-border-color rounded-2xl p-6">
        <h2 className="text-lg font-bold text-foreground mb-4">Recent News</h2>
        <div className="text-center py-8 text-muted">
          <span className="material-symbols-outlined text-4xl mb-2 opacity-50">newspaper</span>
          <p className="text-sm">No recent news for these stocks</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-surface border border-border-color rounded-2xl p-6 flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-foreground">Recent News</h2>
        <span className="text-xs text-muted">{news.length} articles</span>
      </div>

      <div
        ref={scrollRootRef}
        className="overflow-y-auto max-h-[600px] space-y-3 custom-scrollbar pr-1"
      >
        {news.map((article, index) => (
          <div key={index} className="relative overflow-hidden rounded-lg">
            <NewsCard article={article} />
            <div className="absolute bottom-2 right-2 z-10">
              <span className="px-2 py-0.5 text-[10px] font-bold bg-primary/20 text-primary rounded">
                {article.ticker}
              </span>
            </div>
          </div>
        ))}

        {/* Sentinel — triggers load-more when scrolled into view */}
        <div ref={sentinelRef} className="h-1" />

        {fetching && (
          <div className="py-3 text-center">
            <span className="inline-block w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin"></span>
          </div>
        )}
      </div>
    </div>
  );
}
