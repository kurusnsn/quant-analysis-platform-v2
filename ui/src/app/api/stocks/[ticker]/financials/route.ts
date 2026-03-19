import { NextRequest, NextResponse } from "next/server";
import { proxyGatewayGet } from "@/app/api/_lib/gatewayProxy";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ ticker: string }> },
) {
  const { ticker } = await context.params;
  if (!ticker) {
    return NextResponse.json({ error: "Ticker is required" }, { status: 400 });
  }

  return proxyGatewayGet(request, `/stocks/${encodeURIComponent(ticker)}/financials`);
}
