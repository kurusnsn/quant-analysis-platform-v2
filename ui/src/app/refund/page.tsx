import type { Metadata } from "next";
import Link from "next/link";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "Refund Policy",
  description: "QuantPlatform refund and cancellation policy.",
  canonical: "/refund",
});

export default function RefundPolicyPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="max-w-[900px] mx-auto px-6 py-14 space-y-10">
        <header className="space-y-3">
          <p className="text-xs uppercase tracking-[0.3em] text-muted">
            Refund Policy
          </p>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
            Refunds and cancellations
          </h1>
          <p className="text-sm text-muted leading-relaxed">
            Last updated: February 2026. This policy explains how refunds and
            cancellations are handled for QuantPlatform services.
          </p>
        </header>

        <section className="space-y-4">
          <h2 className="text-lg font-bold tracking-tight">Free tier</h2>
          <div className="rounded-2xl border border-border-color bg-surface p-5">
            <p className="text-sm leading-relaxed text-muted">
              The QuantPlatform free tier does not require payment and therefore no
              refund applies. You may stop using the service at any time.
            </p>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-bold tracking-tight">
            Paid subscriptions
          </h2>
          <div className="rounded-2xl border border-border-color bg-surface p-5 space-y-3">
            <p className="text-sm leading-relaxed text-muted">
              If you purchase a paid subscription:
            </p>
            <ul className="text-sm text-muted list-disc pl-5 space-y-2">
              <li>
                You may cancel your subscription at any time. Access continues
                until the end of the current billing period.
              </li>
              <li>
                Refund requests made within 7 days of initial purchase will be
                processed in full, provided the service has not been
                substantially used during that period.
              </li>
              <li>
                After 7 days, partial refunds may be issued at our discretion
                on a case-by-case basis.
              </li>
              <li>
                Renewals are non-refundable once the new billing period has
                begun.
              </li>
            </ul>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-bold tracking-tight">
            How to request a refund
          </h2>
          <div className="rounded-2xl border border-border-color bg-surface p-5">
            <p className="text-sm leading-relaxed text-muted">
              To request a refund, email{" "}
              <a
                href="mailto:support@quant-platform.com"
                className="text-foreground font-semibold underline-offset-4 hover:underline"
              >
                support@quant-platform.com
              </a>{" "}
              with your account email and a brief description of the reason.
              Refunds are typically processed within 5-10 business days.
            </p>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-bold tracking-tight">
            Changes to this policy
          </h2>
          <div className="rounded-2xl border border-border-color bg-surface p-5">
            <p className="text-sm leading-relaxed text-muted">
              We may update this refund policy from time to time. Any changes
              will be posted on this page with an updated revision date.
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
