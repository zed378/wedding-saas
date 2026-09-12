# P1-20 — Frontend: authentication screens

| | |
|---|---|
| **Date** | 2026-09-12 |
| **Task** | `TASKS/PHASE-1-AUTH-AND-INVITATION-CORE.md` § P1-20 |
| **Phase** | Phase 1 |
| **Surface** | web-app |
| **Author** | Claude Code session |
| **Commits / PR** | `feat/P1-20-auth-screens` |
| **Status** | Completed |
| **Spec** | Not required by the card; written into this record |

---

## What Changed

Five screens — login, register, forgot password, reset password, verify email — wired to the
real API, plus the session provider, the route guard, and Google sign-in. First real pages in
the web app; `P0-22` built the design system and the client, and this is the first task to
assemble them into something a user can use.

## Why

`docs/FRONTEND/01` § Route Guards, `docs/FRONTEND/02` § Auth Token Storage, `docs/API/01`,
`docs/UI-UX/05` and `docs/UI-UX/17`.

## How

**The access token is in memory and nowhere else.** `accessTokenStore` from `@wi/api-client`
is a closure over a variable, and no code in this app reads or writes a token — which is what
lets `scripts/check-token-storage.mjs` be a text check. The cost is that a reload loses it,
and `AuthProvider` answers that by calling `/auth/me`: the HTTP-only refresh cookie the
browser still holds is exchanged for a new access token, so the session survives without
anything readable by a script being stored.

**`restoring` is a third state, not a slow `anonymous`.** A guard that treated the moment
before that refresh resolves as "not signed in" would bounce every reload of every protected
page to login and back a second later — the flicker that makes an application feel broken.

**`safeNext` is an allowlist, not a sanitiser.** The post-login destination arrives in a query
parameter, so anybody can choose it: `…/login?next=https://evil.test/` puts a victim on a
phishing page one click after they typed their real password. The value must be a same-origin
path — one leading slash, no scheme, no authority — and everything else becomes the dashboard.
Twelve rejection cases, including the three that look like paths: `//evil.test`, `/\evil.test`
and `/\tjavascript:…`.

**The query string travels with the path.** `docs/UI-UX/11` § "Use This Template" asks for a
user who picked a template while logged out to come back to that template, and the template is
a query parameter. Keeping only the path would strand them on `/dashboard/new` with nothing
selected — one step short of what they came to do, which is the exact complaint the
requirement exists to prevent.

**The screens never distinguish what the server refuses to distinguish.** `INVALID_CREDENTIALS`
gets one message and is not attached to the email field; registration shows one confirmation
whether or not the address was taken; forgot-password says "if that address is registered".
The backend spent two tasks removing user enumeration, and a helpful frontend is the easiest
place to hand it back.

**A rate limit says how long.** `Retry-After` is now read by `@wi/api-client` and rendered as
"coba lagi dalam 2 menit". A user who does not know how long will retry immediately and spend
the rest of their budget.

**The Google `id_token` is opaque here.** Obtained, posted, never decoded. `P1-04` verifies the
signature and takes the email from the verified claims, because anything the frontend extracted
would be attacker-supplied by the time it arrived.

## Files and Components Touched

| Path | Change |
|---|---|
| `frontend/web-app/src/lib/safe-next.ts` | **New** — the open-redirect guard |
| `frontend/web-app/src/lib/error-messages.ts` | **New** — API code → actionable Indonesian |
| `frontend/web-app/src/lib/auth.tsx` | **New** — `AuthProvider`, `useAuth`, session restore |
| `frontend/web-app/src/components/` | **New** — `AuthShell`, `LoginForm`, `RegisterForm`, `PasswordResetForms`, `VerifyEmailPanel`, `GoogleSignIn`, `RequireAuth` |
| `frontend/web-app/src/app/(auth)/*/page.tsx` | **New** — five routes |
| `frontend/web-app/src/app/layout.tsx` | `AuthProvider` inside `ToastProvider` |
| `packages/api-client/src/errors.ts`, `client.ts` | `retryAfterSeconds` from the `Retry-After` header |
| `frontend/web-app/vitest.config.mts`, `test/setup.ts` | **New** — the component test harness |
| `frontend/web-app/package.json` | vitest, testing-library, axe-core, `@vitejs/plugin-react` |
| `frontend/web-app/test/*.spec.tsx` | **New** — 56 tests |
| `e2e/tests/auth-screens.e2e.ts` | **New** — 10 browser checks |

