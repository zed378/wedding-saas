# Phase 1 — Completion Summary

| | |
|---|---|
| **Phase** | Phase 1 — Auth and Invitation Core |
| **Started** | 2026-09-11 |
| **Completed** | 2026-09-12 |
| **Tasks completed** | 25 / 25 |
| **Release tag** | none — nothing is released until Phase 6 (`docs/PLAN/16`) |

---

## What Shipped

**A person can now hold an account and build an invitation in it.**

They register with an email address or a Google account, verify the address, log in, stay
logged in across a browser restart, and get their password back if they lose it. Their
session can be revoked, and the reuse of a spent refresh token revokes every session they
have.

Inside the account they create an invitation from a template, and fill in everything
`docs/PLAN/08` defines: the two people and their parents, any number of events with venues
and coordinates, gift accounts, a quote, a photo gallery with a cover, and the settings
that decide which sections show and what address the invitation will have. They can change
template at any time and lose nothing. They can upload photos, which are scanned, stripped
of EXIF, and resized into three variants by a worker.

**In a browser**, they get the dashboard, a creation wizard, and a three-column editor
whose form is generated from the template's own field lists — with autosave, a conflict
warning, a gallery manager operable entirely by keyboard, and a map picker.

**What is not here**: nothing is published. There is no public page, no preview, no
checkout, no payment, no RSVP and no guestbook. Those are Phases 2, 3 and 4. An invitation
in Phase 1 is a private draft that only its owner can see.

## Acceptance Criteria Verification

From `docs/PLAN/17-ACCEPTANCE-CRITERIA.md`. Criteria that belong to later phases are listed
with the phase that owns them rather than silently dropped.

| Criterion | Evidence | Verified |
|---|---|---|
| Users can register, verify their email, and log in (email & Google) — FR-1 | `registration.itest.ts`, `auth-session.itest.ts`, `google-oauth.itest.ts`, `password-reset.itest.ts`; `auth-screens.spec.tsx` and `auth-screens.e2e.ts` | **Yes** |
| Fill in all entity data; autosave works with no data loss across 100 consecutive changes | `"keeps all hundred of a hundred consecutive edits"` (`phase-1-acceptance.itest.ts`, asserts the 100th value in the table **and** through the read path) and `"editing 100 fields in sequence loses nothing (DoD 1)"` (`editor-autosave.spec.ts`) | **Yes** |
| Switch templates without losing data, with a scenario where fields disappear and reappear | `"hides fields on a template switch and gives every one of them back"` — A→B→A, six child tables counted, events compared as values. Plus `change-template.itest.ts`'s 27 tests, including a source-level check that the path contains no `delete` | **Yes** |
| Checkout → Payment → Webhook → `paid` | — | Phase 3 (`P3-02`–`P3-08`) |
| Publishing produces a public page in under 5 seconds | — | Phase 3 (`P3-09`) |
| Public RSVP & Guestbook | — | Phase 4 |
| Admin template CRUD, orders, moderation, all audited | — | Phase 5 |
| Public page LCP < 2.5s on 4G | — | Phase 2 (`P2-03`) |
| Editor preview reflects a change in under 300ms | — | Phase 2 (`P2-05`) — the editor exists, the preview does not |
| **API p95 under 500ms on standard CRUD** | `"answers the CRUD endpoints well inside the 500ms p95 target"` — see Performance below | **Provisionally** |
| **IDOR across all `:id` endpoints, 0 critical findings** | The generated matrix: 24 endpoints, 4 cases each, every row `**pass**` | **Yes** |
| **File upload: every vector in `docs/SECURITY/06` tested, 0 critical** | `media-upload.itest.ts`, `media-process.itest.ts`, `file-format.spec.ts`, and the endpoint-level abuse set in `phase-1-acceptance.itest.ts` | **Yes for the vectors that exist** |
| Payment status cannot be manipulated from the client | — | Phase 3 (`P3-16`) |
| **Free-text input does not result in stored XSS** | `"stores every free-text field with its markup stripped"` — twelve columns read straight out of the tables. The *rendering* half needs the public page (`P2-03`) | **Storage yes, rendering Phase 2** |
| Staging uptime > 99% over a 2-week UAT | — | Phase 6 |
| DR: a backup restore tested before launch | — | Phase 6 (`P6-11`) |
| WCAG 2.1 AA on the public page and editor | The editor's components are audited by axe per component and in a real browser at `/workbench`; the public page does not exist | **Editor yes, public page Phase 2** |

