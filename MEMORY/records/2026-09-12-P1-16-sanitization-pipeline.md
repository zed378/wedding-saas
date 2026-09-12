# P1-16 — Free-text sanitization pipeline

| | |
|---|---|
| **Date** | 2026-09-12 |
| **Task** | `TASKS/PHASE-1-AUTH-AND-INVITATION-CORE.md` § P1-16 |
| **Phase** | Phase 1 |
| **Surface** | backend |
| **Author** | Claude Code session |
| **Commits / PR** | `feat/P1-16-sanitization` |
| **Status** | Completed |
| **Spec** | Written into this record. The card's six steps are the specification |

---

## What Changed

One sanitization step between validation and the service, a registry of every free-text
field in the product, and `scripts/check-sanitized-fields.mjs` — which fails the build when
a request schema grows a string field that is in neither the registry nor an exemption list
with a written reason.

**Built out of order, deliberately.** The card sits at `P1-16` but `P1-11`'s DoD requires
it ("script payloads in names do not survive storage"), and every sub-resource task from
`P1-11` to `P1-15` has the same dependency. Its own dependency (`P0-13`) was already met.
Building it first means those five tasks inherit it rather than each inventing something.

## Why

`docs/SECURITY/08` § Output Encoding calls stored XSS "a primary risk" here, and the shape
of that risk is specific to this product: a couple types their own name, and three hundred
guests load it. The card's own reasoning is the load-bearing part — *"implemented
per-endpoint, it will be forgotten on the fifth endpoint; implemented as a pipeline stage
with a registry, forgetting requires deleting something."*

## How

**Validate, then sanitize, in that order.** `docs/BACKEND/03` says so and the reason is
concrete: sanitizing first lets a payload change a value's *length* after the length
check, so a 3000-character name that shrinks to 90 passes a validation it should have
failed. There is a test for that ordering, not just a comment.

**Almost every field allows no tags at all**, which is the strictest possible allowlist
rather than an exception to the allowlist rule. A guest's name is text; the question "which
tags should a venue address support" has the answer "none".

**The content of a `<script>` is discarded, not exposed as text.** A sanitizer that only
removed tags would store `alert(1)` as somebody's name — harmless, and a baffling thing to
find in a database.

**What is stored is text, not HTML, and getting there needs a loop.** `sanitize-html`
emits HTML: it strips tags and then encodes what is left, so `Budi & Ani` comes back as
`Budi &amp; Ani`. Storing that is wrong — the value is a name, and a correct renderer
escapes it again, showing the user `Budi &amp; Ani` on their own invitation.

Undoing the encoding cannot be a single decode, because the attacker picks the depth:
`&amp;lt;script&amp;gt;` decodes to `&lt;script&gt;`, which decodes to `<script>`. So the
sanitizer strips, decodes, and repeats to a fixed point, re-stripping whatever each layer
reveals. Sanitized content is re-sanitized on every later edit, which makes **idempotence a
security property here** rather than a nicety — asserted for every payload.

**`sanitize-html`, not DOMPurify.** `docs/SECURITY/08` names DOMPurify as an example
("e.g."). DOMPurify parses with a real DOM, which on the server means jsdom — a large
dependency whose own HTML parser then joins the security boundary. `sanitize-html` is built
for this job server-side, and the allowlist property the document actually requires is what
both provide.

## Files and Components Touched

| Path | Change |
|---|---|
| `backend/api/src/shared/sanitizer/sanitize.ts` | **New** — `sanitizePlainText`, `sanitizeRichText`, `sanitizeFields` |
| `backend/api/src/shared/sanitizer/registry.ts` | **New** — `TEXT_FIELDS` and `NOT_USER_TEXT`, each exemption with a reason |
| `scripts/check-sanitized-fields.mjs` | **New** — the build guard |
| `scripts/verify.sh`, `.githooks/pre-push` | The guard registered |
| `backend/api/src/modules/user/user.controller.ts` | Sanitizes after parsing |
| `backend/api/src/modules/invitation/invitation.controller.ts` | Same |
| `backend/api/test/sanitize.spec.ts` | **New** — 71 tests |
| `backend/api/test/user-http.spec.ts` | 2 tests for the boundary and the ordering |
| `backend/api/package.json` | `sanitize-html` |

No migration.

## Decisions Made

| Decision | Rationale |
|---|---|
| Built before `P1-11`–`P1-15` | Every one of them has it as a DoD item; its own dependency was met |
| `sanitize-html` over DOMPurify + jsdom | The document says "e.g."; jsdom's parser would become part of the security boundary |
| Plain text is the default; rich text exists but is unused | So that when a field genuinely needs formatting, the answer is written down rather than invented under pressure |
| Rich text permits **no attributes at all** | An allowlist of tags with a free-for-all on attributes is not an allowlist; almost every DOM-XSS payload is an attribute |
| Sanitize in the controller's `parse`, not the service | A handler cannot skip a step it does not call |
| `account_number` is exempt, with an argument | Tag stripping would silently alter a value whose exact characters matter; it needs a format check, which `P1-13` owes |
| Exemptions must carry a reason, enforced by a test | The exemption list is the cheapest way past a failing build, so it is the half that will be abused |

## Deviations from `docs/`

None. `docs/SECURITY/08` names DOMPurify with "e.g."; the requirement it states is
allowlist-based sanitization, which is what ships.

## Tests Added

73 (71 sanitizer, 2 HTTP). API unit 286 → 365.

