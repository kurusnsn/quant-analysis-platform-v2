import {
  DEV_USER_HEADER,
  encodeDevUser,
  getOrCreateDevUser,
  isDevAuthEnabled,
} from "@/lib/devAuth";
import { extractAuthSessionTokenFromCookieHeader } from "@/lib/authSessionToken";

export async function authFetch(
  input: RequestInfo | URL,
  init?: RequestInit
) {
  const headers = new Headers(init?.headers ?? {});

  // Try to get the NextAuth session token from cookies
  const sessionToken =
    typeof document !== "undefined"
      ? (extractAuthSessionTokenFromCookieHeader(document.cookie) ?? "")
      : "";

  if (sessionToken && !headers.has("Authorization")) {
    // For server-to-server calls with NextAuth, we pass the session token
    // The gateway will validate it via a shared NEXTAUTH_SECRET
    headers.set("Authorization", `Bearer ${sessionToken}`);
  } else if (
    !sessionToken &&
    isDevAuthEnabled() &&
    !headers.has(DEV_USER_HEADER)
  ) {
    const devUser = getOrCreateDevUser();
    if (devUser) {
      headers.set(DEV_USER_HEADER, encodeDevUser(devUser));
    }
  }

  return fetch(input, {
    ...init,
    headers,
  });
}
