# P2-10 — Public Page Interactions

| | |
|---|---|
| **Task** | `P2-10` |
| **Date** | 2026-09-13 |
| **Branch** | `feat/P2-10-public-interactions` |
| **Status** | DONE — one step not applicable, one DoD item needing a real device |
| **Spec** | Not required (`Spec required: No`) |

---

## What changed

The public page is now interactive: a guest sees their own name if the link carried one, a
countdown to the next event, a cover gate that actually gates, a copy button that confirms
it copied, and a share bar that works with JavaScript switched off.

Two defects from earlier phases were found and fixed in the process, and both had a passing
test over them.

## Why

`docs/UI-UX/14` § Key Interactions is short and every item on it is the difference between
a page that reads as a product and one that reads as a rendering of a database row. The
constraint that shapes all of it is in `docs/ARCHITECTURE/06` § Cache Segmentation: none of
it may make the server's response vary per visitor, or one wedding becomes four hundred
distinct cache entries.

## How

**`?to=` is read after hydration, never on the server.** `GuestGreeting` reads
`window.location.search` in an effect. The cost is a one-frame flash, which
`docs/FRONTEND/07` § Personalization accepts in those words. The benefit beyond caching is
one nobody asked for: a link preview can never name the guest it was addressed to, so a
forwarded card in a group chat does not reveal who had the link first.

**The `?to=` value is cleaned, not just escaped.** React escapes text, so markup cannot
become HTML — that is asserted anyway, because it is the property that would matter most if
it changed. What the cleaner adds is the part React does not do: it strips zero-width and
bidirectional-override characters and collapses whitespace. `U+202E` is the interesting one
— it reverses the direction of everything after it, so a crafted name can make the
surrounding page read backwards, and **nothing about that is markup**, so no escaping layer
anywhere in the stack would catch it.

**The share link is server-rendered and canonical.** It takes the invitation's own address
as a prop rather than reading the address bar, for two separate reasons: a guest on a
forwarded `?to=` link must not pass somebody else's personalization on, and a value that
does not vary per visitor has no business being client-side — the first version produced
`href="#"` until hydration and did not work at all without JavaScript.

**Feedback is announced, not only shown.** Both copy buttons write into a live region that
is in the document from the start; one added at the moment it gains content is frequently
not announced at all. Both also handle the clipboard being absent (insecure origin) or
rejecting (document not focused), because silence looks exactly like a button that does
nothing.

## Files touched

**New**
- `frontend/public-invite/src/lib/guest-name.ts`
- `frontend/public-invite/src/components/{GuestGreeting,ShareBar,CoverGate}.tsx`
- `frontend/public-invite/test/{guest-name,share-bar,cover-gate}.spec.tsx`

**Modified**
- `frontend/public-invite/src/app/[slug]/page.tsx` — the gate wraps the invitation; the greeting and share bar are mounted
- `frontend/public-invite/test-ssr/initial-html.ssr.ts` — 6 tests: the gate's no-JS path, and personalization's absence from the server's markup
- `packages/template-renderer/src/sections/HeroClassic.tsx` — the non-functional gate removed
- `packages/template-renderer/src/sections/content-sections.tsx` — the copy button rewritten
- `packages/template-renderer/src/sections/sections.spec.tsx` — the vacuous announcement test replaced; the hero gate test inverted
- `frontend/public-invite/package.json` — `@testing-library/user-event`
- `scripts/check-no-hardcoded-fields.mjs` — a false positive fixed (below)

## Decisions made

No ADR. Nothing here deviates from `docs/`; the two fixes below restore behaviour the
documents already specified.

**Step 6 — background music — is not applicable.** `docs/UI-UX/14` says *"Background music
(if the section is active)"*, and there is no music section: `SECTION_KEYS` in
`@wi/schema` has ten entries and none of them is `music`. Building a mute control for a
section that does not exist would mean inventing the section, which needs a component
registry entry, a schema key and a template that uses it — none of which is this card's.
The cover gate's real `<button>` click is the user gesture such a section would need, and
it exists.