## Security Verification

| Category | Method | Result |
|---|---|---|
| Multi-tenancy / IDOR (`docs/SECURITY/05`) | End-to-end sweep of every `:id` endpoint over HTTP against the real `AppModule`, four cases each: non-owner, foreign child under an owned parent, **the caller's own other wedding**, and the owner. Every response body searched for five values unique to the other tenant | **0 findings.** Matrix attached below. Mutation-verified: the owner predicate removed from `ownsInvitation` is caught by 8 named tests; the parent constraint removed from both `findOwnedChild` and `updateEvent` is caught by 2 |
| Payment (`docs/SECURITY/07`) | — | **Not applicable.** No payment code exists. `P3-16` is the gate |
| File upload (`docs/SECURITY/06`) | Magic bytes, extension allowlist, `Content-Type` agreement, size limit, decompression bomb, pixel ceiling, EXIF strip, ClamAV. Tested at the unit, service, worker and endpoint layers | **0 findings.** Mutation-verified: `detectFormat`'s null branch defaulted is caught by name. **Gap**: `MEDIA_SCAN_DISABLED` is refused in staging and production but the scanner is a sidecar nobody has yet watched fail in anger |
| Input handling / XSS (`docs/SECURITY/08`) | A payload through every free-text route, then the **columns** read directly | **0 findings in storage.** Rendering is Phase 2, and is where the criterion is finally met |
| Abuse prevention (`docs/SECURITY/10`) | `rate-limit.itest.ts`: sliding window in Redis, per-policy, fail-closed on credential endpoints and open elsewhere (ADR-050), tunable from a Redis hash with no deploy | **Passing.** `OQ-22` is open: the (email, IP) login key gives a botnet a fresh budget per IP, and the obvious fix lets a stranger lock a victim out |

**The IDOR matrix** is `MEMORY/records/2026-09-12-P1-25-idor-matrix.md`, generated by
`backend/api/test/integration/idor-sweep.itest.ts`. `docs/SECURITY/11` § Pass Criteria makes
multi-tenancy findings unwaivable; there are none to waive.

One deliberate exception is recorded as **ADR-058**: `POST /gallery/reorder` answers a
foreign photo id with 422 rather than 404, because its body is a *set* rather than an id.
The sweep asserts the stronger property — the answer is byte-identical to one naming an id
that never existed.

## Performance Results

| Surface | Target | Measured | Conditions | Met |
|---|---|---|---|---|
| API CRUD p95 | < 500ms | **26.8ms** (median 16.4ms) over 100 requests across five endpoints | Local Postgres 18 in Docker, warm pool, five concurrent, after a warm-up, on a developer laptop. No network, no TLS, no other load | **Provisionally** |
| argon2id hashing | a deliberate cost, not a target | measured on the deploy host at 64 MiB, t=3, p=1 | `P1-01`, ADR-045 | **Yes** |
| Editor preview latency | < 300ms | — | — | Phase 2 |
| Public page LCP | < 2.5s | — | — | Phase 2 |

**The p95 number is a floor, not a verdict.** A local database with a warm connection pool
is friendlier than production in every respect. What the measurement is actually good for is
catching an N+1 or a missing index, which are orders of magnitude rather than percentages.
`P6-04`'s k6 run against staging is the real measurement.

## Deviations from `docs/`

