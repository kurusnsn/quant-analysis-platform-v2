"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { signIn } from "next-auth/react";
import { BrandLogo } from "@/components/BrandLogo";
import { supabase } from "@/lib/supabase";

export default function SignUpPage() {
  const searchParams = useSearchParams();
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [isCredLoading, setIsCredLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [verifyPending, setVerifyPending] = useState(false);
  const nextPath = useMemo(() => {
    const nextValue = searchParams.get("next");
    if (!nextValue || !nextValue.startsWith("/") || nextValue.startsWith("//")) {
      return "/home";
    }
    return nextValue;
  }, [searchParams]);

  const handleGoogle = async () => {
    setError(null);
    setIsGoogleLoading(true);
    try {
      await signIn("google", { callbackUrl: nextPath });
    } catch {
      setError("Something went wrong. Please try again.");
      setIsGoogleLoading(false);
    }
  };

  const handleCredentials = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    if (!email || !password) {
      setError("Please enter your email and password.");
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    setIsCredLoading(true);
    try {
      // Register via Supabase Auth — Supabase sends a confirmation email
      const { error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });

      if (signUpError) {
        setError(signUpError.message || "Registration failed. This email may already be in use.");
        setIsCredLoading(false);
        return;
      }

      // Show "check your inbox" — don't sign in until email is confirmed
      setVerifyPending(true);
    } catch {
      setError("Something went wrong. Please try again.");
      setIsCredLoading(false);
    }
  };

  const isLoading = isGoogleLoading || isCredLoading;

  if (verifyPending) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center px-6">
        <div className="max-w-md w-full border border-border-color rounded-2xl bg-surface p-8 text-center space-y-4">
          <div className="size-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto">
            <span className="material-symbols-outlined">mark_email_unread</span>
          </div>
          <h1 className="text-xl font-bold tracking-tight">Check your inbox</h1>
          <p className="text-sm text-muted leading-relaxed">
            We sent a confirmation link to <span className="text-foreground font-medium">{email}</span>.
            Click it to activate your account, then sign in.
          </p>
          <Link
            href="/signin"
            className="inline-flex items-center justify-center px-4 py-2 rounded-full border border-border-color text-xs uppercase tracking-[0.2em] text-muted hover:text-foreground hover:border-primary/60 transition-colors"
          >
            Go to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="max-w-[1200px] mx-auto px-6 py-8 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3" aria-label="QuantPlatform home">
          <BrandLogo height={36} />
          <span className="text-[11px] font-bold tracking-[0.32em] text-primary uppercase">
            QUANT PLATFORM
          </span>
        </Link>
        <Link
          href="/signin"
          className="text-xs font-semibold uppercase tracking-[0.2em] text-muted hover:text-foreground transition-colors"
        >
          Sign in
        </Link>
      </header>

      <main className="max-w-[1100px] mx-auto px-6 pb-16 grid gap-10 lg:grid-cols-[1.1fr_0.9fr] items-center">
        <section className="space-y-6">
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
            Create your QuantPlatform account.
          </h1>
          <p className="text-base text-muted leading-relaxed">
            Unlock watchlists, alerts, and saved market synthesis history.
          </p>
        </section>

        <section className="bg-surface border border-border-color rounded-2xl p-8 shadow-2xl space-y-6">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.2em] text-muted">
              Get started
            </p>
            <h2 className="text-xl font-bold tracking-tight">Sign up</h2>
          </div>

          <button
            type="button"
            onClick={handleGoogle}
            disabled={isLoading}
            className="w-full px-4 py-3 rounded-xl border border-border-color bg-background text-foreground text-sm font-semibold hover:border-primary/60 transition-colors disabled:opacity-60"
          >
            {isGoogleLoading ? "Redirecting..." : "Continue with Google"}
          </button>

          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-border-color" />
            <span className="text-xs text-muted uppercase tracking-widest">or</span>
            <div className="flex-1 h-px bg-border-color" />
          </div>

          <form onSubmit={handleCredentials} className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs uppercase tracking-[0.2em] text-muted">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full h-11 rounded-lg border border-border-color bg-background px-3 text-sm text-foreground placeholder:text-muted focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors"
                placeholder="you@example.com"
                disabled={isLoading}
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs uppercase tracking-[0.2em] text-muted">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full h-11 rounded-lg border border-border-color bg-background px-3 text-sm text-foreground placeholder:text-muted focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors"
                placeholder="Min. 6 characters"
                disabled={isLoading}
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full h-11 rounded-lg bg-primary text-white font-semibold text-sm uppercase tracking-[0.2em] hover:bg-primary/90 transition-colors disabled:opacity-60"
            >
              {isCredLoading ? "Creating account..." : "Create account"}
            </button>
          </form>

          {error ? (
            <div className="text-sm text-neon-red border border-neon-red/30 bg-neon-red/5 rounded-lg px-3 py-2">
              {error}
            </div>
          ) : null}

          <p className="text-xs text-muted">
            Already have an account?{" "}
            <Link href="/signin" className="text-primary hover:text-primary/80">
              Sign in
            </Link>
          </p>
        </section>
      </main>
    </div>
  );
}
