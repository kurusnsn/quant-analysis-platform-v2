export type CookieEntry = {
  name: string;
  value: string;
};

export const AUTH_SESSION_COOKIE_BASES = [
  "__Secure-authjs.session-token",
  "authjs.session-token",
] as const;

function readCookieValue(entries: CookieEntry[], baseName: string): string | null {
  const exact = entries.find((entry) => entry.name === baseName)?.value ?? null;
  if (exact) return exact;

  const prefix = `${baseName}.`;
  const chunks = entries
    .map((entry) => {
      if (!entry.name.startsWith(prefix)) return null;
      const suffix = entry.name.slice(prefix.length);
      const index = Number.parseInt(suffix, 10);
      if (!Number.isFinite(index)) return null;
      return { index, value: entry.value };
    })
    .filter((entry): entry is { index: number; value: string } => entry !== null)
    .sort((a, b) => a.index - b.index);

  if (chunks.length === 0) return null;
  return chunks.map((chunk) => chunk.value).join("");
}

export function extractAuthSessionToken(entries: CookieEntry[]): string | null {
  for (const baseName of AUTH_SESSION_COOKIE_BASES) {
    const value = readCookieValue(entries, baseName);
    if (value) return value;
  }
  return null;
}

function parseCookieHeader(cookieHeader: string): CookieEntry[] {
  if (!cookieHeader) return [];

  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const index = part.indexOf("=");
      if (index < 0) return null;
      return {
        name: part.slice(0, index).trim(),
        value: part.slice(index + 1),
      };
    })
    .filter((entry): entry is CookieEntry => entry !== null && entry.name.length > 0);
}

export function extractAuthSessionTokenFromCookieHeader(
  cookieHeader: string | null | undefined,
): string | null {
  if (!cookieHeader) return null;
  return extractAuthSessionToken(parseCookieHeader(cookieHeader));
}
