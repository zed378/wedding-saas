"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { VerifyEmailPanel } from "../../../components/VerifyEmailPanel";

/** P1-20 — `/verify-email?token=…`, the landing page for the emailed link. */
function VerifyEmailPage() {
  const token = useSearchParams().get("token") ?? undefined;

  return (
    <VerifyEmailPanel
      token={token}
      loginHref="/login"
      dashboardHref="/dashboard"
    />
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailPage />
    </Suspense>
  );
}
