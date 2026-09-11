# @wi/admin

The admin panel: templates, users, orders and refunds, moderation, audit log.

**Host**: `admin.vizunicum.my.id` — separate hostname, separate cookie scope, so an XSS in the user
application cannot reach an admin session (`docs/SECURITY/02` boundary 3->4).

Built with Vite as a static SPA, so the admin host runs no server-side JavaScript at all
(ADR-006). Desktop-first (`docs/UI-UX/15`).

## What admins can and cannot do

They manage templates, suspend users, refund orders and moderate the guestbook. They **cannot
edit a couple's invitation content** — no endpoint exists for it, which is the enforcement
(`docs/API/09`). Cross-tenant reads go through a separately named code path and write an audit
row every time (`docs/SECURITY/05` § Special Case).

TOTP is mandatory, and refunds and suspensions require a fresh factor even inside a live
session (`docs/SECURITY/03`).

Commands are wired in `P0-22`; the surface itself is Phase 5.
