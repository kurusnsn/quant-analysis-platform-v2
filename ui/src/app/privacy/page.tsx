import type { Metadata } from "next";
import Link from "next/link";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "Privacy Policy",
  description: "How QuantPlatform collects, uses, and protects your personal data.",
  canonical: "/privacy",
});

export default function PrivacyPolicyPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="max-w-[900px] mx-auto px-6 py-14 space-y-10">
        <header className="space-y-3">
          <p className="text-xs uppercase tracking-[0.3em] text-muted">
            Privacy Policy
          </p>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
            Your privacy matters
          </h1>
          <p className="text-sm text-muted leading-relaxed">
            Last updated: February 2026. This policy explains how QuantPlatform
            collects, uses, stores, and protects your information.
          </p>
        </header>

        <section className="space-y-4">
          <h2 className="text-lg font-bold tracking-tight">
            Information we collect
          </h2>
          <div className="rounded-2xl border border-border-color bg-surface p-5 space-y-3">
            <p className="text-sm leading-relaxed text-muted">
              We collect information you provide directly, such as your email
              address and display name when you create an account. We also
              collect usage data automatically, including pages visited, features
              used, and device information (browser type, operating system).
            </p>
            <ul className="text-sm text-muted list-disc pl-5 space-y-2">
              <li>
                <span className="text-foreground font-semibold">
                  Account data
                </span>{" "}
                -- email, display name, and authentication credentials.
              </li>
              <li>
                <span className="text-foreground font-semibold">
                  Usage data
                </span>{" "}
                -- watchlists, followed stocks, prompts submitted to the AI
                engine, and interaction patterns.
              </li>
              <li>
                <span className="text-foreground font-semibold">
                  Device and log data
                </span>{" "}
                -- IP address, browser type, pages visited, and timestamps.
              </li>
            </ul>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-bold tracking-tight">
            How we use your information
          </h2>
          <div className="rounded-2xl border border-border-color bg-surface p-5 space-y-3">
            <ul className="text-sm text-muted list-disc pl-5 space-y-2">
              <li>To provide, maintain, and improve the QuantPlatform platform.</li>
              <li>To generate AI-powered market analysis and watchlist syntheses.</li>
              <li>To personalise your experience (e.g. followed stocks, watchlists).</li>
              <li>To send service-related communications.</li>
              <li>To detect and prevent fraud, abuse, or security incidents.</li>
              <li>To comply with legal obligations.</li>
            </ul>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-bold tracking-tight">
            Data sharing and third parties
          </h2>
          <div className="rounded-2xl border border-border-color bg-surface p-5 space-y-3">
            <p className="text-sm leading-relaxed text-muted">
              We do not sell your personal data. We share data only with
              service providers that help us operate the platform:
            </p>
            <ul className="text-sm text-muted list-disc pl-5 space-y-2">
              <li>Authentication providers (e.g. Supabase).</li>
              <li>AI model providers for generating analyses (prompts are processed server-side).</li>
              <li>Analytics providers (PostHog), if you consent to analytics cookies.</li>
              <li>Cloud infrastructure providers for hosting and storage.</li>
            </ul>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-bold tracking-tight">
            Data retention
          </h2>
          <div className="rounded-2xl border border-border-color bg-surface p-5">
            <p className="text-sm leading-relaxed text-muted">
              We retain your account data for as long as your account is active.
              Usage data and generated analyses are retained for up to 12 months.
              You can request deletion of your data at any time by contacting us
              or using the account deletion feature in Settings.
            </p>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-bold tracking-tight">Your rights</h2>
          <div className="rounded-2xl border border-border-color bg-surface p-5">
            <p className="text-sm leading-relaxed text-muted">
              Depending on your jurisdiction, you may have the right to access,
              correct, delete, or export your personal data. You may also
              withdraw consent for optional data processing (such as analytics)
              at any time. To exercise your rights, contact us at the address
              below.
            </p>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-bold tracking-tight">Contact</h2>
          <div className="rounded-2xl border border-border-color bg-surface p-5">
            <p className="text-sm leading-relaxed text-muted">
              For privacy-related inquiries, please email{" "}
              <a
                href="mailto:support@quant-platform.com"
                className="text-foreground font-semibold underline-offset-4 hover:underline"
              >
                support@quant-platform.com
              </a>
              .
            </p>
          </div>
        </section>

        <div className="pt-4 border-t border-border-color">
          <Link
            href="/"
            className="text-xs text-muted hover:text-foreground transition-colors"
          >
            Back to home
          </Link>
        </div>
      </div>
    </main>
  );
}
