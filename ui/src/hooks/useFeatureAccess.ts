"use client";

import { useSession } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { isDevAuthEnabled } from "@/lib/devAuth";

const API_URL = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/+$/, "");

interface BillingSummary {
    plan: "free" | "pro";
    status: string;
    trialStatus?: string;
    trialDaysRemaining?: number;
    trialLocked?: boolean;
}

/**
 * Hook that checks whether the current user has access to LLM‑dependent features.
 *
 * Rules:
 *  - Dev auth enabled → full access (no locks in dev/mock mode)
 *  - No session → no access (must sign in)
 *  - plan === "pro" → full access
 *  - trialLocked → no access (trial expired)
 *  - Otherwise (active trial or free) → access allowed
 */
export function useFeatureAccess() {
    const { data: session, status: sessionStatus } = useSession();
    const isAuthenticated = sessionStatus === "authenticated";

    const { data: billing, isLoading: billingLoading } = useQuery<BillingSummary | null>({
        queryKey: ["billing-summary"],
        enabled: isAuthenticated && !!API_URL,
        staleTime: 5 * 60 * 1000, // 5 min cache
        queryFn: async ({ signal }) => {
            try {
                const res = await authFetch(`${API_URL}/billing/summary`, { signal });
                if (!res.ok) return null;
                return (await res.json()) as BillingSummary;
            } catch {
                return null;
            }
        },
    });

    const isLoading = sessionStatus === "loading" || (isAuthenticated && billingLoading);

    // In dev/mock mode all features are unlocked — no billing check needed
    if (isDevAuthEnabled()) {
        return {
            canUseLLM: true,
            isLoading: false,
            isAuthenticated: true,
            plan: "pro" as string | null,
            reason: "pro" as const,
        };
    }

    // Determine access
    if (!isAuthenticated) {
        return {
            canUseLLM: false,
            isLoading,
            isAuthenticated: false,
            plan: null as string | null,
            reason: "sign_in_required" as const,
        };
    }

    if (billingLoading || !billing) {
        return {
            canUseLLM: false,
            isLoading: true,
            isAuthenticated: true,
            plan: null as string | null,
            reason: "loading" as const,
        };
    }

    if (billing.plan === "pro") {
        return {
            canUseLLM: true,
            isLoading: false,
            isAuthenticated: true,
            plan: "pro" as string | null,
            reason: "pro" as const,
        };
    }

    if (billing.trialLocked) {
        return {
            canUseLLM: false,
            isLoading: false,
            isAuthenticated: true,
            plan: "free" as string | null,
            reason: "trial_expired" as const,
        };
    }

    // Active trial or untracked
    return {
        canUseLLM: true,
        isLoading: false,
        isAuthenticated: true,
        plan: billing.plan as string | null,
        reason: "trial_active" as const,
    };
}
