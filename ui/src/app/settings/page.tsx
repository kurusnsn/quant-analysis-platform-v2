"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useSession, signOut as nextAuthSignOut } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import { Header } from "@/components/Header";
import { getOrCreateDevUser, isDevAuthEnabled } from "@/lib/devAuth";
import {
  checkUsernameAvailability,
  deleteAccount,
  setUsername,
} from "@/lib/userProfile";
import {
  normalizeUsername,
  usernameHelpText,
  validateUsername,
} from "@/lib/username";
import { authFetch } from "@/lib/authFetch";
import { supabase } from "@/lib/supabase";

type UsernameTone = "idle" | "checking" | "available" | "taken" | "invalid";

export default function SettingsPage() {
  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession();
  const [email, setEmail] = useState("");
  const [currentUsername, setCurrentUsername] = useState("");
  const [usernameInput, setUsernameInput] = useState("");
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [isSavingUsername, setIsSavingUsername] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deletePhrase, setDeletePhrase] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordNotice, setPasswordNotice] = useState<string | null>(null);
  const [isSavingPassword, setIsSavingPassword] = useState(false);

  // Avatar from Google profile (read-only)
  const avatarUrl = session?.user?.image ?? null;
  const devAuthEnabled = isDevAuthEnabled();
  const canChangePassword = !devAuthEnabled && Boolean(email);

  const normalizedUsername = useMemo(
    () => normalizeUsername(usernameInput),
    [usernameInput]
  );
  const validation = useMemo(
    () => validateUsername(normalizedUsername),
    [normalizedUsername]
  );
  const usernameChanged = useMemo(
    () => normalizedUsername !== currentUsername,
    [normalizedUsername, currentUsername]
  );

  useEffect(() => {
    if (sessionStatus === "loading") return;

    const devUser = isDevAuthEnabled() ? getOrCreateDevUser() : null;

    if (sessionStatus === "unauthenticated") {
      if (!devUser) {
        router.replace("/signin?next=%2Fsettings");
        return;
      }
    }

    let isMounted = true;

    const applyFallbackProfile = () => {
      if (!isMounted) return;
      const fallbackEmail = session?.user?.email ?? devUser?.email ?? "";
      const fallbackUsername =
        session?.user?.name ??
        devUser?.displayName ??
        devUser?.email?.split("@")[0] ??
        "";

      setEmail(fallbackEmail);
      setCurrentUsername(fallbackUsername);
      setUsernameInput(fallbackUsername);
      setIsLoadingProfile(false);
    };

    const loadProfile = async () => {
      try {
        // Use authFetch to call the gateway profile endpoint
        const resp = await authFetch("/api/user/profile");
        if (!resp.ok) {
          applyFallbackProfile();
          return;
        }
        const profile = await resp.json();
        if (!isMounted) return;

        const resolvedEmail = profile?.email ?? session?.user?.email ?? devUser?.email ?? "";
        const resolvedUsername =
          profile?.displayName ??
          session?.user?.name ??
          devUser?.displayName ??
          devUser?.email?.split("@")[0] ??
          "";

        if (!resolvedUsername) {
          router.replace("/onboarding/username?next=%2Fsettings");
          return;
        }

        setEmail(resolvedEmail);
        setCurrentUsername(resolvedUsername);
        setUsernameInput(resolvedUsername);
      } catch {
        applyFallbackProfile();
      } finally {
        if (isMounted) setIsLoadingProfile(false);
      }
    };

    void loadProfile();

    return () => {
      isMounted = false;
    };
  }, [sessionStatus, session, router]);

  const availabilityQuery = useQuery({
    queryKey: ["username-availability", normalizedUsername],
    queryFn: () => checkUsernameAvailability(normalizedUsername),
    enabled: Boolean(normalizedUsername) && validation.valid && usernameChanged,
    staleTime: 0,
    retry: 1,
  });

  const usernameState = useMemo<{
    tone: UsernameTone;
    message: string | null;
    canSubmit: boolean;
  }>(() => {
    if (!usernameInput) {
      return { tone: "idle", message: null, canSubmit: false };
    }

    if (!validation.valid) {
      return { tone: "invalid", message: usernameHelpText(), canSubmit: false };
    }

    if (!usernameChanged) {
      return { tone: "idle", message: "This is your current username.", canSubmit: false };
    }

    if (availabilityQuery.isFetching) {
      return { tone: "checking", message: "Checking availability...", canSubmit: false };
    }

    if (availabilityQuery.isError) {
      return {
        tone: "invalid",
        message: "Unable to verify username right now.",
        canSubmit: false,
      };
    }

    if (availabilityQuery.data?.available) {
      return { tone: "available", message: "Username available.", canSubmit: true };
    }

    return {
      tone: "taken",
      message: availabilityQuery.data?.reason ?? "Username is taken.",
      canSubmit: false,
    };
  }, [
    availabilityQuery.data?.available,
    availabilityQuery.data?.reason,
    availabilityQuery.isError,
    availabilityQuery.isFetching,
    usernameChanged,
    usernameInput,
    validation.valid,
  ]);

  const handleSaveUsername = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaveError(null);
    setSaveNotice(null);

    if (!validation.valid) {
      setSaveError("Please enter a valid username.");
      return;
    }

    if (!usernameChanged) {
      setSaveNotice("No changes to save.");
      return;
    }

    if (!usernameState.canSubmit) {
      setSaveError("Choose an available username before saving.");
      return;
    }

    setIsSavingUsername(true);

    // With NextAuth, we use the session token passed via authFetch
    const result = await setUsername("nextauth", normalizedUsername);
    if (!result.ok) {
      setSaveError(result.reason);
      setIsSavingUsername(false);
      return;
    }

    setCurrentUsername(normalizedUsername);
    setUsernameInput(normalizedUsername);
    setSaveNotice("Username updated.");
    setIsSavingUsername(false);
  };

  const canConfirmDelete = deletePhrase.trim() === "DELETE";

  const handleChangePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPasswordError(null);
    setPasswordNotice(null);

    if (!canChangePassword) {
      setPasswordError("Password changes are unavailable in local development auth mode.");
      return;
    }

    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordError("Please fill out all password fields.");
      return;
    }

    if (newPassword.length < 6) {
      setPasswordError("New password must be at least 6 characters.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError("New password and confirmation do not match.");
      return;
    }

    if (newPassword === currentPassword) {
      setPasswordError("New password must be different from your current password.");
      return;
    }

    setIsSavingPassword(true);

    try {
      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password: currentPassword,
      });

      if (signInError || !signInData.user) {
        setPasswordError("Current password is incorrect.");
        return;
      }

      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (updateError) {
        setPasswordError(updateError.message || "Unable to update password.");
        return;
      }

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordNotice("Password updated.");
    } catch {
      setPasswordError("Unable to update password right now.");
    } finally {
      await supabase.auth.signOut();
      setIsSavingPassword(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (isDeleting || !canConfirmDelete) return;

    setDeleteError(null);
    setIsDeleting(true);

    const result = await deleteAccount("nextauth");
    if (!result.ok) {
      setDeleteError(result.reason);
      setIsDeleting(false);
      return;
    }

    await nextAuthSignOut({ callbackUrl: "/home" });
  };

  return (
    <div className="min-h-screen flex flex-col bg-background-dark font-sans">
      <Header />

      <main className="flex-1 max-w-[980px] mx-auto w-full p-6 space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Settings</h1>
            <p className="text-xs text-muted">Manage account and billing preferences.</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/settings"
            className="px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold uppercase tracking-wider"
          >
            Account
          </Link>
          <Link
            href="/settings/billing"
            className="px-3 py-1.5 rounded-lg border border-border-color text-xs font-semibold uppercase tracking-wider text-muted hover:text-foreground hover:border-primary/60 transition-colors"
          >
            Billing
          </Link>
        </div>

        {/* Profile Picture (from Google) */}
        <section className="bg-surface border border-border-color rounded-2xl p-6 space-y-4">
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-foreground">Profile Picture</h2>
            <p className="text-xs text-muted">Your profile picture is managed by your Google account.</p>
          </div>

          <div className="flex items-center gap-4">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt="Avatar"
                className="w-20 h-20 rounded-full object-cover border-2 border-border-color"
              />
            ) : (
              <div className="w-20 h-20 rounded-full bg-surface-highlight border-2 border-border-color flex items-center justify-center">
                <span className="material-symbols-outlined text-3xl text-muted">person</span>
              </div>
            )}
            <p className="text-xs text-muted">
              To change your profile picture, update it in your{" "}
              <a
                href="https://myaccount.google.com/personal-info"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:text-primary/80"
              >
                Google Account
              </a>
              .
            </p>
          </div>
        </section>

        {/* Account / Username */}
        <section className="bg-surface border border-border-color rounded-2xl p-6 space-y-6">
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-foreground">Account</h2>
            <p className="text-xs text-muted">Your public username and login identity.</p>
          </div>

          {isLoadingProfile ? (
            <div className="space-y-3">
              <div className="h-10 rounded-2xl bg-surface-highlight animate-pulse" />
              <div className="h-10 rounded-2xl bg-surface-highlight animate-pulse" />
              <div className="h-10 rounded-2xl bg-surface-highlight animate-pulse" />
            </div>
          ) : loadError ? (
            <div className="text-sm text-neon-red border border-neon-red/30 bg-neon-red/5 rounded-lg px-3 py-2">
              {loadError}
            </div>
          ) : (
            <form onSubmit={handleSaveUsername} className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-[0.2em] text-muted">Email</label>
                <input
                  type="text"
                  value={email}
                  readOnly
                  className="w-full h-11 rounded-lg border border-border-color bg-background px-3 text-sm text-muted cursor-not-allowed"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs uppercase tracking-[0.2em] text-muted">Username</label>
                <input
                  type="text"
                  value={usernameInput}
                  onChange={(event) => {
                    setUsernameInput(event.target.value);
                    setSaveError(null);
                    setSaveNotice(null);
                  }}
                  className="w-full h-11 rounded-lg border border-border-color bg-background px-3 text-sm text-foreground placeholder:text-muted focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors"
                  placeholder="market_maven"
                />
                {usernameState.message ? (
                  <p
                    className={`text-xs ${usernameState.tone === "available"
                        ? "text-neon-green"
                        : usernameState.tone === "invalid" || usernameState.tone === "taken"
                          ? "text-neon-red"
                          : "text-muted"
                      }`}
                  >
                    {usernameState.message}
                  </p>
                ) : null}
              </div>

              {saveError ? (
                <div className="text-sm text-neon-red border border-neon-red/30 bg-neon-red/5 rounded-lg px-3 py-2">
                  {saveError}
                </div>
              ) : null}

              {saveNotice ? (
                <div className="text-sm text-neon-green border border-neon-green/30 bg-neon-green/5 rounded-lg px-3 py-2">
                  {saveNotice}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={isSavingUsername || !usernameState.canSubmit}
                className="h-11 px-4 rounded-lg bg-primary text-white text-sm font-semibold uppercase tracking-[0.15em] hover:bg-primary/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isSavingUsername ? "Saving..." : "Save username"}
              </button>
            </form>
          )}
        </section>

        {/* Security / Password */}
        <section className="bg-surface border border-border-color rounded-2xl p-6 space-y-6">
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-foreground">Security</h2>
            <p className="text-xs text-muted">Change your email/password login credentials.</p>
          </div>

          {canChangePassword ? (
            <form onSubmit={handleChangePassword} className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-[0.2em] text-muted">Current password</label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(event) => {
                    setCurrentPassword(event.target.value);
                    setPasswordError(null);
                    setPasswordNotice(null);
                  }}
                  className="w-full h-11 rounded-lg border border-border-color bg-background px-3 text-sm text-foreground placeholder:text-muted focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors"
                  placeholder="Enter current password"
                  disabled={isSavingPassword}
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs uppercase tracking-[0.2em] text-muted">New password</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(event) => {
                    setNewPassword(event.target.value);
                    setPasswordError(null);
                    setPasswordNotice(null);
                  }}
                  className="w-full h-11 rounded-lg border border-border-color bg-background px-3 text-sm text-foreground placeholder:text-muted focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors"
                  placeholder="At least 6 characters"
                  disabled={isSavingPassword}
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs uppercase tracking-[0.2em] text-muted">Confirm new password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => {
                    setConfirmPassword(event.target.value);
                    setPasswordError(null);
                    setPasswordNotice(null);
                  }}
                  className="w-full h-11 rounded-lg border border-border-color bg-background px-3 text-sm text-foreground placeholder:text-muted focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors"
                  placeholder="Re-enter new password"
                  disabled={isSavingPassword}
                />
              </div>

              <p className="text-xs text-muted">
                This updates your Supabase email/password login. Google OAuth sign-in is unchanged.
              </p>

              {passwordError ? (
                <div className="text-sm text-neon-red border border-neon-red/30 bg-neon-red/5 rounded-lg px-3 py-2">
                  {passwordError}
                </div>
              ) : null}

              {passwordNotice ? (
                <div className="text-sm text-neon-green border border-neon-green/30 bg-neon-green/5 rounded-lg px-3 py-2">
                  {passwordNotice}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={isSavingPassword}
                className="h-11 px-4 rounded-lg bg-primary text-white text-sm font-semibold uppercase tracking-[0.15em] hover:bg-primary/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isSavingPassword ? "Updating..." : "Change password"}
              </button>
            </form>
          ) : (
            <div className="text-sm text-muted border border-border-color/80 bg-background rounded-lg px-3 py-2">
              Password changes are available only with real email/password authentication.
            </div>
          )}
        </section>

        {/* Danger Zone */}
        <section className="bg-surface border border-neon-red/30 rounded-2xl p-6 space-y-4">
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-neon-red">Danger Zone</h2>
            <p className="text-xs text-muted">
              Deleting your account removes your local profile, watchlists, and history.
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              setDeleteError(null);
              setDeletePhrase("");
              setIsDeleteModalOpen(true);
            }}
            className="h-11 px-4 rounded-lg border border-neon-red/40 text-neon-red text-sm font-semibold uppercase tracking-[0.15em] hover:bg-neon-red/10 transition-colors"
          >
            Delete account
          </button>
        </section>
      </main>

      {isDeleteModalOpen ? (
        <div className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-surface border border-neon-red/40 rounded-2xl p-6 space-y-4">
            <div className="space-y-2">
              <h3 className="text-lg font-bold text-foreground">Delete account permanently?</h3>
              <p className="text-sm text-muted">
                This action cannot be undone. Type <span className="font-semibold text-neon-red">DELETE</span> to continue.
              </p>
            </div>

            <input
              type="text"
              value={deletePhrase}
              onChange={(event) => setDeletePhrase(event.target.value)}
              className="w-full h-11 rounded-lg border border-border-color bg-background px-3 text-sm text-foreground placeholder:text-muted focus:border-neon-red focus:ring-1 focus:ring-neon-red outline-none transition-colors"
              placeholder="DELETE"
            />

            {deleteError ? (
              <div className="text-sm text-neon-red border border-neon-red/30 bg-neon-red/5 rounded-lg px-3 py-2">
                {deleteError}
              </div>
            ) : null}

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsDeleteModalOpen(false)}
                className="h-10 px-4 rounded-lg border border-border-color text-sm text-muted hover:text-foreground hover:border-primary/60 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteAccount()}
                disabled={!canConfirmDelete || isDeleting}
                className="h-10 px-4 rounded-lg bg-neon-red text-white text-sm font-semibold hover:bg-neon-red/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isDeleting ? "Deleting..." : "Delete account"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
