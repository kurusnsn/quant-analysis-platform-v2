"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  checkUsernameAvailability,
  getUserProfile,
  setUsername,
} from "@/lib/userProfile";
import {
  normalizeUsername,
  usernameHelpText,
  validateUsername,
} from "@/lib/username";
import { BrandLogo } from "@/components/BrandLogo";

type UsernameStatus = "idle" | "checking" | "available" | "taken" | "invalid";

export default function UsernameOnboardingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, status: sessionStatus } = useSession();
  const [username, setUsernameInput] = useState("");
  const [status, setStatus] = useState<UsernameStatus>("idle");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [storedRedirect, setStoredRedirect] = useState<string | null>(null);

  const normalized = useMemo(() => normalizeUsername(username), [username]);
  const nextPath = useMemo(() => {
    const nextValue = searchParams.get("next");
    if (nextValue && nextValue.startsWith("/") && !nextValue.startsWith("//")) {
      return nextValue;
    }
    if (storedRedirect && storedRedirect.startsWith("/") && !storedRedirect.startsWith("//")) {
      return storedRedirect;
    }
    return "/home";
  }, [searchParams, storedRedirect]);

  useEffect(() => {
    const pending = localStorage.getItem("pending_username");
    if (pending) {
      setUsernameInput(pending);
    }
    const redirect = localStorage.getItem("post_auth_redirect");
    if (redirect) {
      setStoredRedirect(redirect);
    }
  }, []);

  useEffect(() => {
    if (!username) {
      setStatus("idle");
      setStatusMessage(null);
      return;
    }

    const validation = validateUsername(normalized);
    if (!validation.valid) {
      setStatus("invalid");
      setStatusMessage(usernameHelpText());
      return;
    }

    setStatus("checking");
    const timer = setTimeout(async () => {
      try {
        const result = await checkUsernameAvailability(normalized);
        setStatus(result.available ? "available" : "taken");
        setStatusMessage(
          result.available ? "Username available." : "Username is taken."
        );
      } catch {
        setStatus("invalid");
        setStatusMessage("Unable to verify username right now.");
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [normalized, username]);

  useEffect(() => {
    if (sessionStatus === "loading") return;

    if (sessionStatus === "unauthenticated") {
      router.replace("/signin");
      return;
    }

    // Check if user already has a profile/username
    const init = async () => {
      try {
        const profile = await getUserProfile("nextauth");
        if (profile?.displayName) {
          router.replace("/home");
        }
      } catch {
        // Ignore for now; user can still set username.
      }
    };

    init();
  }, [sessionStatus, router]);

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const validation = validateUsername(normalized);
    if (!validation.valid) {
      setError("Please enter a valid username.");
      return;
    }

    if (status === "taken") {
      setError("That username is already taken.");
      return;
    }

    if (sessionStatus !== "authenticated") {
      setError("Please sign in again.");
      return;
    }

    setIsLoading(true);

    const result = await setUsername("nextauth", normalized);
    if (!result.ok) {
      setError(result.reason);
      setIsLoading(false);
      return;
    }

    localStorage.removeItem("pending_username");
    localStorage.removeItem("pending_account_name");
    localStorage.removeItem("post_auth_redirect");
    router.replace(nextPath);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="max-w-[1200px] mx-auto px-6 py-8 flex items-center justify-between">
        <Link href="/home" className="flex items-center" aria-label="QuantPlatform home">
          <BrandLogo height={36} />
        </Link>
      </header>

      <main className="max-w-[800px] mx-auto px-6 pb-16">
        <section className="bg-surface border border-border-color rounded-2xl p-8 shadow-2xl space-y-6">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.2em] text-muted">
              Final step
            </p>
            <h1 className="text-2xl font-bold tracking-tight">
              Choose your username
            </h1>
            <p className="text-sm text-muted">{usernameHelpText()}</p>
          </div>

          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs uppercase tracking-[0.2em] text-muted">
                Username
              </label>
              <input
                type="text"
                required
                value={username}
                onChange={(event) => setUsernameInput(event.target.value)}
                className="w-full h-11 rounded-lg border border-border-color bg-background px-3 text-sm text-foreground placeholder:text-muted focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors"
                placeholder="market_maven"
              />
              {statusMessage ? (
                <p
                  className={`text-xs ${status === "available"
                      ? "text-neon-green"
                      : status === "taken" || status === "invalid"
                        ? "text-neon-red"
                        : "text-muted"
                    }`}
                >
                  {statusMessage}
                </p>
              ) : null}
            </div>

            {error ? (
              <div className="text-sm text-neon-red border border-neon-red/30 bg-neon-red/5 rounded-lg px-3 py-2">
                {error}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={isLoading || status === "checking"}
              className="w-full h-11 rounded-lg bg-primary text-white font-semibold text-sm uppercase tracking-[0.2em] hover:bg-primary/90 transition-colors disabled:opacity-60"
            >
              {isLoading ? "Saving..." : "Save username"}
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}
