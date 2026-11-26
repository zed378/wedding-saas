/**
 * P1-20 — where a user is sent after logging in.
 *
 * `docs/FRONTEND/01` § Route Guards: a protected route redirects to `/login` and saves the
 * intended URL so the user comes back to it. The saved URL travels in a query parameter,
 * which means it is **attacker-controllable**: anyone can send
 * `https://app.vizunicum.my.id/login?next=https://evil.test/` and the victim lands on a
 * convincing phishing page one click after typing their real password. That is an open
 * redirect, and a login page is the single worst place in a product to have one.
 *
 * So this is an allowlist, not a sanitiser. The value must be a **same-origin path**: it
 * starts with exactly one `/`, and it carries no scheme and no authority. Everything else
 * becomes the default. There is no branch that tries to "clean up" a URL — a cleaned URL is
 * still a URL somebody else chose.
 */

/** Where a user goes when there is nothing better. `docs/FRONTEND/01`. */
export const DEFAULT_AFTER_LOGIN = "/dashboard";

/**
 * The query parameter carrying the intended destination.
 *
 * `next`, not `redirect` or `returnUrl`, and named in one place so the guard that writes it
 * and the login page that reads it cannot disagree — a mismatch would fail silently by
 * sending everybody to the dashboard.
 */
export const NEXT_PARAM = "next";

/**
 * The safe destination for a raw `next` value.
 *
 * Rejected, every one of them falling back to the dashboard:
 *
 *   `https://evil.test/x`   — a scheme and an authority
 *   `//evil.test/x`         — protocol-relative; a browser treats it as a full URL
 *   `/\evil.test`           — a backslash, which several browsers normalise to `/`
 *   `javascript:alert(1)`   — a scheme with no slash at all
 *   `dashboard`             — relative, and therefore ambiguous about what it is relative to
 *   `/login`                — a loop back to the page the user just left
 */
export function safeNext(
  raw: string | null | undefined,
  fallback = DEFAULT_AFTER_LOGIN,
): string {
  if (typeof raw !== "string" || raw.length === 0) return fallback;

  // Control characters and whitespace first: a browser strips some of them before parsing a
  // URL, so `/\tjavascript:…` and `/%0A/evil` must never reach the checks below intact.
  // The class is written with escape sequences, not literal characters: a source file
  // containing a real NUL byte is one git classifies as binary and stops diffing.
  // oxlint-disable-next-line no-control-regex -- Reject controls before browsers normalize them.
  if (/[\u0000-\u001F\u007F\s]/.test(raw)) return fallback;

  // Exactly one leading slash, and nothing that could introduce an authority.
  if (!raw.startsWith("/")) return fallback;
  if (raw.startsWith("//")) return fallback;
  if (raw.startsWith("/\\")) return fallback;

  // A scheme cannot appear in a path, and a path that contains a colon before the first
  // slash-or-query is a scheme wearing a disguise.
  const firstSegment = raw.slice(1).split(/[/?#]/, 1)[0] ?? "";
  if (firstSegment.includes(":")) return fallback;

  // A user who just authenticated must not be sent back to an auth page: the guard would
  // bounce them forward again and the pair would look like a broken login.
  if (isAuthPath(raw)) return fallback;

  return raw;
}

/** The public auth routes, which an authenticated user has no reason to see. */
const AUTH_PATHS = [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
];

export function isAuthPath(pathname: string): boolean {
  const path = pathname.split(/[?#]/, 1)[0] ?? "";
  return AUTH_PATHS.some(
    (auth) => path === auth || path.startsWith(`${auth}/`),
  );
}

/**
 * The login URL a guard should send an unauthenticated visitor to.
 *
 * The whole path **with its query string**, because `docs/UI-UX/11` § "Use This Template"
 * asks for a user who picked a template while logged out to come back to that flow rather
 * than to a generic dashboard — and the template is in the query string
 * (`/dashboard/new?template=elegant-rose`). Dropping it would strand them one step short of
 * what they were doing, which is the exact complaint the requirement exists to prevent.
 */
export function loginUrlFor(pathname: string, search = ""): string {
  const intended = `${pathname}${search}`;
  if (isAuthPath(pathname)) return "/login";

  return `/login?${NEXT_PARAM}=${encodeURIComponent(intended)}`;
}