| Deviation | ADR | Document amended |
|---|---|---|
| The breached-password check fails open, loudly | ADR-044 | No — `docs/SECURITY/03` does not say which way to fail |
| argon2id parameters measured rather than transcribed | ADR-045 | No — the document gives a range |
| `jose` for JWT, statically imported from a CommonJS build | ADR-046 | No |
| `JWT_SIGNING_KEY` / `REFRESH_TOKEN_PEPPER` required at 32 chars in **every** environment, tests included | ADR-047 | No |
| The refresh token is peppered; single-use tokens are not | ADR-048 | No |
| A Google identity is unique across active accounts | ADR-049 | Migration `0005`; closes `OQ-15` |
| The limiter fails closed on credential endpoints, open elsewhere | ADR-050 | No — `docs/SECURITY/10` is silent |
| Deleting an account does not take its published invitations down | ADR-051 | `docs/PLAN/02`; closes `OQ-11`; **Legal should confirm** |
| **The free tier publishes once, for three days** (new BR-2.8) | ADR-052 | `docs/PLAN/02`, `docs/PLAN/09` — owed by `P3-09` and `P3-10` |
| `audit_logs` records owner actions, not only admin ones | ADR-053 | No |
| A template change keeps section data and drops theme overrides | ADR-054 | `docs/PLAN/07` |
| Three variants; `original` is another name for `large` | ADR-055 | Closes `OQ-19` |
| **A job's queue is named after the job, not the pool** | ADR-056 | `docs/ARCHITECTURE/04` |
| `slug-available` is advisory; creation stays authoritative | ADR-057 | `docs/API/04`; closes `PG-18` |
| `/gallery/reorder` answers 422, indistinguishably | ADR-058 | No — the rule in `docs/SECURITY/04` stands for every id-addressed endpoint |
| Repository layout is `backend/`, `frontend/`, `admin/`, `packages/` rather than `apps/` | ADR-027 (Phase 0) | **Deliberately not amended**, at the project owner's instruction |

## Deferred Out of This Phase

**`P1-02` DoD item 3 — "an unverified account cannot create an invitation".** Half-met: the
flag and `requireVerifiedEmail` exist. Enforcing it at the two endpoints that matter is
owed by `P3-01` and `P3-06`, and is recorded on both cards. A Phase 1 invitation is a
private draft, so the gap has no public consequence yet — it acquires one the moment
publishing exists.

**Drag-to-reorder in the gallery** (`P1-24`). The keyboard path the DoD required is
delivered and is the only mechanism; the pointer convenience needs a browser suite that can
drive a drag.

**An undo on photo delete** (`P1-24`). `P1-19` soft-deletes the media, so it is recoverable
in principle; re-attaching needs an endpoint accepting a soft-deleted media id, which
`P1-19` deliberately refuses.

**`GET /invitations/:id/media`** — listed in `docs/API/05`, never built. The gallery reads
`/gallery`, which is the list that matters.

**A desktop-viewport check of the editor's three-column layout** (DF-11). `P1-22` recorded
it as belonging to `P1-25`; `P1-25` could not do it, because the wizard renders
`templates={[]}` until `P2-01` and so no user can reach an editor route with a session at
all. jsdom evaluates no media queries, so the desktop arrangement has never been executed by
anything. Moved onto `P2-05`'s DoD.

**The CI pipeline** (`P0-17`, ADR-028, backlog DF-10). This is the big one and it is not
Phase 1's to fix: integration tests, the 80% coverage gate, SAST and CVE scanning run on
**no pipeline at all**. `P1-25` built the suites and the coverage command; nothing runs them
except a person typing. Revisit before Phase 3 touches payment code.

## What Was Harder Than Expected

**Proving a security control, rather than writing one.** The controls themselves were
mostly transcription from `docs/SECURITY`. What cost time, repeatedly, was discovering that
a test named after a property did not test that property:

- `P1-17`'s concurrency test **passed with the quota lock removed**, at two callers and at
  eight. Replaced with a deterministic `FOR NO KEY UPDATE` probe.
- `P1-12`, `P1-18` and `P1-19` each found repository conditional writes that survived a
  mutation because the service above them refused first.
- `P1-25`'s first mutation showed the cross-tenant sweep could not see a missing parent
  constraint at all, because the bug corrupts *one user's own two weddings*.

The recurring shape: **defence in depth makes each layer untestable from outside**. Six
occurrences now. Budget for a test at the layer under the one you are writing.

