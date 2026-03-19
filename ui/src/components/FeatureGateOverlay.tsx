"use client";

import Link from "next/link";

interface FeatureGateOverlayProps {
    reason: "sign_in_required" | "trial_expired" | "loading" | "pro" | "trial_active";
    featureLabel?: string;
}

/**
 * Overlay shown on top of LLM-dependent widgets when access is restricted.
 */
export default function FeatureGateOverlay({
    reason,
    featureLabel = "This feature",
}: FeatureGateOverlayProps) {
    if (reason === "sign_in_required") {
        return (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-background/80 backdrop-blur-sm">
                <div className="text-center space-y-3 max-w-xs">
                    <span className="material-symbols-outlined text-3xl text-muted">lock</span>
                    <p className="text-sm text-muted">
                        {featureLabel} requires an account.
                    </p>
                    <Link
                        href="/signin"
                        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-white text-xs font-bold uppercase tracking-widest hover:bg-primary/90 transition-colors"
                    >
                        Sign in
                    </Link>
                </div>
            </div>
        );
    }

    if (reason === "trial_expired") {
        return (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-background/80 backdrop-blur-sm">
                <div className="text-center space-y-3 max-w-xs">
                    <span className="material-symbols-outlined text-3xl text-primary">workspace_premium</span>
                    <p className="text-sm text-muted">
                        Your free trial has ended. Upgrade to keep using {featureLabel.toLowerCase()}.
                    </p>
                    <Link
                        href="/settings/billing"
                        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-white text-xs font-bold uppercase tracking-widest hover:bg-primary/90 transition-colors"
                    >
                        Upgrade to Pro
                    </Link>
                </div>
            </div>
        );
    }

    return null;
}
