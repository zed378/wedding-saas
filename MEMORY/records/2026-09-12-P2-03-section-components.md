# P2-03 — Section component library v1

| | |
|---|---|
| **Date** | 2026-09-12 |
| **Task** | `TASKS/PHASE-2-TEMPLATE-RENDERING-AND-PREVIEW.md` § P2-03 |
| **Phase** | Phase 2 |
| **Surface** | web-app, public-invite |
| **Author** | Claude Code session |
| **Commits / PR** | `feat/P2-03-section-components` |
| **Status** | Completed |
| **Spec** | Not required by the card |

---

## What Changed

The eleven components the reference template names, replacing `P2-02`'s stand-ins. Every
visual value comes from the template's theme; the guard now enforces that.

| | |
|---|---|
| Hero, Quote, Couple, Event, Gallery ×2, Maps, Gift, RSVP, Guestbook, Closing | `src/sections/` |
| `styles.ts` | one stylesheet, rendered once at the renderer root |
| `check-renderer-is-generic.mjs` | extended: no colour or font literal |
| Tests | package 43 → 91 |

## Why

`docs/UI-UX/14` § Section Order, the card's seven steps, and `docs/PLAN/07`: these ten
components are what every template is assembled from, so they have to look different under
a different theme with no code change.

## How

**The stylesheet is a string rendered into a `<style>` element.** Not a `.css` import: the
package is consumed by two Next applications and later by whatever renders a share
preview, and a CSS import needs each consumer's build to be told about it. A string needs
nothing, works identically under SSR and in jsdom, and cannot be forgotten by a new
consumer. It costs a few kilobytes per render on a single-document page.

**Not one colour and not one font name in it.** Every visual value is `var(--…)`, set by
the renderer from the theme. That is the mechanism by which one library serves every
template, and it is now a build failure rather than a review note.

**One exception, and it is not a hole.** The hero's scrim — black at 45–65% alpha, white
text over it — is not a palette choice. `docs/UI-UX/14` § Accessibility requires contrast
"even over a photo background", a cover photo is chosen by the couple and can be any
brightness, and darkening the image is the only way to guarantee the ratio. Making it
themeable would let a template author break a requirement `docs/UI-UX/17` does not make
optional. The guard permits achromatic overlay values and nothing else.

**The word-valued theme tokens are translated in the renderer.** `spacing` is
`compact | comfortable | spacious` and `border_radius` is `none | subtle | rounded | full`
— a template author picks a feel, not a pixel count. A component that knew `"comfortable"`
meant `1.25rem` would have to be edited to change the scale for every template at once, so
`theme.ts` maps them to `--space` and `--radius`.

**The countdown does not depend on the clock at first render.** This runs under SSR, and a
server-rendered second count is guaranteed to disagree with the client's by hydration —
React reports that as a mismatch and replaces the subtree. The server emits the labels and
an em dash; the browser fills in the numbers. The interval never starts when every event
has passed, so a page left open after the wedding is not running a timer forever.

**Stored times are read as WIB.** `event_date` and `start_time` are stored without a zone
and the product is Indonesian — `worker-cron` already runs in `Asia/Jakarta` for the same
reason. A guest abroad must not see a countdown seven hours out.

**No map SDK.** ADR-014 and step 3b: a deep link built from the stored coordinates. An
embedded map is among the heaviest things a page can load, against a 150KB budget, and it
bills per load on the one surface with unbounded traffic.

**RSVP and Guestbook are disabled and say so.** Step 6 leaves their wiring to Phase 4. A
live-looking form whose handler is missing is the failure where a guest types a message,
presses send, sees nothing, and concludes the invitation is broken.

## Files and Components Touched

| Path | Change |
|---|---|
| `src/sections/{HeroClassic,EventCardDouble}.tsx` | **New** — the two with state |
| `src/sections/{content-sections,interactive-shells,primitives}.tsx` | **New** |
| `src/sections/styles.ts` | **New** |
| `src/registry.tsx` | the explicit map, replacing the stand-ins |
| `src/theme.ts` | `--space`, `--radius`, `--font-scale` from the word tokens |
| `src/TemplateRenderer.tsx` | renders the stylesheet once at the root |
| `src/resolve-data.spec.ts` | **New** — resolver properties moved out of the renderer spec |
| `src/sections/sections.spec.tsx` | **New** — 48 tests |
| `scripts/check-renderer-is-generic.mjs` | colour and font literals |

