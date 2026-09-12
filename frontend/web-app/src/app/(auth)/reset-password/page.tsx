"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { ResetPasswordForm } from "../../../components/PasswordResetForms";

/**
 * P1-20 — `/reset-password?token=…`.
 *
 * The token stays in the URL and is never stored. It is single-use and short-lived
 * (`P1-05`), and putting it anywhere durable would outlive both properties.
 */
function ResetPasswordPage() {
  const token = useSearchParams().get("token") ?? undefined;

  return (
    <ResetPasswordForm
      token={token}
      loginHref="/login"
      forgotHref="/forgot-password"
    />
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordPage />
    </Suspense>
  );
}
