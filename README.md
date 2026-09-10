# Wedding Invitation Platform

A SaaS platform for creating and publishing digital wedding invitations from versioned, data-driven templates: template catalogue → editor with live preview → checkout → publish → a public invitation page with RSVP and a guestbook, plus an admin panel.

An invitation is published at `https://invitation.zedth.my.id/{slug}`.

## Where things are

| Folder                          | What it holds                                                                                                                                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`docs/`](./docs/README.md)     | **The specification** — product, architecture, API contract, database schema, security, UX, testing. 123 documents. Reference material: amended deliberately, never as a side effect of implementation. |
| [`TASKS/`](./TASKS/README.md)   | **The execution plan** — 133 tasks across 8 phases, each naming the documents it implements and how it is judged done. Start at [`PROGRESS.md`](./TASKS/PROGRESS.md).                                   |
| [`MEMORY/`](./MEMORY/README.md) | **The record** — what was built, why, and what to watch. Decisions live in [`DECISIONS.md`](./MEMORY/DECISIONS.md).                                                                                     |
| `backend/`                      | REST API and background workers.                                                                                                                                                                        |
| `frontend/`                     | The user-facing app and the public invitation renderer.                                                                                                                                                 |
| `admin/`                        | The admin panel — its own trust boundary, its own hostname.                                                                                                                                             |
| `packages/`                     | Code shared between them.                                                                                                                                                                               |

`CLAUDE.md` and `AGENTS.md` are the operating instructions for anyone — human or agent — working in this repository. Read `TASKS/PROGRESS.md` before starting anything.

## Repository layout

```
backend/
  api/             NestJS — REST API, twelve domain modules (docs/ARCHITECTURE/01)
  worker/          Background jobs: media, general, cron pools (docs/BACKEND/08)

frontend/
  web-app/         Next.js — marketing, auth, dashboard, editor, checkout   → app.zedth.my.id
  public-invite/   Next.js — the public invitation, server-rendered          → invitation.zedth.my.id

admin/             Vite + React — admin panel, static build                  → admin.zedth.my.id

packages/
  schema/              Zod schemas, the canonical field-path registry, the dot-notation resolver
  template-renderer/   The generic renderer + section components — imported by web-app AND public-invite
  ui/                  Design system tokens and components; React Email templates
  api-client/          Typed API client
  config/              Shared tsconfig / eslint / prettier
```

The three top-level groups mirror the trust boundaries rather than the languages. `admin/` sits beside `backend/` and `frontend/` instead of inside either because `docs/SECURITY/02` puts it behind its own boundary, on its own hostname, with its own session — a separation the layout should make obvious rather than hide (ADR-027).

Two of these carry more weight than their size suggests:

- **`packages/schema`** holds one definition of every field path. The API uses it to decide whether an invitation may publish; the editor uses it to render the form and the completeness checklist. One package, so the two cannot disagree — this is the reason the whole stack is one language ([ADR-004](./MEMORY/DECISIONS.md)).
- **`packages/template-renderer`** is imported by both the editor preview and the public page. That shared import is what `docs/FRONTEND/04` means by "the same renderer", and it is what makes the editor a real preview rather than an approximation.

`frontend/public-invite` runs on its own hostname on purpose. Guest-submitted content (RSVP names, guestbook messages) renders there, and keeping it off the application's origin means a stored XSS cannot act against a logged-in user ([ADR-024](./MEMORY/DECISIONS.md), `docs/SECURITY/02`).

## Stack

TypeScript on Node 24 LTS · NestJS · Next.js + React · Vite (admin) · PostgreSQL + Drizzle · Redis + BullMQ · Zod · sharp · Cloudflare R2 · Midtrans · Resend · Docker Compose behind Caddy.

The full table with versions is in `CLAUDE.md` § Dev environment. Every choice has an ADR in [`MEMORY/DECISIONS.md`](./MEMORY/DECISIONS.md) naming what was rejected and why — read it before proposing a change.

## Getting started

```bash
pnpm install          # workspace install
pnpm typecheck        # type check every package
pnpm lint             # lint
pnpm test             # unit tests
pnpm build            # build every surface
```

Local services (PostgreSQL, Redis, MinIO, Mailpit, ClamAV) come up with Docker Compose — see `deploy/README.md`. Copy `.env.example` to `.env` first; `.env` is git-ignored and must stay that way.

Commands for individual surfaces are documented in each app's own README.

## Working conventions

- One task at a time from `TASKS/`, in dependency order.
- **One branch per task**, named for its task ID - `feat/P0-02-monorepo-structure`. `main` stays free of in-progress development code; a branch merges only when its Definition of Done, MEMORY record included, is satisfied. Documentation-only changes may go to `main` directly.
- Commit subject `P1-09: ...` - the task ID is the join key across branches, commits, PRs, MEMORY records and the board.
- A task is not done until its record exists in `MEMORY/records/` and `TASKS/PROGRESS.md` is updated in the same commit.
- Every `:id` endpoint gets an IDOR test. `docs/SECURITY/05` is the project's first priority and has zero tolerance.

Full detail: [`TASKS/00-TASK-CONVENTIONS.md`](./TASKS/00-TASK-CONVENTIONS.md).

## Status

Phase 0 — Foundation. See [`TASKS/PROGRESS.md`](./TASKS/PROGRESS.md) for the live board.
