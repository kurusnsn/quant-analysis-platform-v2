/**
 * StructuredData – server component that injects a JSON-LD <script> tag.
 *
 * Usage:
 *   <StructuredData data={orgSchema()} />
 *   <StructuredData data={breadcrumbSchema([{ name: "Home", url: "/" }])} />
 */

import { siteConfig } from "@/lib/seo";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface StructuredDataProps {
  /** A fully-formed schema.org object (including @context / @type) */
  data: Record<string, unknown> | Record<string, unknown>[];
}

export function StructuredData({ data }: StructuredDataProps) {
  return (
    <script
      type="application/ld+json"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: intentional – JSON-LD must be raw
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

// ---------------------------------------------------------------------------
// Schema builders
// ---------------------------------------------------------------------------

/** Organization schema – rendered once in the root layout. */
export function orgSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: siteConfig.name,
    url: siteConfig.url,
    logo: `${siteConfig.url}${siteConfig.logo}`,
    sameAs: [],
  };
}

/** WebSite schema with a SearchAction for sitelinks search box. */
export function websiteSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: siteConfig.name,
    url: siteConfig.url,
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${siteConfig.url}/home?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };
}

/** BreadcrumbList schema for inner pages. */
export interface BreadcrumbItem {
  name: string;
  /** Root-relative or absolute URL */
  url: string;
}

export function breadcrumbSchema(items: BreadcrumbItem[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, idx) => ({
      "@type": "ListItem",
      position: idx + 1,
      name: item.name,
      item: item.url.startsWith("http")
        ? item.url
        : `${siteConfig.url}${item.url}`,
    })),
  };
}

/** FinancialProduct / stock-page schema. */
export function stockSchema(params: {
  ticker: string;
  name: string;
  description?: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "FinancialProduct",
    name: `${params.name} (${params.ticker})`,
    description:
      params.description ??
      `Stock analysis and AI-powered research for ${params.name} (${params.ticker}) on ${siteConfig.name}.`,
    url: `${siteConfig.url}/stock/${params.ticker}`,
    provider: {
      "@type": "Organization",
      name: siteConfig.name,
      url: siteConfig.url,
    },
  };
}
