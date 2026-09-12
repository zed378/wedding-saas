"use client";

import { Button } from "@wi/ui";

/**
 * P2-04 step 2 — the route boundary for the authenticated application.
 *
 * `docs/FRONTEND/08` § Boundary Levels: the route level shows "a context-specific
 * message", between the app root's general error page and the section boundaries inside
 * the renderer.
 *
 * ## What it deliberately does not say
 *
 * No `error.message` and no `digest`. The message of an unhandled error on this surface
 * can carry a query fragment, an internal path, or an identifier the person looking at
 * the screen has no business seeing — and on a shared machine, neither does anyone behind
 * them. `docs/DEVOPS/05`'s reasoning about health endpoints applies here for the same
 * reason: an error page is an unauthenticated-adjacent surface that should disclose
 * nothing about the infrastructure.
 *
 * The detail belongs in error tracking, where it has a `user_id` attached and an audience
 * who can act on it.
 *
 * ## Retry before reload
 *
 * `reset()` re-renders the segment without a full navigation, which keeps anything held
 * above this boundary — including the auth session in memory (`P1-20`) — rather than
 * forcing a token refresh round trip on what may have been a transient failure.
 */
export default function AppError({
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  return (
    <main className="mx-auto grid min-h-[60vh] max-w-md place-items-center px-4 text-center">
      <div>
        <h1 className="mb-2 text-lg font-semibold text-text">
          Halaman ini gagal dimuat
        </h1>
        <p className="mb-6 text-sm text-text-muted">
          Terjadi gangguan sesaat. Coba lagi — data Anda tidak terpengaruh.
        </p>
        <Button type="button" onClick={reset}>
          Coba lagi
        </Button>
      </div>
    </main>
  );
}
