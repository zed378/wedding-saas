"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { CreateWizard } from "../../../../components/CreateWizard";

/**
 * P1-21 — `/dashboard/new`. `docs/PLAN/04` § F2.
 *
 * `?template=` is what `docs/UI-UX/11` § "Use This Template" carries from the catalogue, and
 * what `P1-20`'s guard preserves across a login detour. Its presence is what makes the
 * template step disappear.
 *
 * The template list is empty until `P2-01` builds the catalogue API. That is the honest
 * state: a hard-coded list here would be a fixture somebody would later have to find and
 * remove, and the screen already says what it means when there is nothing to choose.
 */
function NewInvitationPage() {
  const router = useRouter();
  const template = useSearchParams().get("template") ?? undefined;

  return (
    <CreateWizard
      presetTemplateId={template}
      templates={[]}
      dashboardHref="/dashboard"
      onCreated={(invitationId) => {
        // `replace`, not `push`: card DoD 3 says the wizard does not reappear, and leaving
        // it in the history means Back lands on a form that would create a second
        // invitation.
        router.replace(`/editor/${invitationId}`);
      }}
    />
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <NewInvitationPage />
    </Suspense>
  );
}