## Tests added

| File | Count | What it proves |
|---|---|---|
| `test/guest-name.spec.tsx` | 17 | Parameter reading; empty and malformed values; whitespace collapse; the bidi override; four invisible characters; the length cap; that ordinary Indonesian names survive untouched; and that markup renders as text in the real component |
| `test/share-bar.spec.tsx` | 11 | The WhatsApp link's content and target; the canonical address rather than the address bar's; copy success, refusal and absence; the live region's presence before the click; tab order; Enter |
| `test/cover-gate.spec.tsx` | 8 | The invitation stays in the document while closed; clipped rather than hidden or `aria-hidden`; the `noscript` release rule; opening by click and by Enter; focus moved off the removed control; `tabIndex=-1` |
| `test-ssr/initial-html.ssr.ts` | +6 (24) | The gate's closed state, its content and its `noscript` rule in the real HTML; identical markup with and without `?to=`; the guest's name absent from the markup and from the `<head>`; the share bar server-rendered |
| `packages/template-renderer/src/sections/sections.spec.tsx` | +2, 1 replaced (106) | The copy button's announcement and its failure message; the hero carries no gate in any of the three modes |

**The countdown needed no new tests.** `P2-03` already covers step 1 completely — nearest
upcoming event, WIB rather than the reader's timezone, nothing to count once every event has
passed, and never counting below zero. Re-asserting it here would have been duplication.

Totals after: public-invite **107** unit plus **24** SSR, template-renderer **106**, API
integration **841**, web-app **246**. `pnpm verify` green.

## Security verification

Named tests, mutation-verified — each mutation reverted after its run:

| Mutation | Test that failed |
|---|---|
| The bidirectional-override range removed from the cleaner | *"strips a right-to-left override"* |
| The length cap removed | *"truncates a very long value rather than rejecting it"* |
| The gate given `aria-hidden` while closed | *"keeps the whole invitation in the document"*, *"clips the content rather than hiding it"* |
| Copy reading `window.location.href` instead of the canonical URL | *"copies the canonical address, not the one in the address bar"* |

The first mutation is the one worth keeping. It had to be applied from a script file rather
than through `sed`, because the target is a backslash escape inside a string literal — which
is the same class of problem as the escape bugs recorded below.

**Not a security claim I can make**: the DoD asks that copy, share and the gate work *on
iOS Safari and Android Chrome*. jsdom is not a browser. What is verified is the logic and
the DOM contract; the device check is below.

## Definition of Done

- [x] The countdown targets the nearest future event and survives a passed event. — `P2-03`'s tests, which cover it completely; re-asserted here would be duplication.
- [x] Personalization never affects the server response or the cache key. — the rendered markup is byte-identical with and without `?to=`, and the name appears nowhere in it. **With one caveat that belongs in the deployment**, below.
- [x] A `?to=` value containing markup renders as text, never as HTML. — two tests against the real component, plus the cleaner's own suite.
- [ ] **Copy, share and the cover gate work on iOS Safari and Android Chrome. — NOT VERIFIED.** jsdom is not a browser and `P0-17` has no device lab. The clipboard's two real-world failure modes are handled and tested; iOS Safari's autoplay policy has nothing to act on yet (no music section). This needs a real device and belongs with `P2-13`'s browser pass and `docs/TESTING/06`.

**Global DoD**: as the preceding tasks, with item 9 (CI) waived for the same reason. No spec
was required for this card.

### The caveat on the cache key

Next serializes the request's query string into its own RSC router payload — inside a
`<script>`, always, whatever the page does. No app-level change removes it. So two requests
differing only in `?to=` produce **identical rendered markup** and slightly different bytes.

