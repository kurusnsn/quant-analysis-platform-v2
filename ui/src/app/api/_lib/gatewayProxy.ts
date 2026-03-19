import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  DEV_USER_COOKIE,
  DEV_USER_HEADER,
  decodeDevUser,
  encodeDevUser,
  getConfiguredDevUser,
} from "@/lib/devAuth";
import { buildGatewayAuthorization } from "@/lib/gatewayAuth";

const rawApiUrl =
  process.env.API_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://localhost:8000/api";
const normalizedApiUrl = rawApiUrl.replace(/\/+$/, "");
const API_BASE = normalizedApiUrl.endsWith("/api")
  ? normalizedApiUrl
  : `${normalizedApiUrl}/api`;

export function buildGatewayUrl(pathname: string, searchParams?: URLSearchParams) {
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const query = searchParams?.toString();
  return `${API_BASE}${normalizedPath}${query ? `?${query}` : ""}`;
}

async function buildForwardHeaders(request: NextRequest) {
  const headers = new Headers();
  const cookieStore = await cookies();
  const isDev = process.env.NODE_ENV === "development";

  const incomingAuth = request.headers.get("authorization");
  const incomingDevHeader = request.headers.get(DEV_USER_HEADER);

  const gatewayAuthorization = await buildGatewayAuthorization(
    cookieStore.getAll().map((entry) => ({ name: entry.name, value: entry.value })),
  );

  const devCookie = isDev ? cookieStore.get(DEV_USER_COOKIE)?.value : null;
  const devUserFromCookie = devCookie ? decodeDevUser(devCookie) : null;
  const devUser = devUserFromCookie ?? (isDev ? getConfiguredDevUser() : null);

  if (incomingAuth) {
    headers.set("Authorization", incomingAuth);
  } else if (gatewayAuthorization) {
    headers.set("Authorization", gatewayAuthorization);
  }

  if (incomingDevHeader) {
    headers.set(DEV_USER_HEADER, incomingDevHeader);
  } else if (devUser) {
    headers.set(DEV_USER_HEADER, encodeDevUser(devUser));
  }

  return headers;
}

export async function proxyGatewayGet(request: NextRequest, pathname: string) {
  const upstreamUrl = buildGatewayUrl(pathname, request.nextUrl.searchParams);
  const headers = await buildForwardHeaders(request);

  try {
    const response = await fetch(upstreamUrl, {
      method: "GET",
      headers,
      cache: "no-store",
    });

    const body = await response.text();
    return new NextResponse(body, {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("content-type") ?? "application/json",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Gateway request failed",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
    );
  }
}
