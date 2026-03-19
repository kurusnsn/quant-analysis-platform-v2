"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { signIn } from "next-auth/react";
import { BrandLogo } from "@/components/BrandLogo";

export default function SignInPage() {
  const searchParams = useSearchParams();
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [isCredLoading, setIsCredLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
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

    setIsCredLoading(true);
    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        setError("Invalid email or password.");
        setIsCredLoading(false);
        return;
      }

      window.location.href = nextPath;
    } catch {
      setError("Something went wrong. Please try again.");
      setIsCredLoading(false);
    }
  };

  const errorMessage = searchParams.get("error");
  const isVerified = searchParams.get("verified") === "true";
  const isLoading = isGoogleLoading || isCredLoading;

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
          href="/signup"
          className="text-xs font-semibold uppercase tracking-[0.2em] text-muted hover:text-foreground transition-colors"
        >
          Create account
        </Link>
      </header>

      <main className="max-w-[1100px] mx-auto px-6 pb-16 grid gap-10 lg:grid-cols-[1.1fr_0.9fr] items-center">
        <section className="space-y-6">
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
            Sign in to your QuantPlatform workspace.
          </h1>
          <p className="text-base text-muted leading-relaxed">
            Continue monitoring watchlists, risk signals, and your saved market
            synthesis history.
          </p>
        </section>

        <section className="bg-surface border border-border-color rounded-2xl p-8 shadow-2xl space-y-6">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.2em] text-muted">
              Welcome back
            </p>
            <h2 className="text-xl font-bold tracking-tight">Sign in</h2>
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
                placeholder="••••••••"
                disabled={isLoading}
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full h-11 rounded-lg bg-primary text-white font-semibold text-sm uppercase tracking-[0.2em] hover:bg-primary/90 transition-colors disabled:opacity-60"
            >
              {isCredLoading ? "Signing in..." : "Sign in"}
            </button>
          </form>

          {isVerified && (
            <div className="text-sm text-neon-green border border-neon-green/30 bg-neon-green/5 rounded-lg px-3 py-2">
              Email confirmed — you can now sign in.
            </div>
          )}

          {(error || errorMessage) ? (
            <div className="text-sm text-neon-red border border-neon-red/30 bg-neon-red/5 rounded-lg px-3 py-2">
              {error || (errorMessage === "OAuthAccountNotLinked"
                ? "This email is already associated with another sign-in method."
                : errorMessage === "CredentialsSignin"
                  ? "Invalid email or password."
                  : "Authentication failed. Please try again.")}
            </div>
          ) : null}

          <p className="text-xs text-muted">
            New here?{" "}
            <Link href="/signup" className="text-primary hover:text-primary/80">
              Create an account
            </Link>
          </p>
        </section>
      </main>
    </div>
  );
}
