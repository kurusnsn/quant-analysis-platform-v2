"use client";

import Link from "next/link";
import { useMemo, useSyncExternalStore } from "react";
import {
  clearPostHogStorage,
  notifyAnalyticsConsentChanged,
  readAnalyticsConsent,
  writeAnalyticsConsent,
  ANALYTICS_CONSENT_EVENT,
} from "@/lib/analyticsConsent";

function subscribe(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(ANALYTICS_CONSENT_EVENT, onStoreChange);
  return () => window.removeEventListener(ANALYTICS_CONSENT_EVENT, onStoreChange);
}

function getSnapshot() {
  return readAnalyticsConsent();
}

function getServerSnapshot() {
  // Avoid SSR flashes: we only decide whether to show the banner on the client.
  return "unknown" as const;
}

export function CookieConsentBanner() {
  const posthogEnabled = useMemo(
    () => Boolean(process.env.NEXT_PUBLIC_POSTHOG_KEY),
    []
  );
  const consent = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  if (!posthogEnabled) return null;
  if (consent === "unknown") return null;
  if (consent) return null;

  const accept = () => {
    writeAnalyticsConsent("accepted");
    notifyAnalyticsConsentChanged();
  };

  const reject = () => {
    writeAnalyticsConsent("rejected");
    // If the user previously opted in and still has PostHog storage/cookies, clear them.
    clearPostHogStorage();
    notifyAnalyticsConsentChanged();
  };

  return (
    <div className="fixed inset-x-4 bottom-4 z-50">
      <div className="mx-auto w-full max-w-[980px] rounded-2xl border border-border-color bg-surface/90 backdrop-blur p-4 sm:p-5 shadow-[0_18px_45px_rgba(0,0,0,0.18)]">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-muted">
              Cookies
            </p>
            <p className="text-sm leading-relaxed text-foreground">
              We use essential cookies to run the app. With your permission, we
              also use PostHog analytics cookies to understand usage and improve
              the product.{" "}
              <Link
                href="/cookies"
                className="underline decoration-border-color underline-offset-4 hover:decoration-muted"
              >
                Learn more
              </Link>
              .
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:shrink-0">
            <button
              type="button"
              onClick={reject}
              className="inline-flex items-center justify-center h-10 px-4 rounded-full border border-border-color bg-transparent text-[10px] font-bold uppercase tracking-[0.2em] text-muted hover:bg-surface-highlight hover:text-foreground transition-colors"
            >
              Reject
            </button>
            <button
              type="button"
              onClick={accept}
              className="inline-flex items-center justify-center h-10 px-4 rounded-full bg-primary text-white text-[10px] font-bold uppercase tracking-[0.2em] hover:bg-primary/90 transition-colors"
            >
              Accept analytics
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
