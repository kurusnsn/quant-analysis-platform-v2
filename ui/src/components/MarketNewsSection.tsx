"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useMarketNews } from "@/hooks/useStockNews";
import NewsCard from "./NewsCard";

export default function MarketNewsSection() {
  const [limit, setLimit] = useState(10);
  const { news, loading, fetching, error } = useMarketNews(limit);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const scrollRootRef = useRef<HTMLDivElement>(null);
  const hasMore = news.length >= limit;

  const loadMore = useCallback(() => {
    setLimit(prev => prev + 10);
  }, []);

  // Use IntersectionObserver to detect when the sentinel enters the viewport
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const scrollRoot = scrollRootRef.current;
    if (!sentinel) return;
    if (!scrollRoot) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !fetching && hasMore) {
          loadMore();
        }
      },
      // Observe relative to the scroll container (not the page viewport),
      // and prefetch before the user hits the absolute bottom.
      { root: scrollRoot, rootMargin: "200px" }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [fetching, hasMore, loadMore]);

  return (
    <div className="bg-surface border border-border-color rounded-2xl p-6 flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-foreground">Market News</h2>
        <span className="material-symbols-outlined text-muted">newspaper</span>
      </div>

      {loading && limit === 10 ? (
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
      ) : error ? (
        <div className="text-center py-8 text-muted">
          <span className="material-symbols-outlined text-4xl mb-2 opacity-50">error</span>
          <p className="text-sm">Unable to load market news</p>
        </div>
      ) : news.length === 0 ? (
        <div className="text-center py-8 text-muted">
          <span className="material-symbols-outlined text-4xl mb-2 opacity-50">newspaper</span>
          <p className="text-sm">No market news available</p>
        </div>
      ) : (
        <div
          ref={scrollRootRef}
          className="overflow-y-auto max-h-[600px] space-y-3 custom-scrollbar pr-1"
        >
          {news.map((article, index) => (
            <NewsCard key={index} article={article} />
          ))}

          {/* Sentinel element — triggers load-more when scrolled into view */}
          <div ref={sentinelRef} className="h-1" />

          {fetching && (
            <div className="py-3 text-center">
              <span className="inline-block w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin"></span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
