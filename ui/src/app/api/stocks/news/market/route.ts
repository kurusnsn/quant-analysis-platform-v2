import { NextRequest } from "next/server";
import { proxyGatewayGet } from "@/app/api/_lib/gatewayProxy";

export async function GET(request: NextRequest) {
  return proxyGatewayGet(request, "/stocks/news/market");
}
