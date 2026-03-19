import type { Metadata } from "next";
import { buildMetadata, siteConfig } from "@/lib/seo";
import { StructuredData, breadcrumbSchema, stockSchema } from "@/components/StructuredData";
import StockDetailPage from "./StockDetailClient";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StockMeta {
  long_name?: string;
  short_name?: string;
  sector?: string;
  industry?: string;
}

interface StockMetadataFile {
  stocks?: Record<string, StockMeta>;
}

// ---------------------------------------------------------------------------
// Data helpers (server-side, runs at request/build time)
// ---------------------------------------------------------------------------

async function getStockMeta(ticker: string): Promise<StockMeta | null> {
  try {
    const res = await fetch(`${siteConfig.url}/stock-metadata.json`, {
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    const data: StockMetadataFile = await res.json();
    return data?.stocks?.[ticker.toUpperCase()] ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Dynamic metadata
// ---------------------------------------------------------------------------

export async function generateMetadata({
  params,
}: {
  params: Promise<{ ticker: string }>;
}): Promise<Metadata> {
  const { ticker } = await params;
  const upperTicker = ticker.toUpperCase();
  const stock = await getStockMeta(upperTicker);

  const name = stock?.long_name ?? stock?.short_name ?? upperTicker;
  const title = `${name} (${upperTicker}) Stock Analysis`;
  const description = stock?.sector
    ? `AI-powered research for ${name} (${upperTicker}) · ${stock.sector}${stock.industry ? ` · ${stock.industry}` : ""}. Charts, financials, news & sentiment on ${siteConfig.name}.`
    : `AI-powered stock analysis for ${name} (${upperTicker}) — charts, financials, news, and sentiment on ${siteConfig.name}.`;

  const ogImage = {
    url: `/api/og?ticker=${upperTicker}&title=${encodeURIComponent(name)}&subtitle=${encodeURIComponent(stock?.sector ?? "Stock Analysis")}`,
    width: 1200,
    height: 630,
    alt: `${name} (${upperTicker}) on ${siteConfig.name}`,
  };

  return buildMetadata({
    title,
    description,
    canonical: `/stock/${upperTicker}`,
    ogImage,
  });
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function StockPage({
  params,
}: {
  params: Promise<{ ticker: string }>;
}) {
  const { ticker } = await params;
  const upperTicker = ticker.toUpperCase();
  const stock = await getStockMeta(upperTicker);
  const name = stock?.long_name ?? stock?.short_name ?? upperTicker;

  return (
    <>
      <StructuredData
        data={stockSchema({
          ticker: upperTicker,
          name,
          description: stock?.industry
            ? `${name} operates in ${stock.industry}.`
            : undefined,
        })}
      />
      <StructuredData
        data={breadcrumbSchema([
          { name: "Home", url: "/" },
          { name: "Markets", url: "/home" },
          { name: `${upperTicker}`, url: `/stock/${upperTicker}` },
        ])}
      />
      <StockDetailPage />
    </>
  );
}
