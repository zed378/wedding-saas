"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { RegisterForm } from "../../../components/RegisterForm";
import { NEXT_PARAM, safeNext } from "../../../lib/safe-next";

/**
 * P1-20 — `/register`.
 *
 * `next` is carried through registration so that a template chosen while logged out survives
 * the whole detour (`docs/UI-UX/11` § "Use This Template"): catalogue → register → verify
 * notice → login → back to the template. Dropping it at any one of those steps strands the
 * user on a generic dashboard having forgotten what they came to do.
 */
function RegisterPage() {
  const params = useSearchParams();
  const next = safeNext(params.get(NEXT_PARAM));

  return <RegisterForm loginHref="/login" next={next} />;
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <RegisterPage />
    </Suspense>
  );
}
