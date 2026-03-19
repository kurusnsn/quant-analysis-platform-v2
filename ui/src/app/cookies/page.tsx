import type { Metadata } from "next";
import Link from "next/link";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "Cookie Policy",
  description: "Information about cookies used by QuantPlatform.",
  canonical: "/cookies",
});

export default function CookiesPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="max-w-[900px] mx-auto px-6 py-14 space-y-10">
        <header className="space-y-3">
          <p className="text-xs uppercase tracking-[0.3em] text-muted">
            Cookie Policy
          </p>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
            Cookies we use
          </h1>
          <p className="text-sm text-muted leading-relaxed">
            This page explains the cookies (and similar storage) that may be set
            when you use QuantPlatform.
          </p>
        </header>

        <section className="space-y-4">
          <h2 className="text-lg font-bold tracking-tight">Essential</h2>
          <div className="rounded-2xl border border-border-color bg-surface p-5 space-y-3">
            <p className="text-sm leading-relaxed text-muted">
              These are required to make the app work (for example: keeping you
              signed in, protecting the app, and remembering your settings).
            </p>
            <ul className="text-sm text-muted list-disc pl-5 space-y-2">
              <li>
                <span className="text-foreground font-semibold">
                  quant-platform_cookie_consent
                </span>{" "}
                (1 year) stores your analytics cookie preference.
              </li>
              <li>
                <span className="text-foreground font-semibold">
                  Authentication cookies
                </span>{" "}
                may be set when you sign in (via NextAuth.js) to keep
                your session active.
              </li>
              <li>
                <span className="text-foreground font-semibold">
                  quant-platform_dev_user
                </span>{" "}
                (development only) may be set when using the dev auth bypass.
              </li>
            </ul>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-bold tracking-tight">
            Analytics (optional)
          </h2>
          <div className="rounded-2xl border border-border-color bg-surface p-5 space-y-3">
            <p className="text-sm leading-relaxed text-muted">
              If you accept analytics cookies, we use PostHog to understand how
              the product is used and to improve it. PostHog typically stores a
              pseudonymous identifier and session information.
            </p>
            <ul className="text-sm text-muted list-disc pl-5 space-y-2">
              <li>
                <span className="text-foreground font-semibold">
                  ph_&lt;project&gt;_posthog
                </span>{" "}
                (cookie/localStorage) stores PostHog analytics state like a
                distinct ID and session-related properties.
              </li>
              <li>
                <span className="text-foreground font-semibold">
                  __ph_opt_in_out_&lt;project&gt;
                </span>{" "}
                (localStorage or cookie) may store your PostHog opt-in/out
                state.
              </li>
            </ul>
            <p className="text-xs text-muted leading-relaxed">
              Cookie names can vary based on PostHog configuration and project
              key.
            </p>
          </div>
        </section>
        <section className="space-y-4">
          <h2 className="text-lg font-bold tracking-tight">Contact</h2>
          <div className="rounded-2xl border border-border-color bg-surface p-5">
            <p className="text-sm leading-relaxed text-muted">
              For cookie or support inquiries, email{" "}
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