## Decisions Made

| Decision | Rationale |
|---|---|
| Forms live in `components/`, routes in `app/` | A route file needs Next's router; a form does not. The split is what lets the DoD's token test drive a real submit without standing up a router |
| `safeNext` rejects rather than repairs | A repaired URL is still a URL somebody else chose |
| An auth path is never a post-login destination | The guard would bounce the user straight back off it, and the pair looks like a login that did not work |
| Registration does **not** sign the user in | `P1-02` answers a duplicate address with the same 202 as a new one, so the response cannot carry a session without revealing which happened |
| `verify-email` redeems on mount, guarded by a ref | Asking for a second click to complete an action already committed to is a step that exists only because it was easier to build. The ref is for React's development double-invoke, which would present a one-time token twice |
| `GoogleSignIn` renders nothing when unconfigured | A button that cannot work is a dead end on the login page. Absent, not disabled |
| `RequireAuth` is documented as a UX control, not a boundary | Every protected page's data comes from an API call checked server-side. Deleting the guard would make the app unpleasant and expose nothing |
| `@vitejs/plugin-react` for the test transform | Next's tsconfig sets `jsx: "preserve"`; esbuild reads the same file and leaves JSX untouched. `esbuild.tsconfigRaw` does not override a resolved tsconfig |

## Deviations from `docs/`

None. The routes match `docs/FRONTEND/01`'s table and the endpoints match `docs/API/01`.

## Tests Added

66 (56 component, 10 browser). Web-app tests 0 → 56.

| Group | Cases |
|---|---|
| `safeNext` | 12 rejections including protocol-relative, backslash, tab-before-scheme; the query preserved; auth paths refused; `loginUrlFor` round-trips through `safeNext` |
| **Token storage** | **nothing in `localStorage` or `sessionStorage` after a login**, asserted as "both stores are empty" *and* as "the token value appears nowhere in either" |
| Error states | one message for wrong credentials; **the email field is not marked invalid for a wrong password**; a 429 renders "2 menit"; offline reports a connection problem; a field error attaches to its field |
| Enumeration | registration's single confirmation; forgot-password's "if that address is registered" |
| Expired links | a reset with no token offers a new one; an expired token offers a resend; **verify-email redeems exactly once** |
| **Accessibility** | axe over all five screens; the error is announced not only coloured; the login form is fully keyboard-reachable; **the submit button keeps focus while loading** |
| Route guard | renders for a signed-in user; **does not redirect while restoring**; sends an anonymous visitor to login with the path; **carries the query string**; never renders children for an anonymous visitor |
| Browser | axe over seven routes; **`color-contrast` confirmed to have run**; the skip link is first to focus; no token in storage after a page load |

## Security Verification

| Control | Requirement | How it was verified |
|---|---|---|
| No token in persistent storage | Card DoD 1, `FRONTEND/02` | Two component tests plus a browser check. The API is a stubbed `fetch` rather than a mocked client, because it is the client that holds the token and mocking it would mock the control |
| No open redirect on the login page | `SECURITY/08` | 12 rejection cases in `safe-next.spec.ts` |
| The login page does not reveal whether an address exists | `API/01` § Error Cases | One message, and a test asserting the email field is **not** marked invalid |
| Registration does not reveal a duplicate | `P1-02` | One confirmation state, asserted |
| A Google `id_token` is not trusted client-side | `P1-04` | The component posts it unread; nothing in the file decodes it |
| Private chrome is never shown to an anonymous visitor | `FRONTEND/01` | `"never renders the children for an anonymous visitor, even for one frame"` |

