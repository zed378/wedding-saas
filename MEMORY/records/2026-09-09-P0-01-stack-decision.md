# P0-01 — The stack is decided

| | |
|---|---|
| **Date** | 2026-09-09 |
| **Task** | `TASKS/PHASE-0-FOUNDATION.md` § P0-01 |
| **Phase** | Phase 0 |
| **Surface** | docs |
| **Author** | Claude Code session |
| **Commits / PR** | (repository not yet under version control — `P0-03`) |
| **Status** | Completed |

---

## What Changed

Fourteen ADRs (ADR-004 through ADR-017) record the full technology stack, superseding ADR-002 ("stack not yet chosen"). `CLAUDE.md` and `AGENTS.md` § Dev environment now carry the stack as a table rather than a placeholder. Six open questions closed: `OQ-01` (stack), `OQ-02` (payment provider), `OQ-03` (hosting and storage), `OQ-04` (email), `OQ-06` (maps), `OQ-09` (CAPTCHA vendor). Phase 0 is unblocked.

## Why

`P0-01` blocked every other task in Phase 0, and Phase 0 blocks everything else. The project owner asked for the decision to be made rather than presented as options.

## How

The choice was made against the constraints already written into `docs/`, not against general preference. Four of them did most of the work:

**One language, because of the field-path registry.** `docs/BACKEND/03` § Validating Completeness and `docs/FRONTEND/03` both consume the same canonical dot-notation field paths — the backend to decide whether an invitation may publish, the frontend to render the editor checklist and the properties panel. `docs/FRONTEND/03` says outright that the schema should be shared from one source "if the stack allows it". That single sentence is what chose TypeScript over Go. The project owner's `zed-auth` repository demonstrates real Go proficiency, and Go would have produced a more efficient service; it would also have meant writing the resolver twice and keeping the two in step by discipline. For a 1-3 person team, on the piece of logic that sits at the architectural centre of the product, that trade goes the other way.

**Schema fidelity, because `docs/DATABASE/` is literal SQL.** The specification contains real `CREATE TABLE` statements with partial unique indexes, typed array columns, `CHECK` constraints and an `INET` column, and `CLAUDE.md` requires migrations to match them. Prisma cannot express several of those in its schema file; Drizzle can. That is the whole argument for ADR-007, and it is worth more here than Prisma's better tooling because the "migrations match the documents" rule is the one thing those migrations exist to guarantee.

**Egress cost, because the product serves photo galleries to crowds.** Hundreds of guests open the same invitation within minutes, each loading a gallery. On S3 that is the least predictable line in the budget; R2 charges no egress. ADR-011 follows from that number, and then Cloudflare's CDN, DNS and Turnstile come along with it — which concentrates risk in one vendor, now recorded as R13 in the risk register.

**A JavaScript budget, because the public page is the product.** `docs/FRONTEND/09` sets roughly 150KB gzip and LCP under 2.5s on 4G. An embedded map SDK breaks that on its own, which is why ADR-014 splits the maps decision by surface: a real picker in the editor where volume is bounded by couples, and a static image plus a deep link on the page loaded by guests.

## Files and Components Touched

| Path | Change |
|---|---|
| `MEMORY/DECISIONS.md` | ADR-004 through ADR-017 added; ADR-002 marked superseded; pending-decisions table updated |
| `CLAUDE.md`, `AGENTS.md` | § Dev environment replaced with the stack table and the real target layout |
| `TASKS/PHASE-0-FOUNDATION.md` | `P0-01` marked DONE with its DoD ticked; `P0-23` reduced to one blocker; `P0-10` and `P0-21` steps updated |
| `TASKS/PHASE-1…5` | Cards updated where a decision now names the library (maps, email, CAPTCHA, payment) |
| `TASKS/PROGRESS.md` | Board updated; blocked list down from seven to two |
| `TASKS/BACKLOG.md` | Six open questions moved to Answered with their ADR |
| `docs/PLAN/18-RISK-REGISTER.md` | R13 and R14 added |
| `docs/DEVOPS/03-REVERSE-PROXY.md` | Caddy named as the origin proxy, with the on-demand TLS reasoning |