**`P1-18` found that no job the API had ever enqueued could be consumed.** The producer
named the queue after the pool; the runner consumes one named after the job. Six tasks'
worth of `notification.send` calls had been going nowhere, silently — an unconsumed queue
looks exactly like an unregistered handler. ADR-056.

**Two source files were committed as binary**, from literal control characters in a regex
and a test fixture. `scripts/check-text-sources.mjs` now refuses them, and caught a third on
its first run.

**jsdom is not a browser, in ways that matter to accessibility work.** axe cannot run
`color-contrast` there; MapLibre needs WebGL. Both shaped the designs — the browser suite
asserts the contrast rule actually ran, and the map picker degrades to two coordinate
inputs, which is a better component than the one that would have existed otherwise.

## What Was Easier Than Expected

**The template system held.** `P1-15`'s change-template and `P1-23`'s properties panel are
the two tasks most likely to have broken CLAUDE.md's "templates are data" rule, and neither
needed a per-template branch. The panel is a loop over the template's own lists, proved by
rendering twice with one string different in a fixture.

**Build guards paid for themselves immediately.** Every one of the fourteen has caught
something. `check-no-hardcoded-fields` caught its own author's file on its first run, and
caught a second collision (a media purpose that shares a word with a section key) on the
next task.

**The IDOR helper made the mandatory test one line**, which is exactly why all 24 endpoints
have one. `P0-19` predicted this in the card; it is worth repeating because the prediction
was right.

**Node 24's native type stripping** let build guards read `@wi/schema`'s TypeScript source
before the build step, so a guard and the thing it guards cannot drift.

## Risks Identified

| Risk | Change | Note |
|---|---|---|
| **R14 — single host** | unchanged | Still accepted. Staging runs on one VM behind a Cloudflare Tunnel |
| **R16 — gift account substitution** | confirmed as designed for | `P1-13` treats integrity, not secrecy, as the control: every change is audited inside its own transaction |
| **DF-10 — no CI** | **likelihood of harm rising** | Phase 1 added 762 integration tests and a coverage command that run nowhere automatically. Every phase from here makes the gap more expensive |
| **New — the scanner is a sidecar** | new | `MEDIA_SCAN_DISABLED` is refused in staging and production, and the media pool refuses to start without `CLAMAV_HOST`. Nobody has yet watched ClamAV fail in production conditions |
| **New — credentials in a transcript** | **open, owner action** | The Cloudflare API token and the VM SSH password appeared in a working transcript and **still need rotating**. `scripts/check-secrets.mjs` stops them entering the repo; it cannot un-say them |

## Readiness for the Next Phase

**Phase 2's entry gate is satisfied.** `docs/PLAN/16` requires Phase 1 complete plus
`P1-25`; both hold. The 25 cards are `DONE`, the suites pass, and the IDOR matrix is clean.

**What Phase 2 should know:**

- **`P2-01` (the template catalogue) blocks the most.** The editor and the wizard both
  currently work against test-fixture templates. Nothing real is in `templates` yet.
- **`OQ-23` must be answered before `P2-06`.** It is the only open question that gates a
  Phase 2 card.
- **`OQ-13`** — the preview watermark and whether published pages carry a credit link —
  shapes `P2-03` and `P2-12` and is a product decision, not a technical one.
- **The public renderer inherits two acceptance criteria Phase 1 could only half-meet**:
  stored XSS (storage proved, rendering not) and WCAG AA (the editor's components audited,
  the public page non-existent). Both are named in `docs/TESTING/04` and should be closed in
  Phase 2 rather than deferred to Phase 6.
- **`@wi/ui/tokens.css` is deliberately not imported by `public-invite`.** An invitation's
  palette is per-template data (`docs/PLAN/07`); the tokens are application chrome. Do not
  "fix" the missing import.
- **Two frontend conveniences are owed**: drag-to-reorder and the delete undo, both from
  `P1-24`, both needing something that does not exist yet.
- **`P2-05` inherits DF-11** — the editor's desktop layout is asserted by nothing, and
  becomes testable the moment `P2-01` lets a user reach the editor.
