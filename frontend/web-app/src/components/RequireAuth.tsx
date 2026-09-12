"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { useAuth } from "../lib/auth";
import { loginUrlFor } from "../lib/safe-next";

/**
 * P1-20 step 3 — the route guard. `docs/FRONTEND/01` § Route Guards.
 *
 * ## This is a user-experience control, not a security boundary
 *
 * Worth being blunt about, because a guard named `RequireAuth` reads like one. It decides
 * what to *render*; it decides nothing about what a user may *reach*. Every piece of data on
 * a protected page comes from an API call whose ownership is checked server-side
 * (`docs/SECURITY/05`), and `docs/FRONTEND/01` says so in the route table itself: "client-side
 * ownership check for a fast UX, ALWAYS revalidated server-side on every API call".
 *
 * Deleting this component would make the application unpleasant. It would not expose a
 * single row.
 *
 * ## `restoring` is a third state, not a slow `anonymous`
 *
 * The access token lives in memory only, so a page reload starts with no token and one
 * refresh call in flight. A guard that treated that moment as "not signed in" would bounce
 * every reload of every protected page to the login screen, and the user would arrive back
 * where they started a second later — the flicker that makes an app feel broken.
 */

export interface RequireAuthProps {
  readonly children: ReactNode;
  /** Shown while the session is being restored. */
  readonly fallback?: ReactNode;
}

export function RequireAuth({ children, fallback }: RequireAuthProps) {
  const { status } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  useEffect(() => {
    if (status !== "anonymous") return;

    const search = params.toString();
    // The whole intended URL, query string included: `docs/UI-UX/11` wants a user who picked
    // a template before signing in to come back to that template, and the template is in the
    // query (`/dashboard/new?template=elegant-rose`).
    router.replace(
      loginUrlFor(pathname, search.length > 0 ? `?${search}` : ""),
    );
  }, [status, router, pathname, params]);

  if (status === "authenticated") return <>{children}</>;

  // `restoring` and `anonymous` both render the fallback. The second is a single frame
  // before the redirect takes effect; rendering the children there would flash private
  // chrome at somebody who is not signed in.
  return <>{fallback ?? null}</>;
}
