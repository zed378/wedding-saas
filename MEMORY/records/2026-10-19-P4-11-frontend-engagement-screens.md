# P4-11 — Frontend Engagement Screens and Live Public Sections

| | |
|---|---|
| **Date** | 2026-10-19 |
| **Task** | `TASKS/PHASE-4-ENGAGEMENT.md` § P4-11 |
| **Phase** | Phase 4 — Engagement |
| **Surface** | web-app, public-invite |
| **Author** | Agent |
| **Status** | Completed |

---

## What Changed

- Implemented owner `RsvpTable` and `/dashboard/[invitationId]/rsvps` page with headcount summary cards, status filtering, expandable messages, authenticated CSV download, and responsive mobile card stack (<640px down to 360px).
- Implemented owner `GuestbookModerationList` and `/dashboard/[invitationId]/guestbook` page with status tabs (`pending`, `approved`, `rejected`), live badge counts, and 1-click approve/reject actions.
- Wired accessible action links for "RSVP" and "Buku Tamu" into `InvitationCard.tsx`.
- Added plain-language engagement feature toggles in editor settings (`PropertiesPanel.tsx`) for `rsvp_enabled`, `guestbook_enabled`, `guestbook_moderation`, and `profanity_filter_enabled`.
- Implemented same-origin proxy route handlers in `public-invite` for `/public/i/[slug]/rsvp`, `/public/i/[slug]/guestbook`, and `/public/i/[slug]/captcha-status`.
- Built live public interactive components `PublicRsvpForm` and `PublicGuestbookWall`, dynamically mounted into `Invitation.tsx` lazy component registry without violating generic template renderer constraints.
- Form failure state input preservation (DoD compliance): users never lose typed RSVP responses or wishes when network or validation errors occur.
- Added comprehensive unit and integration tests across `web-app` (9 tests in 2 suites) and `public-invite` (6 tests in 1 suite).

## Why

Implements `docs/UI-UX/10-DASHBOARD-SPEC.md`, `docs/UI-UX/03-USER-PERSONAS.md`, `docs/API/08-PUBLIC-INVITATION-API.md`, `docs/PLAN/07-TEMPLATE-SYSTEM.md`, and ADR-095. Couples need accessible, mobile-first management for RSVP confirmations and guestbook moderation, with quick 1-click approvals (Rina persona). Guests viewing public invitations need live, accessible forms that preserve input on errors and automatically pre-fill guest names from personalized invitation links.

## How

1. **Owner RSVP Screen (`web-app`)**:
   - `RsvpTable.tsx`: Displays summary cards (total responses, attending count, guest headcount, declines, unconfirmed). Renders an accessible HTML table on desktop (>=640px) and a stacked card list on mobile (<640px down to 360px). Truncates long messages with "Lihat selengkapnya" / "Sembunyikan" toggles. Authenticated CSV export triggers download using in-memory access token.
   - `/dashboard/[invitationId]/rsvps/page.tsx`: Page with breadcrumb navigation, live status filtering, and pagination.
2. **Owner Guestbook Moderation Screen (`web-app`)**:
   - `GuestbookModerationList.tsx`: Moderation banner, status filter tabs with badge counts, 1-click "Setujui" / "Tolak" actions, and delete confirmations.
   - `/dashboard/[invitationId]/guestbook/page.tsx`: Route fetching summary counts and paginated messages.
3. **Editor Engagement Settings**:
   - In `PropertiesPanel.tsx`, sections with `RsvpForm` or `GuestbookWall` components expose toggle switches for `rsvp_enabled`, `guestbook_enabled`, `guestbook_moderation`, and `profanity_filter_enabled` with clear Indonesian explanations, fully passing `check-no-hardcoded-fields.mjs`.
4. **Public Proxy Routes (`public-invite`)**:
   - Route handlers under `/public/i/[slug]/{rsvp,guestbook,captcha-status}` forward requests to backend API, propagating client IP via `x-forwarded-for`.
5. **Live Public Sections (`public-invite`)**:
   - `PublicRsvpForm.tsx`: Inert in preview modes (`live`/`demo`), interactive in `public` mode. Pre-fills name from `readGuestName()`. Preserves inputs on error with `role="alert"`. Renders thank-you message with `role="status"` on success.
   - `PublicGuestbookWall.tsx`: Fetches approved entries on mount with "Muat lebih banyak" pagination. Optimistically updates approved submissions; displays pending moderation notice when moderation is active. Preserves inputs on error.
   - `Invitation.tsx`: Registered dynamically in `LAZY_SECTIONS` without putting network logic into `@wi/template-renderer`.