## Abuse Cases Covered

An attacker-supplied `next` pointing off-origin, protocol-relative, backslash-prefixed or
carrying a `javascript:` scheme; probing the login page for valid addresses; probing
registration for taken addresses; replaying a spent verification link; a stolen access token
read out of browser storage.

## DoD Verification

- [x] No token is ever written to `localStorage` or `sessionStorage`; a test asserts both are
      empty after login. Two tests, plus a browser-level check after a page load.
- [x] Login from a protected URL returns the user to that URL. `RequireAuth` writes the
      destination, the login page reads it, and a test round-trips the pair.
- [x] A template chosen before login survives registration. The query string travels with the
      path through the guard, through `safeNext`, and through the register screen's
      "continue" link.
- [x] Every screen passes the automated accessibility check. In jsdom for all five, and in a
      real browser for seven routes — where `color-contrast` can actually run, which a test
      asserts explicitly.

## What Did Not Work

**1. The colour-contrast rule cannot run in jsdom, and a green axe pass would have hidden
that.** `@wi/ui`'s helper disables it because jsdom has no layout engine — every element has
zero size and no computed colour. Five screens passing axe in jsdom therefore says nothing
about `docs/UI-UX/08`'s 4.5:1 requirement. The browser suite covers it, and it contains a test
named `"colour contrast is actually checked here"` asserting the rule appears among those that
ran: without it, the browser pass could silently degrade to the same subset jsdom covers while
every test still reported green.

**2. Vitest could not parse a single `.tsx` file, and the error said "syntax error".** Next's
tsconfig sets `jsx: "preserve"` because Next owns the transform; esbuild reads the same file,
leaves the JSX alone, and the failure surfaces as invalid JS in the test. `esbuild.jsx` and
`esbuild.tsconfigRaw` both failed to override it. `@vitejs/plugin-react` — which `admin`
already uses — does the transform instead.

**3. `Retry-After` did not exist.** The card asks for "429 with a wait hint" and the client had
no way to produce one. Added to `@wi/api-client`, read only in the delay-seconds form: the
header also permits an HTTP date, and a clock-skewed client computing a negative wait would
tell the user to retry immediately.

**4. A stale `dist/` made a correct change look wrong.** The `Retry-After` test failed after
the client was patched, because `@wi/api-client` is consumed through its built output and the
build had not been re-run. Worth noting because the symptom — a feature that is demonstrably
in the source and demonstrably absent at runtime — reads as a logic bug for a while.

## Follow-Ups and Open Questions

- **`/dashboard` does not exist yet.** `safeNext`'s default points at it and `RequireAuth` is
  not applied to anything. `P1-21` builds the dashboard and is where the guard first wraps a
  real page.
- **Google sign-in is untested end to end.** There is no `NEXT_PUBLIC_GOOGLE_CLIENT_ID` in any
  environment, so the component renders nothing and the browser suite never sees it. The
  backend half has `P1-04`'s tests; the handshake itself is unexercised until a client id
  exists.
- **The password policy is stated as helper text, not validated live.** `docs/SECURITY/03`'s
  rules are enforced server-side and the screen relays the rejection. A live checklist is
  `docs/UI-UX/05`'s nicety and belongs with the settings screen in `P1-21`+.
- **`/auth/me` runs on every page load of every route**, including public ones. Harmless now;
  when marketing pages arrive it should be scoped to routes that need a session.

## What to Watch

**`safeNext` is the only thing between the login page and an open redirect**, and it is a
function somebody could reasonably decide to "simplify". Every rejection in
`safe-next.spec.ts` is a real URL shape that a browser treats as absolute; the ones that look
like paths (`//host`, `/\host`) are the ones a simplification would drop first.

**The token rule is held by an absence.** No file in `frontend/web-app` names `localStorage`
in connection with a token, which is what makes `check-token-storage.mjs` meaningful. A
"remember me" feature is the change that would break it, and it would look entirely
reasonable in review.
