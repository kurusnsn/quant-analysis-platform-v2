"use client";

import { redirect } from "next/navigation";
import HomeLanding from "@/app/page";

const isDev =
  process.env.NODE_ENV === "development" ||
  process.env.NEXT_PUBLIC_DEV_AUTH === "true";

export default function LandingPreview() {
  if (!isDev) redirect("/home");
  return <HomeLanding />;
}
