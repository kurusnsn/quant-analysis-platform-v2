"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Header } from "@/components/Header";
import { authFetch } from "@/lib/authFetch";

const rawApiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api";
const normalizedApiUrl = rawApiUrl.replace(/\/+$/, "");
const API_URL = normalizedApiUrl.endsWith("/api")
  ? normalizedApiUrl
  : `${normalizedApiUrl}/api`;

type BillingHistoryItem = {
  invoiceId: string;
  number?: string | null;
  date?: string | null;
  periodEnd?: string | null;
  amountPaid?: number;
  currency?: string;
  status?: string;
  hostedInvoiceUrl?: string | null;
  invoicePdf?: string | null;
};

type BillingSummary = {
  configured: boolean;
  plan: "free" | "pro";
  status: string;
  cancelAtPeriodEnd: boolean;
  nextBillingDate?: string | null;
  customerId?: string | null;
  history: BillingHistoryItem[];
  availablePlans?: Array<{
    code: "free" | "pro";
    name: string;
    amountCents: number;
    currency: string;
    interval?: string | null;
  }>;
};

const formatDate = (value?: string | null) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

const formatCurrency = (amountCents?: number, currency?: string) => {
  const cents = typeof amountCents === "number" ? amountCents : 0;
  const resolvedCurrency = (currency || "usd").toUpperCase();

  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: resolvedCurrency,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${resolvedCurrency}`;
  }
};

const titleCaseStatus = (status?: string) => {
  const source = (status || "unknown").replace(/_/g, " ").trim();
  if (!source) return "Unknown";
  return source
    .split(/\s+/)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase())
    .join(" ");
};

export default function BillingSettingsPage() {
  const [isLaunchingCheckout, setIsLaunchingCheckout] = useState(false);
  const [isCanceling, setIsCanceling] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [billingStatus, setBillingStatus] = useState<string | null>(null);
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [isLoadingSummary, setIsLoadingSummary] = useState(true);

  const loadSummary = useCallback(async () => {
    setSummaryError(null);
    try {
      const response = await authFetch(`${API_URL}/billing/summary?historyLimit=12`, {
        cache: "no-store",
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? "Unable to load billing summary.");
      }

      const payload = (await response.json()) as BillingSummary;
      setSummary(payload);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to load billing summary.";
      setSummaryError(message);
      setSummary(null);
    } finally {
      setIsLoadingSummary(false);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    setBillingStatus(params.get("status"));
    void loadSummary();
  }, [loadSummary]);

  const handleCheckout = async () => {
    setActionError(null);

    setIsLaunchingCheckout(true);
    try {
      const origin = window.location.origin;
      const response = await authFetch(`${API_URL}/billing/checkout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          successUrl: `${origin}/settings/billing?status=success`,
          cancelUrl: `${origin}/settings/billing?status=cancel`,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? "Unable to start checkout.");
      }

      const payload = (await response.json()) as { url?: string };
      if (!payload.url) {
        throw new Error("Checkout URL missing from response.");
      }

      window.location.href = payload.url;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to start checkout.";
      setActionError(message);
      setIsLaunchingCheckout(false);
    }
  };

  const handleCancelSubscription = async () => {
    setActionError(null);
    setIsCanceling(true);

    try {
      const response = await authFetch(`${API_URL}/billing/cancel`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ immediate: false }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? "Unable to cancel subscription.");
      }

      setBillingStatus("cancelled");
      await loadSummary();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to cancel subscription.";
      setActionError(message);
    } finally {
      setIsCanceling(false);
    }
  };

  const currentPlan = summary?.plan === "pro" ? "Pro" : "Free";
  const currentStatus = titleCaseStatus(summary?.status);
  const nextBillingDate = formatDate(summary?.nextBillingDate ?? null);
  const canCancel =
    !!summary?.configured && summary.plan === "pro" && !summary.cancelAtPeriodEnd;

  const history = summary?.history ?? [];

  const renewalLabel = useMemo(() => {
    if (!summary) return "-";
    if (summary.cancelAtPeriodEnd) return `Cancels on ${nextBillingDate}`;
    return nextBillingDate;
  }, [summary, nextBillingDate]);

  return (
    <div className="min-h-screen flex flex-col bg-background-dark font-sans">
      <Header />

      <main className="flex-1 max-w-[980px] mx-auto w-full p-6 space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Settings</h1>
            <p className="text-xs text-muted">Manage account, billing, and security preferences.</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/settings"
            className="px-3 py-1.5 rounded-lg border border-border-color text-xs font-semibold uppercase tracking-wider text-muted hover:text-foreground hover:border-primary/60 transition-colors"
          >
            Account
          </Link>
          <Link
            href="/settings/billing"
            className="px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold uppercase tracking-wider"
          >
            Billing
          </Link>
        </div>

        <section className="bg-surface border border-border-color rounded-2xl p-6 space-y-4">
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-foreground">Billing</h2>
            <p className="text-xs text-muted">
              View billing history, renewal date, and manage upgrade or cancellation.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-xl border border-border-color p-4 bg-background">
              <p className="text-xs uppercase tracking-[0.2em] text-muted mb-1">Free</p>
              <p className="text-lg font-bold text-foreground">$0</p>
              <p className="text-xs text-muted mt-1">Core market features and watchlists.</p>
            </div>
            <div className="rounded-xl border border-primary/40 p-4 bg-background">
              <p className="text-xs uppercase tracking-[0.2em] text-primary mb-1">Pro</p>
              <p className="text-lg font-bold text-foreground">$2.99 / month</p>
              <p className="text-xs text-muted mt-1">Unlocks full AI features and advanced analysis.</p>
            </div>
          </div>

          {billingStatus === "success" ? (
            <div className="text-sm text-neon-green border border-neon-green/30 bg-neon-green/5 rounded-lg px-3 py-2">
              Checkout completed. Your subscription details are updating now.
            </div>
          ) : null}

          {billingStatus === "cancel" ? (
            <div className="text-sm text-muted border border-border-color bg-surface-highlight/50 rounded-2xl px-3 py-2">
              Checkout was canceled. No changes were made.
            </div>
          ) : null}

          {billingStatus === "cancelled" ? (
            <div className="text-sm text-neon-green border border-neon-green/30 bg-neon-green/5 rounded-lg px-3 py-2">
              Subscription cancellation scheduled for period end.
            </div>
          ) : null}

          {summaryError ? (
            <div className="text-sm text-neon-red border border-neon-red/30 bg-neon-red/5 rounded-lg px-3 py-2">
              {summaryError}
            </div>
          ) : null}

          {actionError ? (
            <div className="text-sm text-neon-red border border-neon-red/30 bg-neon-red/5 rounded-lg px-3 py-2">
              {actionError}
            </div>
          ) : null}

          {!isLoadingSummary && summary && !summary.configured ? (
            <div className="text-sm text-muted border border-border-color bg-surface-highlight/50 rounded-2xl px-3 py-2">
              Billing backend is not configured yet. Set Stripe keys on the server to enable checkout and cancellation.
            </div>
          ) : null}

          {isLoadingSummary ? (
            <div className="space-y-3">
              <div className="h-24 rounded-2xl bg-surface-highlight animate-pulse" />
              <div className="h-24 rounded-2xl bg-surface-highlight animate-pulse" />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="rounded-xl border border-border-color p-4 bg-background">
                <p className="text-xs uppercase tracking-[0.2em] text-muted mb-2">Current Plan</p>
                <h3 className="text-lg font-bold text-foreground">{currentPlan}</h3>
                <p className="text-xs text-muted mt-2">Status: {currentStatus}</p>
              </div>

              <div className="rounded-xl border border-border-color p-4 bg-background">
                <p className="text-xs uppercase tracking-[0.2em] text-muted mb-2">Next Renewal Date</p>
                <h3 className="text-lg font-bold text-foreground">{renewalLabel}</h3>
                <p className="text-xs text-muted mt-2">
                  {summary?.cancelAtPeriodEnd
                    ? "Your plan remains active until this date."
                    : "The next scheduled billing date for your current subscription."}
                </p>
              </div>

              <div className="rounded-xl border border-border-color p-4 bg-background">
                <p className="text-xs uppercase tracking-[0.2em] text-muted mb-2">Actions</p>
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => void handleCheckout()}
                    disabled={isLaunchingCheckout || !summary?.configured}
                    className="h-10 px-4 rounded-lg bg-primary text-white text-sm font-semibold uppercase tracking-[0.15em] hover:bg-primary/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {isLaunchingCheckout ? "Redirecting..." : "Upgrade to Pro"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleCancelSubscription()}
                    disabled={!canCancel || isCanceling}
                    className="h-10 px-4 rounded-lg border border-neon-red/50 text-neon-red text-sm font-semibold uppercase tracking-[0.15em] hover:bg-neon-red/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isCanceling
                      ? "Canceling..."
                      : summary?.cancelAtPeriodEnd
                      ? "Cancellation Scheduled"
                      : "Cancel Plan"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>

        <section className="bg-surface border border-border-color rounded-2xl p-6 space-y-4">
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-foreground">Billing History</h2>
            <p className="text-xs text-muted">Recent invoices and payments on your account.</p>
          </div>

          {isLoadingSummary ? (
            <div className="h-24 rounded-2xl bg-surface-highlight animate-pulse" />
          ) : history.length === 0 ? (
            <div className="text-sm text-muted border border-border-color bg-surface-highlight/50 rounded-2xl px-3 py-2">
              No billing history yet.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border-color">
              <table className="min-w-full text-sm">
                <thead className="bg-surface-highlight/60 text-muted uppercase tracking-[0.12em] text-[10px]">
                  <tr>
                    <th className="text-left px-4 py-3">Date</th>
                    <th className="text-left px-4 py-3">Invoice</th>
                    <th className="text-left px-4 py-3">Amount</th>
                    <th className="text-left px-4 py-3">Status</th>
                    <th className="text-left px-4 py-3">Receipt</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((item) => (
                    <tr key={item.invoiceId} className="border-t border-border-color/60">
                      <td className="px-4 py-3 text-foreground">{formatDate(item.date)}</td>
                      <td className="px-4 py-3 text-muted">{item.number || item.invoiceId}</td>
                      <td className="px-4 py-3 text-foreground">
                        {formatCurrency(item.amountPaid, item.currency)}
                      </td>
                      <td className="px-4 py-3 text-muted">{titleCaseStatus(item.status)}</td>
                      <td className="px-4 py-3">
                        {item.hostedInvoiceUrl || item.invoicePdf ? (
                          <a
                            href={item.hostedInvoiceUrl || item.invoicePdf || "#"}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:text-primary/80 font-semibold"
                          >
                            Open
                          </a>
                        ) : (
                          <span className="text-muted">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
