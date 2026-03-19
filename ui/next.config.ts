import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',

  // CDN optimization for Cloudflare
  images: {
    minimumCacheTTL: 60 * 60 * 24, // 24 hours
    formats: ['image/avif', 'image/webp'],
  },

  // Cache headers for static assets
  async headers() {
    return [
      {
        // Immutable static assets (hashed filenames)
        source: '/_next/static/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        // Stock data files - cache 1h browser, 24h edge
        source: '/stock-logos.json',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=3600, s-maxage=86400' },
        ],
      },
      {
        source: '/stock-metadata.json',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=3600, s-maxage=86400' },
        ],
      },
      {
        source: '/stock-prices.json',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=300, s-maxage=900' }, // 5min browser, 15min edge
        ],
      },
    ];
  },
};

export default nextConfig;
