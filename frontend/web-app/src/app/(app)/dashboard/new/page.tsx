"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { CreateWizard } from "../../../../components/CreateWizard";
import { useAuth } from "../../../../lib/auth";
import {
  listTemplateChoices,
  type TemplateChoice,
} from "../../../../lib/invitations";

/**
 * P1-21 — `/dashboard/new`. `docs/PLAN/04` § F2.
 *
 * `?template=` is what `docs/UI-UX/11` § "Use This Template" carries from the catalogue, and
 * what `P1-20`'s guard preserves across a login detour. Its presence is what makes the
 * template step disappear.
 *
 * `P2-11` connected the template list to the catalogue API. Until then it was `[]`, and a
 * user who arrived without `?template=` was told there were no templates. A failed load
 * leaves the list empty, which the wizard already explains, rather than blocking a user
 * who arrived WITH a preselected template and does not need the list at all.
 */
function NewInvitationPage() {
  const router = useRouter();
  const { api } = useAuth();
  const template = useSearchParams().get("template") ?? undefined;
  const [templates, setTemplates] = useState<readonly TemplateChoice[]>([]);

  useEffect(() => {
    let cancelled = false;
    listTemplateChoices(api)
      .then((choices) => {
        if (!cancelled) setTemplates(choices);
      })
      .catch(() => {
        // Left empty; see above.
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  return (
    <CreateWizard
      presetTemplateId={template}
      templates={templates}
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
