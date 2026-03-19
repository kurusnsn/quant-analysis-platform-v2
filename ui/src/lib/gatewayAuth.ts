import { SignJWT } from "jose";
import { decode as decodeAuthJwt } from "next-auth/jwt";
import { auth } from "@/lib/auth";
import {
  AUTH_SESSION_COOKIE_BASES,
  extractAuthSessionToken,
  type CookieEntry,
} from "@/lib/authSessionToken";

const gatewaySecret =
  process.env.NEXTAUTH_SECRET ??
  process.env.AUTH_SECRET ??
  "";

const gatewaySecretBytes = new TextEncoder().encode(gatewaySecret);

function getStringClaim(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function decodeSessionPayload(rawToken: string): Promise<Record<string, unknown> | null> {
  if (!gatewaySecret) return null;

  for (const salt of AUTH_SESSION_COOKIE_BASES) {
    try {
      const decoded = await decodeAuthJwt({
        token: rawToken,
        secret: gatewaySecret,
        salt,
      });
      if (decoded && typeof decoded === "object") {
        return decoded as Record<string, unknown>;
      }
    } catch {
      // Try next salt.
    }
  }

  return null;
}

async function signGatewayTokenFromPayload(payload: Record<string, unknown>): Promise<string | null> {
  if (!gatewaySecret) return null;

  const sub = getStringClaim(payload, "sub");
  const email = getStringClaim(payload, "email");
  const name = getStringClaim(payload, "name");
  const plan = getStringClaim(payload, "plan");

  if (!sub && !email) return null;

  const claims: Record<string, string> = {};
  if (sub) claims.sub = sub;
  if (email) claims.email = email;
  if (name) claims.name = name;
  if (plan) claims.plan = plan;

  return await new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(gatewaySecretBytes);
}

export async function buildGatewayAuthorization(
  cookieEntries: CookieEntry[],
): Promise<string | null> {
  // Primary path: use Auth.js session API to resolve identity from cookies.
  try {
    const session = await auth();
    const user = (session?.user ?? null) as Record<string, unknown> | null;
    const sessionClaims: Record<string, unknown> = {};

    const sub = user ? getStringClaim(user, "id") ?? getStringClaim(user, "sub") : null;
    const email = user ? getStringClaim(user, "email") : null;
    const name = user ? getStringClaim(user, "name") : null;
    const sessionRecord = (session as unknown as Record<string, unknown> | null) ?? null;
    const plan =
      getStringClaim(sessionRecord ?? {}, "plan") ??
      (user ? getStringClaim(user, "plan") : null);

    if (sub) sessionClaims.sub = sub;
    if (email) sessionClaims.email = email;
    if (name) sessionClaims.name = name;
    if (plan) sessionClaims.plan = plan;

    if (Object.keys(sessionClaims).length > 0) {
      const signedFromSession = await signGatewayTokenFromPayload(sessionClaims);
      if (signedFromSession) {
        return `Bearer ${signedFromSession}`;
      }
    }
  } catch {
    // Fall through to cookie-token path.
  }

  // Fallback path: decode raw Auth.js session token from cookies.
  const sessionToken = extractAuthSessionToken(cookieEntries);
  if (!sessionToken) return null;

  // Legacy compatibility: keep already-signed JWTs working.
  if (sessionToken.split(".").length === 3) {
    return `Bearer ${sessionToken}`;
  }

  const payload = await decodeSessionPayload(sessionToken);
  if (!payload) {
    return null;
  }

  const signedGatewayToken = await signGatewayTokenFromPayload(payload);
  if (!signedGatewayToken) {
    return null;
  }

  return `Bearer ${signedGatewayToken}`;
}