## Decisions Made

| Decision | Rationale |
|---|---|
| A stylesheet string, not a `.css` file | Two consumers today and more later; a CSS import is a thing each build must be told about |
| The achromatic scrim is exempt from the colour rule | It is a contrast mechanism, not a palette. Themeable would mean breakable |
| `spacing`/`border_radius` translated in `theme.ts` | A component knowing what "comfortable" means would need editing to change the scale |
| `layout_variant` overrides the component name | A template can name `GalleryGrid` and ask for a carousel; the name is the default, not the decision |
| `EventCardDouble` renders N events | `docs/PLAN/08` has 1..N. "Double" is the common case, not a limit |
| The countdown renders labels before numbers | SSR and the client must agree at hydration |
| Alt text comes from the caption | `alt=""` is right for decoration and wrong for a photo of the couple. An uncaptioned photo is explicitly decorative rather than described as "photo 3 of 12" |
| `@wi/ui` is not imported | It is application chrome and carries the dashboard's palette; an invitation's colours are per-template data |
| The maps link re-checks `^https?://` | `P1-12` validates on the way in; this stops a stored `javascript:` URL becoming an anchor on a page hundreds of guests open |

## Deviations from `docs/`

**Step 7's visual regression snapshots are not implemented.** `docs/FRONTEND/10` § Visual
Regression asks for them and they need a browser that renders pixels — jsdom has no layout
engine, so a snapshot taken here would compare empty boxes and pass forever. The right
home is the Playwright suite, where `P2-13` already has to open these pages for its Core
Web Vitals baseline. Recorded as a follow-up and carried onto `P2-13` rather than claimed.

## Tests Added

48 in the package (43 → 91).

| Group | Cases |
|---|---|
| **Accessibility** | axe over **each of the eleven** components with full data, WCAG 2.1 AA |
| **Empty data** | each of the eleven renders or returns null, **never throws** — a draft is mostly empty and the preview re-renders on every keystroke |
| No artifacts | the parents line absent when neither parent is named; **one parent without a dangling conjunction**; no quote section when there is no quote; no gallery when no photo has a URL; **an uncaptioned photo gets `alt=""`, a captioned one gets the caption** |
| Hero | the scrim exists and is `aria-hidden`; **the photo marked cover wins over the first**; a real `<button>`; **no gate in the editor preview** |
| Maps | a deep link from coordinates; an explicit `maps_url` preferred; **`javascript:` refused** |
| Countdown | the **nearest upcoming** event, not the first; **WIB, not the reader's zone**; nothing to count once everything has passed; never below zero; the breakdown; **labels before numbers for SSR** |
| Gift | copy writes the number; **disabled outside `public`** |
| Shells | both say "akan aktif" and **every control is disabled**; every control labelled |
| Stylesheet | `prefers-reduced-motion`; **a focus ring on every control**; the 44px target |

## Security Verification

| Control | Requirement | How it was verified |
|---|---|---|
| A stored URL cannot become a `javascript:` anchor | `docs/SECURITY/08` | `"refuses a stored maps_url that is not http(s)"` — asserts no link renders **and** `javascript:` is absent from `innerHTML` |
| Text renders as text | `docs/SECURITY/08` | `P2-02`'s test still holds; the guard forbids `dangerouslySetInnerHTML` package-wide |
| Every control is reachable and labelled | `docs/UI-UX/17` | axe per component. **Mutation**: the RSVP name label removed — caught by two named tests, so the axe harness is doing something |
| No colour or font escapes the theme | Card DoD 1 | **Mutation**: `color: #ff00aa` and `font-family: Comic Sans MS` added to the stylesheet; the guard reported both |

## Abuse Cases Covered

- A stored `maps_url` of `javascript:alert(1)` reaching a guest's browser as a link.
- A couple with 200 photos breaking a layout designed for 20 (`max_items`).
- A cover photo bright enough to make white hero text unreadable.

## DoD Verification

- [x] **All ten components render from theme tokens with no hard-coded colour or font** —
      and the guard now fails the build for one, mutation-verified.