## Files and Components Touched

| Path | Change |
|---|---|
| `frontend/web-app/src/lib/invitations.ts` | Added typed client methods for RSVP & Guestbook listing, summaries, moderation, and deletion |
| `frontend/web-app/src/components/RsvpTable.tsx` | Owner RSVP table and responsive mobile card stack |
| `frontend/web-app/src/components/GuestbookModerationList.tsx` | Owner guestbook moderation list with status tabs and 1-click actions |
| `frontend/web-app/src/components/InvitationCard.tsx` | Added accessible action links for RSVP and Buku Tamu |
| `frontend/web-app/src/app/(app)/dashboard/[invitationId]/rsvps/page.tsx` | RSVP management dashboard route |
| `frontend/web-app/src/app/(app)/dashboard/[invitationId]/guestbook/page.tsx` | Guestbook moderation dashboard route |
| `frontend/web-app/src/editor/PropertiesPanel.tsx` | Added engagement toggles in editor section properties |
| `frontend/web-app/test/rsvp-dashboard.spec.tsx` | Tests for RsvpTable and dashboard interactions |
| `frontend/web-app/test/guestbook-dashboard.spec.tsx` | Tests for GuestbookModerationList 1-click actions |
| `frontend/public-invite/src/app/public/i/[slug]/rsvp/route.ts` | Public RSVP proxy route |
| `frontend/public-invite/src/app/public/i/[slug]/guestbook/route.ts` | Public guestbook proxy route |
| `frontend/public-invite/src/app/public/i/[slug]/captcha-status/route.ts` | Public captcha status probe proxy route |
| `frontend/public-invite/src/components/PublicRsvpForm.tsx` | Live interactive RSVP form with error preservation |
| `frontend/public-invite/src/components/PublicGuestbookWall.tsx` | Live interactive guestbook wall with moderation awareness |
| `frontend/public-invite/src/components/Invitation.tsx` | Registered live engagement sections in lazy registry |
| `frontend/public-invite/test/public-engagement.spec.tsx` | Tests for live public interactive RSVP and guestbook sections |
| `MEMORY/DECISIONS.md` | Added ADR-095 |

## Decisions Made

| Decision | Rationale | ADR |
|---|---|---|
| Keep network logic in `frontend/public-invite` | `@wi/template-renderer` must remain 100% generic and free of network requests (`check-renderer-is-generic.mjs`) | ADR-095 |
| Preserve form input on failure | Strict DoD requirement: users must never lose typed messages on validation or rate limit errors | ADR-095 |
| Responsive mobile card stack (<640px) | HTML tables overflow horizontally on mobile; cards ensure seamless experience down to 360px | ADR-095 |
| Pre-fill guest name from URL | Personalized links (`?to=...`) populate guest name automatically, reducing friction | ADR-095 |

## Tests Added & Verified

- `frontend/web-app/test/rsvp-dashboard.spec.tsx`:
  - Renders summary cards with headcount and counts.
  - Filters by status (attending / declined / tentative).
  - Truncates and expands long messages.
  - Renders responsive stacked cards on mobile viewport.
  - Handles authenticated CSV export.
- `frontend/web-app/test/guestbook-dashboard.spec.tsx`:
  - Renders pending, approved, and rejected tabs with badge counts.
  - Handles 1-click approve action for pending entries.
  - Handles 1-click reject action for approved entries.
  - Handles delete action with confirmation.
- `frontend/public-invite/test/public-engagement.spec.tsx`:
  - Renders inert preview in live/demo mode.
  - Submits public RSVP, displays thank-you message, and preserves input on error.
  - Submits public guestbook entry, preserves input on error, and handles pending moderation notice.
- Guard scripts:
  - `check-tenant-scope.mjs`: 182 files checked, 0 errors.
  - `check-no-hardcoded-fields.mjs`: 106 files checked, 0 errors.
  - `check-renderer-is-generic.mjs`: 22 files checked, 0 errors.
  - `check-secrets.mjs --all`: 1167 files scanned, 0 errors.
- Test suites:
  - `@wi/web-app`: 409 passed across 28 test files.
  - `@wi/public-invite`: 133 unit tests + 37 SSR tests passed.
  - Workspace typecheck: 19/19 packages clean.
