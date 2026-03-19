"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  DEV_USER_COOKIE,
  DEV_USER_STORAGE_KEY,
  encodeDevUser,
  getOrCreateDevUser,
  isDevAuthEnabled,
} from "@/lib/devAuth";

export function DevAuthBridge() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!isDevAuthEnabled()) return;

    const user = getOrCreateDevUser();
    if (!user) return;

    const encoded = encodeDevUser(user);
    const cookieValue = encodeURIComponent(encoded);
    document.cookie = `${DEV_USER_COOKIE}=${cookieValue}; path=/; max-age=86400; samesite=lax`;

    if (pathname === "/signin" || pathname === "/signup") {
      const nextValue = searchParams.get("next");
      const nextPath =
        nextValue && nextValue.startsWith("/") && !nextValue.startsWith("//")
          ? nextValue
          : "/";
      router.replace(nextPath);
    }
  }, [pathname, router, searchParams]);

  return null;
}

export function ensureDevUserStorage(payload: {
  id: string;
  email: string;
  displayName?: string;
  plan?: "free" | "pro";
}) {
  if (typeof window === "undefined") return;
  if (process.env.NODE_ENV !== "development") return;
  localStorage.setItem(DEV_USER_STORAGE_KEY, JSON.stringify(payload));
}