- [x] **Empty optional fields leave no visual artifact** — five tests, including the
      dangling-conjunction case that is the specific artifact `docs/PLAN/07` warns about.
- [x] **Each component passes an automated accessibility check** — axe over all eleven.
      The check *including contrast over an image background* is **partly met**: jsdom
      cannot run `color-contrast`, so the scrim is asserted structurally here and the
      pixel measurement belongs to `P2-13`'s browser pass. Named rather than implied.
- [x] **`prefers-reduced-motion` disables non-essential animation.**
- [–] **Visual snapshots exist for each component in both layout variants** — **not done**;
      see Deviations. They need a browser, and `P2-13` is where one is already required.

## What Did Not Work

**1. Two of my own edits wrote control characters into source files.** Building a regex
through a Python heredoc turned `\b` into a literal backspace (0x08), so
`COLOUR_LITERAL` could never match and the colour rule silently did nothing — it reported
"no colour or font literal" over a stylesheet I had just put `#ff00aa` into. Earlier the
same mechanism wrote a NUL byte into `template.service.ts` during `P2-01`.

`check-text-sources.mjs` catches both, and I confirmed it does by planting a backspace and
watching it fail. What it could not do is catch it *before* I noticed, because I had not
re-run it between making the edit and testing the guard by hand. **The lesson is about
tooling, not about the guard**: content containing backslash escapes should be written
with the file-writing tools, not assembled in a shell heredoc.

**Worth stating plainly**: I briefly concluded `check-text-sources` had a gap and said so.
It does not. The guard was fine; the sequence was mine.

**2. The colour rule reported a violation on every correct line first.**
`/font-family:\s*(?!var\()/` looks right and is wrong — `\s*` can match zero characters,
so the lookahead is evaluated immediately after the colon, where the next character is a
space rather than `var(`. It flagged the two declarations that were already correct.
Rewritten to capture the value and test it.

**3. Six `P2-02` tests broke, exactly as that record predicted.** They asserted on the
stand-ins' `JSON.stringify(data)` output. The resolver's own properties moved to
`resolve-data.spec.ts` — where no component change can make them vacuous, which is where
they should have been — and the renderer keeps only the property that is genuinely its
own: that it *applies* the resolver rather than passing the whole invitation.

**4. `.jsx` import specifiers built fine and broke the consumer.** TypeScript accepts
`./sections/HeroClassic.jsx` as referring to a `.tsx` source and then emits that specifier
**verbatim** — but the emitted file is `.js`. The package's own tests passed because they
resolve from source; `public-invite` failed at `dist`. For a `.tsx` file the correct
specifier is `.js`, which reads wrong and is right.

Caught only because `P2-02` insisted on a test that imports the package from each
consumer. Without those two tests this would have surfaced during `P2-08`, a card away
from the change that caused it.

## Follow-Ups and Open Questions

- **Visual regression snapshots** (step 7, DoD 5) — carried to `P2-13`, which already
  needs a browser for Core Web Vitals.
- **Contrast over an image, measured** — same place, same reason.
- **The gallery carousel has no keyboard control of its own.** It is a scroll container,
  which is keyboard-scrollable, but there are no previous/next buttons. `docs/UI-UX/17`
  asks for keyboard operability and scrolling satisfies it literally; a screen-reader user
  would still be better served by explicit controls. Worth revisiting with `P2-10`.
- **`GuestbookWall` renders entries it is given and nothing fetches them.** Phase 4 supplies
  them the way every other section gets data.
- **The `Photo` component has no `srcset`.** `P1-18` produces three variants and the public
  page should choose by viewport. `P2-13`'s budget is where that becomes measurable.

## What to Watch

**The stylesheet ships with every render.** One `<style>` element per renderer instance —
fine for the public page, which mounts one. If the catalogue ever renders many previews on
one screen (`P2-11`), that is many copies of the same CSS, and the fix is to hoist it.

**The scrim exemption is the only colour allowance in the package.** It is expressed as a
pattern that matches achromatic values, so somebody adding `rgb(0 0 0 / 20%)` passes and
somebody adding a tinted overlay does not. That is deliberate, and it is the line to
defend if a future design asks for a coloured wash.
