import { ImageResponse } from "next/og";
import { type NextRequest } from "next/server";
import { siteConfig } from "@/lib/seo";

export const runtime = "edge";

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  const ticker = (searchParams.get("ticker") ?? "").toUpperCase();
  const title = searchParams.get("title") ?? siteConfig.name;
  const subtitle = searchParams.get("subtitle") ?? siteConfig.tagline;

  return new ImageResponse(
    (
      <div
        style={{
          width: OG_WIDTH,
          height: OG_HEIGHT,
          background: "#0a0a0f",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px",
          fontFamily: "'Space Mono', monospace",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Background grid accent */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(ellipse 80% 50% at 50% -10%, rgba(99,102,241,0.25) 0%, transparent 70%)",
          }}
        />

        {/* Top row: site name + ticker badge */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span
            style={{
              color: "#a5b4fc",
              fontSize: 28,
              letterSpacing: "0.05em",
              fontWeight: 700,
            }}
          >
            {siteConfig.name.toUpperCase()}
          </span>
          {ticker && (
            <span
              style={{
                background: "rgba(99,102,241,0.2)",
                border: "1px solid rgba(99,102,241,0.5)",
                color: "#c7d2fe",
                fontSize: 24,
                fontWeight: 700,
                padding: "6px 20px",
                borderRadius: 8,
                letterSpacing: "0.1em",
              }}
            >
              {ticker}
            </span>
          )}
        </div>

        {/* Main title */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <p
            style={{
              color: "#f1f5f9",
              fontSize: ticker ? 56 : 64,
              fontWeight: 700,
              lineHeight: 1.15,
              margin: 0,
              letterSpacing: "-0.02em",
              maxWidth: 900,
            }}
          >
            {title}
          </p>
          <p
            style={{
              color: "#94a3b8",
              fontSize: 28,
              fontWeight: 400,
              margin: 0,
              letterSpacing: "0.01em",
            }}
          >
            {subtitle}
          </p>
        </div>

        {/* Bottom row: tagline */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "#6366f1",
            }}
          />
          <span style={{ color: "#64748b", fontSize: 20 }}>
            {siteConfig.tagline} · {siteConfig.url.replace(/^https?:\/\//, "")}
          </span>
        </div>
      </div>
    ),
    {
      width: OG_WIDTH,
      height: OG_HEIGHT,
    },
  );
}
