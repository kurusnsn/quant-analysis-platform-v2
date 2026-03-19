import { Suspense } from "react";
import UsernameOnboardingClient from "./UsernameOnboardingClient";

export const dynamic = "force-dynamic";

export default function UsernameOnboardingPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading...</p>}>
      <UsernameOnboardingClient />
    </Suspense>
  );
}
