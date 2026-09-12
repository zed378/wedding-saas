"use client";

import { InvitationList } from "../../../components/InvitationList";

/**
 * P1-21 — `/dashboard`. `docs/FRONTEND/01`.
 *
 * The public host comes from configuration rather than a literal: the invitation lives on a
 * different hostname from the application (`docs/PLAN/10`, ADR-024), and hard-coding it here
 * would put a staging link on a production card.
 */
export default function DashboardPage() {
  const publicHost =
    process.env["NEXT_PUBLIC_INVITE_ORIGIN"] ??
    "https://invitation.vizunicum.my.id";

  return (
    <main id="main" className="mx-auto w-full max-w-5xl px-4 py-10">
      <h1 className="mb-6 text-2xl font-semibold text-text">Dasbor</h1>
      <InvitationList publicHost={publicHost} createHref="/dashboard/new" />
    </main>
  );
}
