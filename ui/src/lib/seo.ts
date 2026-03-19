import type { Metadata } from "next";

// ---------------------------------------------------------------------------
// Site-wide constants
// ---------------------------------------------------------------------------

export const siteConfig = {
  name: "QuantPlatform",
  tagline: "AI-Powered Market Research",
  description:
    "AI-powered deep research for markets: create strategy watchlists, analyze risk, and track a live market overview in one dashboard.",
  url:
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.NODE_ENV === "production"
      ? "https://quant-platform.com"
      : "http://localhost:3000"),
  ogImage: "/og-default.png",
  logo: "/logo-dark-mode.png",
  twitterHandle: "@quant-platform",
} as const;

// ---------------------------------------------------------------------------
// Default Open Graph image dimensions (1200 × 630 is the canonical spec)
// ---------------------------------------------------------------------------

export const defaultOGImage = {
  url: siteConfig.ogImage,
  width: 1200,
  height: 630,
  alt: `${siteConfig.name} – ${siteConfig.tagline}`,
};

// ---------------------------------------------------------------------------
// Helper: build page-level Metadata, merging page overrides with site defaults
// ---------------------------------------------------------------------------

export interface PageSEOProps {
  title?: string;
  description?: string;
  /** Absolute or root-relative canonical path, e.g. "/stock/AAPL" */
  canonical?: string;
  /** Override the OG image; falls back to defaultOGImage */
  ogImage?: {
    url: string;
    width?: number;
    height?: number;
    alt?: string;
  };
  /** Prevent indexing for auth / private pages */
  noIndex?: boolean;
}

export function buildMetadata(props: PageSEOProps = {}): Metadata {
  const {
    title,
    description = siteConfig.description,
    canonical,
    ogImage,
    noIndex = false,
  } = props;

  const image = ogImage
    ? {
        url: ogImage.url,
        width: ogImage.width ?? 1200,
        height: ogImage.height ?? 630,
        alt: ogImage.alt ?? title ?? siteConfig.name,
      }
    : defaultOGImage;

  return {
    title,
    description,
    ...(canonical && { alternates: { canonical } }),
    openGraph: {
      title: title ?? siteConfig.name,
      description,
      images: [image],
      siteName: siteConfig.name,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: title ?? siteConfig.name,
      description,
      images: [image.url],
    },
    robots: noIndex
      ? { index: false, follow: false }
      : { index: true, follow: true },
  };
}
