# Memory Index

Every change record, newest first. One line each: date, task ID, title, and the hook that tells you whether this is the record you need.

Add a line here as part of writing the record — an unindexed record is a record nobody finds.

---

## Records

| Date | Task | Record | Hook |
|---|---|---|---|
| 2026-09-09 | — | [Specification gap remediation](./records/2026-09-09-specification-gap-remediation.md) | All 17 gaps closed and `docs/` amended: five tables, six endpoints, two new DATABASE files, 24 documents touched. The two contradictions were the point — a status code that would have leaked resource existence on some endpoints and not others, and a refund that returned the money and left the customer the product |
| 2026-09-09 | P0-01 | [The stack is decided](./records/2026-09-09-P0-01-stack-decision.md) | TypeScript monorepo, NestJS, Next.js, Drizzle, Cloudflare R2, Midtrans, single VPS. The deciding argument was not preference: the field-path resolver has to behave identically in the backend validator and the editor checklist, and one language makes that a package rather than a discipline. Two vendor concentrations accepted and recorded as R13 and R14 |
| 2026-09-09 | P0-24 | [TASKS and MEMORY scaffolding](./records/2026-09-09-P0-24-tasks-and-memory-scaffolding.md) | The execution layer: 133 tasks across eight phases, each naming its specification refs, DoD and abuse cases. Writing it against `docs/` surfaced 17 specification gaps and 13 open questions — including two contradictions that would have become bugs, one of them with a money consequence |
| 2026-09-09 | — | [Documentation set, translation, agent instructions](./records/2026-09-09-documentation-set-and-agent-instructions.md) | How the 121-document specification came to exist: expanded from a bullet outline, written twice (Indonesian then English), then consolidated to one English set. Also the origin of `CLAUDE.md`, `AGENTS.md` and `MEMORY/` |

---

## By Phase

### Pre-Phase-0 — Specification
- [Documentation set, translation, agent instructions](./records/2026-09-09-documentation-set-and-agent-instructions.md) — the whole of `docs/`, and the decision to keep one canonical language (ADR-001)

### Pre-Phase-0 — Specification amendments
- [Specification gap remediation](./records/2026-09-09-specification-gap-remediation.md) — closes PG-01 through PG-17; a documented deviation is a decision, an undocumented one is a bug nobody has found yet

### Phase 0 — Foundation
- `P0-01` — [The stack is decided](./records/2026-09-09-P0-01-stack-decision.md) — the constraint that chose the language was one sentence in `docs/FRONTEND/03`
- `P0-24` — [TASKS and MEMORY scaffolding](./records/2026-09-09-P0-24-tasks-and-memory-scaffolding.md) — a plan that goes stale is worse than none, so the board is updated in the commit that changes the code

### Phase 1 — Auth and Invitation Core
_No records yet._

### Phase 2 — Template Rendering and Preview
_No records yet._

### Phase 3 — Order, Payment and Publishing
_No records yet._

### Phase 4 — Engagement
_No records yet._

### Phase 5 — Admin Panel
_No records yet._

### Phase 6 — Hardening and Launch
_No records yet._

### Phase 7 — Post-Launch
_No records yet._

---

## By Kind

Some records are worth finding by what they are rather than when they happened.

| Kind | Records |
|---|---|
| Phase summaries | _none yet_ |
| Specification amendments | [Gap remediation](./records/2026-09-09-specification-gap-remediation.md) — 17 gaps, 24 documents, 2 new DATABASE files |
| Stack and architecture decisions | [P0-01](./records/2026-09-09-P0-01-stack-decision.md) — ADR-004 through ADR-017 |
| Security verification (IDOR sweeps, pentest, payment review) | _none yet_ |
| Performance and load results | _none yet_ |
| Disaster recovery and rollback drills | _none yet_ |
| Incidents and post-mortems | _none yet_ |
