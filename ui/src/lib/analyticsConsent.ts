import { deleteCookie, getCookie, setCookie } from "@/lib/browserCookies";

export const ANALYTICS_CONSENT_COOKIE = "quant-platform_cookie_consent";
export const ANALYTICS_CONSENT_EVENT = "quant-platform:analytics-consent-changed";

export type AnalyticsConsent = "accepted" | "rejected";

export function readAnalyticsConsent(): AnalyticsConsent | null {
  const value = getCookie(ANALYTICS_CONSENT_COOKIE);
  if (value === "accepted" || value === "rejected") return value;
  return null;
}

export function writeAnalyticsConsent(consent: AnalyticsConsent): void {
  // 1 year
  setCookie(ANALYTICS_CONSENT_COOKIE, consent, { maxAgeSeconds: 60 * 60 * 24 * 365, sameSite: "lax" });
}

export function notifyAnalyticsConsentChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(ANALYTICS_CONSENT_EVENT));
}

function sanitizePostHogTokenForKey(token: string): string {
  // Matches PostHog persistence naming logic:
  // token.replace(/\+/g, 'PL').replace(/\//g, 'SL').replace(/=/g, 'EQ')
  return token.replace(/\+/g, "PL").replace(/\//g, "SL").replace(/=/g, "EQ");
}

export function clearPostHogStorage(): void {
  if (typeof window === "undefined") return;
  const token = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!token) return;

  const sanitized = sanitizePostHogTokenForKey(token);
  const persistenceKey = `ph_${sanitized}_posthog`;
  const consentKey = `__ph_opt_in_out_${token}`;

  try {
    window.localStorage.removeItem(persistenceKey);
    window.localStorage.removeItem(consentKey);
  } catch {
    // ignore
  }

  try {
    window.sessionStorage.removeItem(persistenceKey);
  } catch {
    // ignore
  }

  deleteCookie(persistenceKey);
  deleteCookie(consentKey);
}