## Decisions Made

Fourteen, all in `MEMORY/DECISIONS.md`. In summary: TypeScript on Node 22 with NestJS (ADR-004); pnpm + Turborepo monorepo (ADR-005); Next.js for the app and public invitation, Vite SPA for admin (ADR-006); Drizzle ORM (ADR-007); Zod as the single validation vocabulary (ADR-008); BullMQ (ADR-009); sharp with ClamAV in an isolated worker (ADR-010); Cloudflare R2 and edge (ADR-011); Midtrans (ADR-012); Resend (ADR-013); split maps treatment (ADR-014); single VPS with Docker Compose and Caddy (ADR-015); Vitest/Testcontainers/Playwright and GitHub Actions (ADR-016); Pino, OpenTelemetry, Prometheus, Sentry (ADR-017).

## Deviations from `docs/`

None. Every choice sits inside the options the specification allowed. Two additions were made to `docs/` as consequences rather than deviations: R13 and R14 in the risk register, and a note in `docs/DEVOPS/03` naming Caddy, since that document's Nginx config is explicitly labelled indicative.

## Tests Added

Not applicable — no code was written.

## Security Verification

Not applicable to this task, but three stack choices were made for security reasons and should be checked when the code lands: the media pipeline runs in a resource-capped isolated worker (ADR-010, the decompression-bomb defence in `docs/SECURITY/06` layer 6); Pino's declarative redaction is what makes `docs/DEVOPS/06`'s "not by developer discipline" requirement true (ADR-017); and the admin panel ships as static files so its host runs no Node process (ADR-006).

## Definition of Done Verification

- [x] ADRs exist for every decision the task listed, plus email, maps, hosting, testing and observability
- [x] Each ADR names a rejected alternative and the specific reason
- [x] The ORM ADR confirms separate-step migrations and expand-contract
- [x] The frontend ADR confirms per-request SSR with on-demand revalidation
- [x] `CLAUDE.md` and `AGENTS.md` § Dev environment updated
- [x] ADR-002 marked superseded with a forward pointer
- [ ] Install and run commands — **deliberately not done**: there is nothing to install until `P0-02` scaffolds the repository. Both files say so rather than carrying an empty promise. This is the one DoD item on the card that reads as unmet, and it is unmet on purpose.

## What Did Not Work

An earlier draft recommended Prisma, on the reasonable ground that it is the better-supported default and a small team benefits from tooling. Working through `docs/DATABASE/` changed it: writing out how the partial unique index on `invitations.slug`, the `VARCHAR(40)[]` columns and `audit_logs.ip_address INET` would each have to be handled made it clear that a meaningful part of the schema would live in hand-edited migration SQL that the schema file did not describe — which is exactly the drift the specification's literal DDL exists to prevent.

Two package-version lookups were run against the registry rather than relying on memory, which is worth repeating: several majors had moved further than expected.

## Follow-Ups and Open Questions

- **`OQ-05` (pricing) and `OQ-08` (domain) are now the only two blockers left**, and both are answers only the project owner can give.
- **`OQ-02` is answered but commercially unconfirmed.** ADR-012 chose Midtrans on technical grounds that are close to a tie; settlement terms and MDR should be checked before `P3-03` starts. The port abstraction is what makes that safe to defer.
- **R14 (single host) has a review trigger, not a date.** It says "before the platform carries weddings it cannot afford to disappoint", which is a judgement someone has to actually make rather than a milestone that arrives on its own.
- `OQ-14` was opened for the CAPTCHA activation threshold, which the vendor decision does not settle.

## What to Watch

The two vendor concentrations. Cloudflare now carries storage, CDN, DNS, WAF and CAPTCHA, so an outage there is broader than an outage anywhere else in the system (R13). The single VPS is a genuine single point of failure (R14), and the mitigation that makes it acceptable — the CDN continuing to serve cached invitation pages through an origin outage — is only real if `P3-12`'s caching actually achieves its hit ratio. If that number comes in low during `P6-08`, R14 gets worse, and the two should be reconsidered together rather than separately.
