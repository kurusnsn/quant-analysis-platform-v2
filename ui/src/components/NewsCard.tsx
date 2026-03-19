"use client";

import { useClientNow } from "@/hooks/useClientNow";
import { NewsArticle } from "@/hooks/useStockNews";

interface NewsCardProps {
  article: NewsArticle;
}

export default function NewsCard({ article }: NewsCardProps) {
  const now = useClientNow(60_000);
  const normalizeTimestamp = (timestamp?: number | string) => {
    if (timestamp === null || timestamp === undefined) return null;
    if (typeof timestamp === "number") return timestamp;
    const trimmed = String(timestamp).trim();
    if (!trimmed) return null;
    const numeric = Number(trimmed);
    return Number.isNaN(numeric) ? trimmed : numeric;
  };

  const toDate = (value: number | string | null) => {
    if (value === null) return null;
    if (typeof value === "number") {
      const ms = value > 1e12 ? value : value * 1000;
      const date = new Date(ms);
      return Number.isNaN(date.getTime()) ? null : date;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  };

  const formatTime = (timestamp?: number | string) => {
    const normalized = normalizeTimestamp(timestamp);
    const date = toDate(normalized);
    if (!date) return "Recently";
    if (now === null) return "Recently";

    const diffMs = now - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    if (diffHours < 1) return "Just now";
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  return (
    <a
      href={article.link}
      target="_blank"
      rel="noopener noreferrer"
      className="group block p-4 rounded-lg border border-border-color/50 hover:border-primary/50 transition-all hover:shadow-md bg-card-bg"
    >
      <div className="flex gap-3">
        {article.thumbnail && (
          <div className="flex-shrink-0">
            <img
              src={article.thumbnail}
              alt=""
              className="w-20 h-20 object-cover rounded-md"
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-sm text-foreground group-hover:text-primary transition-colors line-clamp-2 mb-1">
            {article.title}
          </h3>
          <div className="flex items-center gap-2 text-xs text-muted">
            <span className="font-medium">{article.publisher}</span>
            <span>•</span>
            <span>{formatTime(article.providerPublishTime)}</span>
          </div>
        </div>
      </div>
    </a>
  );
}
