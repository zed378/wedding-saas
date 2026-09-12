"use client";

import { use } from "react";

import { EditorScreen } from "../../../../editor/EditorScreen";

/**
 * P1-22 — `/editor/[invitationId]`. `docs/FRONTEND/01`.
 *
 * Protected by the `(app)` group's layout rather than by anything here — and, as
 * `docs/FRONTEND/01` says in the route table itself, the client-side check is "for a fast UX,
 * ALWAYS revalidated server-side on every API call". The load below is that revalidation: a
 * non-owner gets a 404 from the API and sees the not-found state, whatever the guard thought.
 */
export default function Page({
  params,
}: {
  readonly params: Promise<{ invitationId: string }>;
}) {
  const { invitationId } = use(params);

  return <EditorScreen invitationId={invitationId} />;
}
