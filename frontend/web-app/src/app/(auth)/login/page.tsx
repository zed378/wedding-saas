"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { LoginForm } from "../../../components/LoginForm";
import { GoogleSignIn } from "../../../components/GoogleSignIn";
import { NEXT_PARAM, safeNext } from "../../../lib/safe-next";

/**
 * P1-20 — `/login`. `docs/FRONTEND/01`.
 *
 * The page owns navigation and the `next` parameter; `LoginForm` owns the form. That split
 * is what lets the form be tested without a router, and it keeps the open-redirect guard in
 * one place: `safeNext` runs here, once, and the form is handed a destination that has
 * already been validated.
 */

function LoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get(NEXT_PARAM));
  const carry = `?${NEXT_PARAM}=${encodeURIComponent(next)}`;

  return (
    <LoginForm
      onAuthenticated={() => {
        // `replace`, not `push`: the login page must not sit in the history behind a
        // signed-in user, or Back lands them on a form they have already completed.
        router.replace(next);
      }}
      registerHref={`/register${carry}`}
      forgotHref="/forgot-password"
      alternatives={
        <GoogleSignIn
          onAuthenticated={() => {
            router.replace(next);
          }}
        />
      }
    />
  );
}

/**
 * `useSearchParams` suspends during prerender, and Next requires the boundary to be
 * explicit. The fallback is the page's own frame rather than a spinner, so the layout does
 * not jump when the parameters resolve.
 */
export default function Page() {
  return (
    <Suspense fallback={null}>
      <LoginPage />
    </Suspense>
  );
}
