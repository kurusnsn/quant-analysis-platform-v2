import type { Metadata } from "next";
import { Suspense } from "react";
import SignInClient from "./SignInClient";
import { buildMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";

export const metadata: Metadata = buildMetadata({
  title: "Sign In",
  description: "Sign in to your QuantPlatform account.",
  canonical: "/signin",
  noIndex: true,
});

export default function SignInPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading...</p>}>
      <SignInClient />
    </Suspense>
  );
}
