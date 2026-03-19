import { NextResponse, type NextRequest } from "next/server";
import { extractAuthSessionToken } from "@/lib/authSessionToken";

const PUBLIC_PATHS = new Set([
  "/",
  "/home",
  "/landing",
  "/privacy",
  "/terms",
  "/cookies",
  "/refund",
  "/signin",
  "/signup",
  "/auth/callback",
]);

const AUTH_REDIRECT_PATHS = new Set(["/signin", "/signup"]);

const PUBLIC_PREFIXES = ["/stock/", "/watchlist/", "/public"];

const isPublicPath = (pathname: string) =>
  PUBLIC_PATHS.has(pathname) || PUBLIC_PREFIXES.some(p => pathname.startsWith(p));

const safeNext = (value: string | null) => {
  if (!value) return null;
  if (!value.startsWith("/")) return null;
  if (value.startsWith("//")) return null;
  return value;
};

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const devAuthEnabled =
    process.env.NODE_ENV === "development" ||
    process.env.NEXT_PUBLIC_DEV_AUTH === "true";
  const hostHeader = request.headers.get("host")?.toLowerCase() ?? "";
  const isLocalHostHeader =
    hostHeader === "localhost" ||
    hostHeader.startsWith("localhost:") ||
    hostHeader === "127.0.0.1" ||
    hostHeader.startsWith("127.0.0.1:");
  const isLocalHostRequest =
    request.nextUrl.hostname === "localhost" ||
    request.nextUrl.hostname === "127.0.0.1" ||
    isLocalHostHeader;
  const devLocalMode = devAuthEnabled || isLocalHostRequest;

  // In local/dev flows, land directly on the app dashboard instead of the marketing root.
  if (devLocalMode && pathname === "/") {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/home";
    redirectUrl.search = "";
    return NextResponse.redirect(redirectUrl);
  }

  // In dev/local mode the mock user is always authenticated — no session cookie needed.
  if (devLocalMode) {
    if (AUTH_REDIRECT_PATHS.has(pathname)) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/home";
      redirectUrl.search = "";
      return NextResponse.redirect(redirectUrl);
    }
    return NextResponse.next();
  }

  if (isPublicPath(pathname) && !AUTH_REDIRECT_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  // Check NextAuth session cookie
  const sessionToken = extractAuthSessionToken(
    request.cookies.getAll().map((entry) => ({ name: entry.name, value: entry.value })),
  );

  if (!sessionToken) {
    // No session — protect private routes
    if (AUTH_REDIRECT_PATHS.has(pathname)) {
      return NextResponse.next();
    }
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/signin";
    const nextPath = `${request.nextUrl.pathname}${request.nextUrl.search}`;
    redirectUrl.searchParams.set("next", nextPath);
    return NextResponse.redirect(redirectUrl);
  }

  // Has session — redirect away from auth pages
  if (AUTH_REDIRECT_PATHS.has(pathname)) {
    const nextParam = safeNext(request.nextUrl.searchParams.get("next"));
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = nextParam ?? "/home";
    redirectUrl.search = "";
    return NextResponse.redirect(redirectUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api|.*\\..*).*)"],
};
