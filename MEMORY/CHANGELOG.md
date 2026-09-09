# Changelog

Chronological summary of changes at a coarser grain than the individual records in [`records/`](./records/). If you want to know what happened and roughly when, read this. If you want to know why it was done that way, follow the link to the record.

This is the **internal** changelog. It is not the product's user-facing release notes, and it may describe work that has not shipped.

Format follows Keep a Changelog conventions, grouped by release once releases exist. Before the first release, entries are grouped by date.

---

## Unreleased

### 2026-09-09 — gift account numbers reclassified

**Changed** — data classification and the encryption decision ([record](./records/2026-09-09-gift-account-data-reframing.md), [ADR-025](./DECISIONS.md))
- `invitation_bank_accounts.account_number` is **sensitive personal data the couple enters in order to publish**, so a guest who cannot attend can send a gift directly to their bank. It is **not a platform payment credential** — nothing in the system moves money with it. `docs/SECURITY/00` had grouped it with password hashes and tokens; that row is now split into "Critical — secrets" and "Critical — sensitive personal data".
- **`OQ-10` answered: no column-level encryption.** It would protect only the subset that is not already public — drafts and gift-disabled invitations — inside a database holding names, addresses, coordinates and full guest lists in plaintext beside it. Storage-level encryption of the whole store is the proportionate control, and column encryption would foreclose a genuine fraud query.

**Added** — the risk the reframing exposed
- **R16**: gift account tampering. An attacker who changes the number on a live invitation collects every guest's gift, and the couple finds out after the wedding. Confidentiality was never the property under threat here; integrity is, and no risk in the register had covered it.
- Bank account writes now carry an audit trail, and a **non-optional email** notifies the owner whenever gift details change on a published invitation — the way a bank confirms a payee change (`docs/PLAN/13`).
- `payments.raw_callback_payload` scoped separately and also left unencrypted: it is retained precisely so a signature can be re-verified in an investigation, which redaction would defeat.

### 2026-09-09 — pricing and publishing address decided

**Decided** — commercial model ([record](./records/2026-09-09-pricing-and-publishing-address.md), [ADR-023](./DECISIONS.md))
- **One package: Rp 139,000 for 12 months**, 200 photos at 10 MB, no watermark. The Basic/Premium split is gone — a single price means a single tier.
- **Free tier is one draft**: an account may hold at most one invitation that has never reached `paid`. A paid invitation stops counting, so a wedding organizer with five paid invitations can still start a sixth draft (new BR-1.4).
- Renewal is another Rp 139,000 for another 12 months. `addons` ships with **no active rows** — `custom_domain` waits for Phase 2, `extended_validity` is redundant beside a 12-month package.
- Read as a 12-month validity with manual renewal, **not** recurring billing; that interpretation is stated in the ADR rather than assumed.
- Knock-on effects: checkout stops being a comparison page (`docs/UI-UX/13`), media limits collapse to one row (`docs/PLAN/11`), and the watermark narrows to free drafts and previews only — no published invitation carries one (`docs/UI-UX/14`).

**Changed** — publishing addresses ([record](./records/2026-09-09-pricing-and-publishing-address.md), [ADR-024](./DECISIONS.md))
- Invitations are published at **`invitation.zedth.my.id/{slug}`** — path-based on a fixed hostname. **No wildcard DNS record and no wildcard certificate**, because programmatic DNS management is not in place yet.
- Three fixed hostnames, added as each surface is built: `invitation.zedth.my.id` (public invitations, previews, proxied public API), `app.zedth.my.id` (application and API, from `P0-23`), `admin.zedth.my.id` (admin, from `P5-01`).
- The public surface stays on **its own origin** rather than sharing one with the application. Guest-submitted content renders there, and a shared origin would let a stored XSS act against the authenticated app — a containment the wildcard design provided for free.
- Slug resolution is now **strategy-driven** (`docs/BACKEND/06`): path today, subdomain later, one implementation. Migration is configuration plus DNS, with published path URLs redirecting permanently and indefinitely.
- Per-invitation subdomains merge into `P7-01` alongside custom domains — the same programmatic-DNS capability serves both.
- New risk **R15**: an unreserved application route could shadow a published invitation. Closed by construction — that host serves only invitations, and CI fails on a route not present in `slug_blocklist`.
- 20 documents amended; `maindomain.com` placeholders replaced with the real hostnames throughout.

