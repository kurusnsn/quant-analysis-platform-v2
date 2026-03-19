import type { Metadata } from "next";
import { Suspense } from "react";
import SignUpClient from "./SignUpClient";
import { buildMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";

export const metadata: Metadata = buildMetadata({
  title: "Sign Up",
  description: "Create your free QuantPlatform account and start AI-powered market research.",
  canonical: "/signup",
});

export default function SignUpPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading...</p>}>
      <SignUpClient />
    </Suspense>
  );
}
