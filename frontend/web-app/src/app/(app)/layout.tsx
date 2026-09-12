"use client";

import { Suspense, type ReactNode } from "react";

import { RequireAuth } from "../../components/RequireAuth";

/**
 * P1-21 — the authenticated shell.
 *
 * `RequireAuth` wraps the whole group rather than each page, so a route added under
 * `(app)/` is protected by existing rather than by somebody remembering. `docs/FRONTEND/01`'s
 * route table marks every path here protected, and the way that rule breaks is a new page
 * whose author did not know there was a wrapper to add.
 *
 * It is still a UX control and not a boundary — every page's data comes from an API call
 * checked server-side. See the note in `RequireAuth` itself.
 */
export default function AppLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <Suspense fallback={null}>
      <RequireAuth fallback={<LoadingShell />}>{children}</RequireAuth>
    </Suspense>
  );
}

/**
 * What a user sees while the session is being restored.
 *
 * Announced, because the alternative is a blank page that a screen reader describes as
 * nothing at all for as long as the refresh takes.
 */
function LoadingShell() {
  return (
    <main id="main" className="mx-auto w-full max-w-5xl px-4 py-10">
      <p role="status" aria-live="polite" className="text-sm text-text-muted">
        Memuat…
      </p>
    </main>
  );
}