**Status** — `TASKS/PROGRESS.md` now shows **no blocked tasks**. Five open questions remain and none stops work.

### 2026-09-09 — stack decided, specification gaps closed

**Decided** — the technology stack ([P0-01](./records/2026-09-09-P0-01-stack-decision.md), ADR-004 through ADR-017)
- TypeScript on Node 22 with NestJS; pnpm + Turborepo monorepo; Next.js for the app and the public invitation, Vite for admin; Drizzle ORM; Zod as the single validation vocabulary; BullMQ on Redis; sharp with ClamAV in an isolated worker.
- Cloudflare R2 for object storage with Cloudflare CDN, DNS and Turnstile at the edge; Midtrans for payments; Resend for transactional email; MapLibre in the editor with no map SDK at all on the public page; a single VPS running Docker Compose behind Caddy.
- Vitest, Testcontainers and Playwright for tests; GitHub Actions, Semgrep and OWASP ZAP for CI; Pino, OpenTelemetry, Prometheus and Sentry for observability.
- Six open questions closed (`OQ-01`, `OQ-02`, `OQ-03`, `OQ-04`, `OQ-06`, `OQ-09`). Blocked tasks dropped from seven to two — only pricing (`OQ-05`) and the domain name (`OQ-08`) remain, and both are answers only the project owner can give.

**Changed** — all 17 specification gaps resolved, `docs/` amended ([record](./records/2026-09-09-specification-gap-remediation.md), ADR-018 through ADR-022)
- **The two contradictions.** A resource that exists but is not yours now returns **404** everywhere, never 403 — `docs/API/00` had documented both, and a differentiating status code is an enumeration oracle (ADR-018). A **refund returns the invitation to `draft`**, not `paid` — `docs/PLAN/02` and `docs/BACKEND/05` disagreed, and the difference was whether a refunded customer keeps the ability to republish for free (ADR-019).
- **Five tables added** (ADR-020): `user_tokens`, `user_mfa_factors`, `user_recovery_codes`, `invitation_preview_tokens`, `invitation_view_counts`, `slug_blocklist` — every credential-shaped value stored hashed or encrypted. Two new files: `docs/DATABASE/11-ANALYTICS.md` and `docs/DATABASE/12-PLATFORM-CONFIG.md`.
- **Six endpoints added** (ADR-021): single-media read, owner-side RSVP management with CSV export, owner-side guestbook moderation, template version upgrade, the public watermark flag, and a guest report endpoint that gives the admin moderation queue an actual source.
- **Five documentation corrections** (ADR-022): where settings fields physically live, addon availability at MVP, who performs the `pending_payment` transition, where demo data lives, and three tables `docs/ARCHITECTURE/04` listed that do not exist.
- `docs/PLAN/18-RISK-REGISTER.md` gained **R13** (one vendor carries storage, CDN, DNS and CAPTCHA) and **R14** (single-host deployment, no redundancy at MVP), both consequences of the hosting decision rather than oversights.
- `docs/` grew from 121 to 123 files; 24 documents were amended.

### 2026-09-09 — earlier

**Added** — the execution layer ([P0-24](./records/2026-09-09-P0-24-tasks-and-memory-scaffolding.md), [ADR-003](./DECISIONS.md))
- `TASKS/` — task conventions with an 11-item global Definition of Done, eight phase files covering **133 tasks**, a progress board, and a backlog. Every task names the specification documents it implements, its dependencies, and — where relevant — the abuse cases it must have automated tests for.
- Phase boundaries follow `docs/PLAN/16-IMPLEMENTATION-ROADMAP.md` exactly, so the plan and the roadmap cannot drift. The roadmap's two prose-stated critical dependencies are now encoded as task dependencies: the template system before editor work (`P0-20`, `P0-21` → `P1-22`, `P1-23`), and the payment security review before production (`P3-16`).
- The tenant-scoped repository layer became a Phase 0 task (`P0-11`) rather than an implicit expectation of Phase 1, so that `docs/SECURITY/05`'s zero-tolerance rule is a property of the data layer instead of a review checklist.

