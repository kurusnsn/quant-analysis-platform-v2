"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

export default function AuthCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [message, setMessage] = useState("Verifying your email...");
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    const tokenHash = searchParams.get("token_hash");
    const type = searchParams.get("type") as "signup" | "email" | "recovery" | null;

    if (tokenHash && type) {
      // Supabase email confirmation link
      supabase.auth.verifyOtp({ token_hash: tokenHash, type }).then(({ error }) => {
        if (error) {
          setMessage("This link has expired or is invalid. Please sign up again.");
          setIsError(true);
        } else {
          // Account confirmed — sign out of any Supabase session (NextAuth manages sessions)
          supabase.auth.signOut();
          setMessage("Email confirmed! Redirecting to sign in...");
          setTimeout(() => router.replace("/signin?verified=true"), 1500);
        }
      });
    } else {
      // No token — fallback redirect (e.g. old OAuth flows)
      setTimeout(() => router.replace("/home"), 1500);
    }
  }, [router, searchParams]);

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center px-6">
      <div className="max-w-lg w-full border border-border-color rounded-2xl bg-surface p-8 text-center space-y-4">
        <div className={`size-12 rounded-full flex items-center justify-center mx-auto ${isError ? "bg-neon-red/10 text-neon-red" : "bg-primary/10 text-primary"}`}>
          <span className="material-symbols-outlined">{isError ? "error" : "lock"}</span>
        </div>
        <h1 className="text-xl font-bold tracking-tight">
          {isError ? "Link invalid" : "Authenticating"}
        </h1>
        <p className="text-sm text-muted">{message}</p>
        <Link
          href="/signin"
          className="inline-flex items-center justify-center px-4 py-2 rounded-full border border-border-color text-xs uppercase tracking-[0.2em] text-muted hover:text-foreground hover:border-primary/60 transition-colors"
        >
          Back to sign in
        </Link>
      </div>
    </div>
  );
}
