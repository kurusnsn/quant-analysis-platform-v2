export type SameSite = "lax" | "strict" | "none";

type SetCookieOptions = {
  maxAgeSeconds?: number;
  path?: string;
  sameSite?: SameSite;
  secure?: boolean;
};

export function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null;

  const cookies = document.cookie ? document.cookie.split("; ") : [];
  for (const entry of cookies) {
    const idx = entry.indexOf("=");
    if (idx < 0) continue;
    const key = entry.slice(0, idx);
    if (key !== name) continue;
    return decodeURIComponent(entry.slice(idx + 1));
  }

  return null;
}

export function setCookie(name: string, value: string, options: SetCookieOptions = {}): void {
  if (typeof document === "undefined") return;

  const path = options.path ?? "/";
  const sameSite = options.sameSite ?? "lax";
  const secure =
    options.secure ?? (typeof window !== "undefined" && window.location.protocol === "https:");

  const parts: string[] = [
    `${name}=${encodeURIComponent(value)}`,
    `path=${path}`,
    `samesite=${sameSite}`,
  ];

  if (typeof options.maxAgeSeconds === "number") {
    parts.push(`max-age=${options.maxAgeSeconds}`);
  }
  if (secure) {
    parts.push("secure");
  }

  document.cookie = parts.join("; ");
}

export function deleteCookie(name: string, path: string = "/"): void {
  // Domain-scoped cookies might require an explicit domain to fully remove; we
  // still delete the common path-scoped variant.
  setCookie(name, "", { maxAgeSeconds: 0, path });
}