| Group | Cases |
|---|---|
| **The payload set** | 23 payloads — attribute handlers, `javascript:` and `data:` URIs, SVG, MathML/mglyph, mutation-XSS, malformed and uppercase tags, tab- and newline-separated handlers, `<base>`, `<meta http-equiv>`, `<form action>` — each asserted against 12 forbidden patterns |
| Plain text | every payload neutralised; **stores text, not HTML — an ampersand is not encoded**; **an entity-encoded tag is discarded at any depth** (five nested and numeric forms); a lone `<` survives as text; **ordinary names survive**, including apostrophes, hyphens, Arabic and emoji; tags stripped but text kept; **script content discarded, not exposed**; **idempotent for every payload**; trimmed |
| Rich text | every payload neutralised; the six tags survive; **every attribute stripped, even from a permitted tag**; no permitted tag can navigate or load |
| The registry | **covers all 17 fields the card names**; **every registered field neutralises every payload** (the parameterised test the DoD asks for); no field in both lists; **every exemption carries a reason**; no credential registered as text |
| `sanitizeFields` | only registered keys; **does not add absent keys**; leaves non-strings; does not mutate |
| **No blacklist** | an unknown tag and an unknown attribute are both removed without being listed |
| HTTP | `full_name` sanitized before reaching the service; **length validated before sanitizing** |

## Security Verification

| Control | Requirement | How it was verified |
|---|---|---|
| Every registered field is sanitized before storage | Card DoD 1 | `"every registered field neutralises every payload"` — a parameterised test over `TEXT_FIELDS` × 23 payloads, iterating the registry rather than a hand-typed list |
| The CI check fails on a new unregistered text field | Card DoD 2 | **Proven by running it**: adding `wedding_hashtag: z.string()` to a controller makes it exit 1 naming the file and the field; removing it restores the pass |
| No configuration uses a blacklist | Card DoD 3 | `"an unknown tag is removed without being listed"` and the attribute equivalent — the property that distinguishes an allowlist is that a tag nobody anticipated is gone because it is not permitted |
| Sanitization cannot be undone by a second pass | — | `"an entity-encoded tag is decoded and then discarded, at any depth"` (five nested and numeric forms) and `"is idempotent for every payload"` |
| Length is validated before sanitizing | `docs/BACKEND/03` | `"validates length BEFORE sanitizing, not after"` |
| A credential is never altered | — | `"no credential is registered as text"` |

## Abuse Cases Covered

The payload set the card's step 6 names — script tags, event-handler attributes,
`javascript:` URLs, SVG payloads, encoded variants — plus MathML parser confusion,
mutation XSS, and the double-pass entity-decoding bug.

## DoD Verification

- [x] Every field in the registry is sanitized before storage, proven by a parameterized test over all of them. It iterates `TEXT_FIELDS` itself, so a field added to the registry is covered without anybody remembering to add a case.
- [x] The CI check fails when a new unregistered text field is added. Demonstrated by adding one and watching it fail, then removing it.
- [x] No sanitizer configuration uses a blacklist. `allowedTags: []` for plain, six tags and **zero attributes** for rich; two tests assert that an unanticipated tag and attribute are removed without being named anywhere.

## What Did Not Work

**1. The sanitizer was storing HTML, not text.** `sanitize-html` strips tags and then
**encodes** what remains, so `Budi & Ani` came back as `Budi &amp; Ani`. Stored that way, a
correct renderer escapes it again and the user sees `Budi &amp; Ani` on their own
invitation. Caught by an existing `P1-09` test asserting exactly what reached the service —
an assertion written for an entirely different reason.

Undoing the encoding is not a one-liner, because decoding once is unsafe:
`&amp;lt;script&amp;gt;` decodes to `&lt;script&gt;`, which decodes to `<script>`, and the
attacker chooses the depth. `sanitizePlainText` now strips, decodes, and repeats to a fixed
point, re-stripping whatever each layer reveals. Five new cases cover nested and numeric
encodings.

The consequence is worth stating plainly: somebody who types the literal characters
`&lt;script&gt;` into their name gets nothing back, because those characters decode to a
tag. That is heavier-handed than preserving their keystrokes, and it is the right trade for
a field hundreds of guests load.

**2. The exemption reasons were labels, not reasons, and a test caught it.** `"as above"`,
`"a UUID"`, `"an enum"`, `"HH:MM"` — eleven entries whose "reason" conveyed nothing a
reviewer could disagree with. `"every exemption carries a reason"` requires more than ten
characters, which is a crude proxy and was enough: the rewritten entries say *why* the
field is not prose (`"a closed z.enum; an unlisted value is rejected before storage"`)
rather than restating its type.

That matters more than it looks. The exemption list is the cheapest way past a failing
build, so it is the half that will be abused, and a reviewer can only push back on a claim
that has been made.

## Follow-Ups and Open Questions

- **`P1-11` through `P1-15` must call the registry**, not invent their own handling. The
  build guard enforces registration; it cannot enforce that the service actually
  sanitizes, which is why the controller-level `parse` does it for every schema.
- **`P1-13` owes `account_number` a format check.** It is exempt from sanitization on the
  argument that it needs digits-and-separators validation instead. If `P1-13` lands
  without one, that exemption is wrong.
- **Nothing uses `sanitizeRichText` yet.** It exists so the answer is written down before
  somebody needs it. If it is still unused at the end of Phase 2, consider deleting it —
  an unused allowlist is an allowlist nobody is checking.
- **The guard only reads `*.controller.ts`.** A schema defined elsewhere and imported would
  be missed. Stated in the script's own header rather than left as an assumption.

## What to Watch

**`NOT_USER_TEXT` is where this decays.** Every future field that fails the build can be
made to pass by adding a line there. The test that each carries a reason is a speed bump,
not a gate — the real control is a reviewer disbelieving the sentence. If that list grows
faster than `TEXT_FIELDS`, something is wrong.

**Idempotence is a security property here, not a nicety.** Content is re-sanitized on every
edit. If a future change makes a second pass produce a different result, a stored value can
decay into something live, and no single-pass test would notice.
