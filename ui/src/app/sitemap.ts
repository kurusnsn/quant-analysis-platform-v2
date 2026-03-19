import type { MetadataRoute } from "next";
import { siteConfig } from "@/lib/seo";

// Static pages with their crawl priority and change frequency
const staticPages: MetadataRoute.Sitemap = [
  {
    url: siteConfig.url,
    lastModified: new Date(),
    changeFrequency: "daily",
    priority: 1.0,
  },
  {
    url: `${siteConfig.url}/home`,
    lastModified: new Date(),
    changeFrequency: "daily",
    priority: 0.9,
  },
  {
    url: `${siteConfig.url}/signup`,
    lastModified: new Date(),
    changeFrequency: "monthly",
    priority: 0.7,
  },
  {
    url: `${siteConfig.url}/signin`,
    lastModified: new Date(),
    changeFrequency: "monthly",
    priority: 0.6,
  },
  {
    url: `${siteConfig.url}/privacy`,
    lastModified: new Date(),
    changeFrequency: "yearly",
    priority: 0.3,
  },
  {
    url: `${siteConfig.url}/terms`,
    lastModified: new Date(),
    changeFrequency: "yearly",
    priority: 0.3,
  },
  {
    url: `${siteConfig.url}/cookies`,
    lastModified: new Date(),
    changeFrequency: "yearly",
    priority: 0.2,
  },
  {
    url: `${siteConfig.url}/refund`,
    lastModified: new Date(),
    changeFrequency: "yearly",
    priority: 0.2,
  },
];

interface StockUniverse {
  symbols: Record<string, { name: string; exchange: string; market_cap: number }>;
}

async function getStockEntries(): Promise<MetadataRoute.Sitemap> {
  try {
    // stock-universe.json is a public static asset – read at build time
    const res = await fetch(`${siteConfig.url}/stock-universe.json`, {
      next: { revalidate: 86400 }, // refresh once per day
    });
    if (!res.ok) return [];
    const data: StockUniverse = await res.json();
    return Object.keys(data.symbols).map((ticker) => ({
      url: `${siteConfig.url}/stock/${ticker}`,
      lastModified: new Date(),
      changeFrequency: "daily" as const,
      priority: 0.6,
    }));
  } catch {
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const stockEntries = await getStockEntries();
  return [...staticPages, ...stockEntries];
}
