"use client";

import { ForgotPasswordForm } from "../../../components/PasswordResetForms";

/** P1-20 — `/forgot-password`. No parameters, so no Suspense boundary. */
export default function Page() {
  return <ForgotPasswordForm loginHref="/login" />;
}