**Changed** — the record layer ([P0-24](./records/2026-09-09-P0-24-tasks-and-memory-scaffolding.md))
- `MEMORY/` restructured to the record format: `MEMORY-INDEX.md`, `CHANGELOG.md`, `DECISIONS.md`, `records/`, `specs/`, `templates/`.
- `MEMORY/LOG/` → `MEMORY/records/`, existing entry migrated unchanged.
- `MEMORY/STATE.md` **removed**; `TASKS/PROGRESS.md` is now the single status board. Two snapshots drift, and then neither is trusted.
- `MEMORY/DECISIONS.md` rewritten in ADR format. The two existing decisions are preserved as ADR-001 (single canonical documentation language) and ADR-002 (stack not yet chosen); ADR-003 records the establishment of `TASKS/` and `MEMORY/`; a pending-decisions table lists the 16 decisions `TASKS/` expects to need.
- `CLAUDE.md` and `AGENTS.md` amended: their MEMORY sections describe the new structure, and their documentation maps and workflows now include `TASKS/`. They previously instructed agents to write to `MEMORY/STATE.md` and `MEMORY/LOG/`, which no longer exist.

**Found** — while writing the plan against the specification ([`TASKS/BACKLOG.md`](../TASKS/BACKLOG.md))
- **Two contradictions between documents**, both of which would have become bugs:
  - `PG-01` — `docs/API/00-API-STANDARDS.md` documents *both* 403 and 404 for "the resource exists but is not yours", while `docs/SECURITY/04`, `docs/SECURITY/05`, `docs/TESTING/04` and `CLAUDE.md` all require 404. `docs/API/05` then specifies 403 for that case.
  - `PG-14` — a refund sends the invitation to `draft` per `docs/PLAN/02` BR-5.4 and to `paid` per `docs/BACKEND/05` § Refund. The difference decides whether a refunded customer keeps the ability to republish for free.
- **Fifteen further specification gaps**, most of them a table or endpoint the specification requires functionally but never models: verification and reset tokens (`PG-06`), share-preview tokens (`PG-04`), page view counts (`PG-12`), admin 2FA factors (`PG-13`), the slug blocklist (`PG-15`), owner-side RSVP endpoints (`PG-10`), owner-side guestbook moderation (`PG-11`), a single-media read endpoint the frontend polls (`PG-03`), and the watermark flag the public renderer needs but never receives (`PG-09`).
- **Thirteen open questions** needing a decision from the project owner — stack, payment provider, hosting, email provider, pricing, maps provider, domain, CAPTCHA vendor, encryption at rest, account deletion semantics, team size, watermark design, and the language of these two folders. Seven block a specific task; `OQ-01` blocks all of Phase 0.
- **Fourteen `docs/` amendments** are now owed by the tasks that resolve these gaps, tracked in `TASKS/PROGRESS.md` § Specification Amendments Owed.

### 2026-09-09 — earlier

**Added** — the specification ([record](./records/2026-09-09-documentation-set-and-agent-instructions.md))
- `docs/` — 121 documents across PLAN, ARCHITECTURE, API, DATABASE, SECURITY, UI-UX, FRONTEND, BACKEND, DEVOPS and TESTING, expanded from a rough outline into full content: SQL schemas with real types and constraints, endpoint contracts with request and response examples, the template section and theme schema, the invitation lifecycle state machine, a STRIDE threat model, and a per-layer test strategy.
- `CLAUDE.md` and `AGENTS.md` — agent operating instructions, including the non-negotiable rules that govern implementation: templates are data not code, invitation data is independent of the template, object-level authorization on every `:id` endpoint, payment status server-decided only, prices recalculated server-side, all free text sanitized, uploads through the full validation pipeline, state transitions logged.
- `MEMORY/` — initialized with a state snapshot, a decision log and the first log entry.

**Changed**
- The Indonesian `docs/` was deleted and `docs-en/` renamed to `docs/`, leaving one canonical English documentation set ([ADR-001](./DECISIONS.md)). User-facing product copy remains Bahasa Indonesia.