That matters for exactly one thing: a CDN in front of this host must **strip query
parameters from the cache key**, or `?to=` will segment the cache at the edge regardless of
what the application does. It is a deployment configuration item, recorded in the follow-ups
and belonging to `P2-13`/`docs/DEVOPS/03` rather than to this code.

## What did not work

**The cover gate did not gate anything.** `P2-03` put an "Open Invitation" button inside
`HeroClassic`, and clicking it hid **the button** — every section below stayed rendered and
scrollable. A section has no access to its siblings and cannot contain them, so the "single
readable first screen" `docs/UI-UX/14` asks for never happened, and the test over it asserted
only that a button existed.

Moved to `public-invite`'s `CoverGate`, which wraps the whole invitation. The hero's button
was removed rather than left as a second, non-functional one, and the test that asserted its
presence is now a test asserting its absence in all three render modes.

The gate raised a hazard the original never had to think about: rendered closed, a guest
without JavaScript would be stuck on a cover with a dead button. A `<noscript>` stylesheet
releases the clip and hides the control, so no-JS is simply the full invitation. That also
had to be written as markup on the element rather than as a JSX child — a `<style>` child
renders on the server and comes out empty on the client, because a `noscript`'s contents are
inert text once scripting is on.

**The copy button's announcement never existed.** Its comment said the confirmation was in
an `aria-live` region. The code set `button.nextElementSibling.textContent` and there was no
sibling, so a guest tapping "Salin nomor" got nothing at all. The test was called *"offers a
copy button that announces the result"* and asserted only that `writeText` had been called.

A test named after a behaviour it does not check is worse than no test, because the
behaviour looks covered. Both halves are now asserted, including the refusal path.

**A guard false positive, and why it was fixed rather than exempted.** The shortest canonical
field path is the bare word `events`, and `check-no-hardcoded-fields` matched it as a
substring — so `pointer-events-none` in a Tailwind class flagged a file that hard-codes
nothing. The tempting fix is an allowlist entry. That would have been wrong: an exemption
granted to silence a false positive is how a guard stops being believed. The matcher now
requires a whole token, verified by re-introducing a real violation and watching it fail.

**Escapes through a shell, twice more.** A bidirectional-override range would not survive `sed` through the
Bash tool, and an earlier `node -e` lost its backticks to shell interpretation. The rule
recorded in `P2-04`, `P2-08` and `P2-09` now has a corollary: a **mutation** that touches an
escape gets its own script file too, not a one-liner. There is one in the scratchpad.

**A newline is whitespace, not a control character to delete.** The first cleaner stripped the whole
U+0000 to U+001F range, so `Andi\nPratama` became `AndiPratama` — two words joined. The
range now stops before the whitespace controls and lets the collapse handle them. A test
caught it, which is the only reason this is a paragraph rather than a bug.

## Follow-ups

- **The CDN must strip query parameters from the cache key.** `P2-13` or `docs/DEVOPS/03`.
- **A real-device pass** for copy, share and the gate — `P2-13`, `docs/TESTING/06`.
- **`P4-*`** replaces the RSVP and guestbook shells; both currently render a disabled form
  that says so.
- **A music section**, if it is ever wanted, needs a `SECTION_KEYS` entry, a component, and a
  template that names it. The gesture the mute control would depend on already exists.
- **`P2-13`** inherits the 138.6KB of a 150KB budget. This task added three small client
  components; the SSR budget test still passes, and it is the thing that will notice.

## What to watch in production

- **A guest reporting that the invitation "won't open"** is the gate with JavaScript blocked
  and the `noscript` rule not applying — an extension or a strict content policy could do
  it. The rule is asserted in the served HTML, so the first thing to check is whether the
  page was served at all.
- **`?to=` values appearing in analytics or logs.** They are guest names. Nothing logs them
  today, and nothing should start.
- **Clipboard failures** are silent by design in the browser and announced by the page. A
  rise in "tidak bisa disalin" would mean an insecure origin somewhere — most likely a proxy
  serving the page over HTTP.
