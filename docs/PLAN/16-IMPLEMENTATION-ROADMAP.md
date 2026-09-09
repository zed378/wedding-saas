# 16 - Implementation Roadmap

The order of work follows the principle: data domain first, then architecture, then UI — see the explanation in the parent document's ordering rationale.

## Phase 0 — Foundation (Week 1-2)
- Finalize 08-INVITATION-DATA-MODEL.md → DATABASE/ schema & initial migration.
- 07-TEMPLATE-SYSTEM.md → define the template schema + build 1 reference template.
- ARCHITECTURE/00-03 (system, application, frontend, backend architecture) agreed upon.
- Set up the repo, basic CI, environments (DEVOPS/00-01).

## Phase 1 — Core Editor (Week 3-5)
- Auth (register/login/OAuth) — API/01, related BACKEND work.
- Invitation CRUD + Person/Event/Gallery/BankAccount/Quote — API/04, BACKEND/01-02.
- Basic Editor UI (without a sophisticated live preview yet) — FRONTEND/06.
- Basic media upload pipeline — API/05, BACKEND/04, SECURITY/06.

## Phase 2 — Template Rendering & Preview (Week 6-7)
- Generic template renderer (reads schema → renders sections).
- Live preview in the editor.
- Public invitation page (rendered from data + template, including SEO meta).

## Phase 3 — Payment & Publish (Week 8-9)
- Order & Payment integration — API/06-07, BACKEND/05, SECURITY/07.
- Publish/unpublish flow — API/04, BACKEND/06.
- Subdomain routing.

## Phase 4 — Engagement Features (Week 10-11)
- Public RSVP + management view.
- Public guestbook + moderation.
- Basic notifications (email).

## Phase 5 — Admin Panel (Week 12-13)
- Template management CRUD.
- User & order management.
- Moderation queue, audit log.

## Phase 6 — Hardening & Launch Prep (Week 14-15)
- Full security testing (SECURITY/11, TESTING/04).
- Performance testing & cache tuning.
- Multi-tenancy penetration testing (IDOR focus).
- Live monitoring/alerting (DEVOPS/05-07).

## Phase 7 — Post-Launch / Phase 2 Features
- Custom domain, advanced analytics, WhatsApp notifications, template marketplace.

## Critical Dependencies
- The Template System (07) MUST be finalized in design before serious work on the Editor UI (FRONTEND/06) begins, because the Editor is schema-driven.
- Payment Security (SECURITY/07) MUST be reviewed before the Payment API is deployed to production.
