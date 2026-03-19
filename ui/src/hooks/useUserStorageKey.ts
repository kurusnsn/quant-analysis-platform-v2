"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import {
  DEV_USER_STORAGE_KEY,
  getDevUserFromStorage,
  isDevAuthEnabled,
} from "@/lib/devAuth";

const ANON_ID = "anon";
const resolveDevUserId = () =>
  isDevAuthEnabled() ? getDevUserFromStorage()?.id ?? ANON_ID : ANON_ID;

export function useUserStorageKey(baseKey: string) {
  const { data: session, status } = useSession();

  const [userId, setUserId] = useState<string>(() => {
    if (typeof window === "undefined") return ANON_ID;
    return resolveDevUserId();
  });

  useEffect(() => {
    if (status === "loading") return;

    if (session?.user?.email) {
      // Use email hash as stable user ID since NextAuth doesn't expose sub consistently
      setUserId(session.user.email);
    } else {
      setUserId(resolveDevUserId());
    }
  }, [session, status]);

  // Listen for dev auth storage changes
  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== DEV_USER_STORAGE_KEY) return;
      setUserId(resolveDevUserId());
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const storageKey = userId === ANON_ID ? baseKey : `${baseKey}:${userId}`;

  return { storageKey, userId, isAnonymous: userId === ANON_ID };
}
