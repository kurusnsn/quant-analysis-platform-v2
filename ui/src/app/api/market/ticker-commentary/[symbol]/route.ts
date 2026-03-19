import { NextRequest } from "next/server";
import { proxyGatewayGet } from "@/app/api/_lib/gatewayProxy";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params;
  return proxyGatewayGet(request, `/market/ticker-commentary/${symbol}`);
}
