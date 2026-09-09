# 04 - Feature Specification

Functional specification per feature, at a level of detail sufficient for breaking down implementation tickets. For the data model, see 08-INVITATION-DATA-MODEL.md; for the API, see API/.

## F1. Template Catalog & Selection
- Grid/list of templates with thumbnail, name, category, "Premium"/"Free" badge.
- Filter by category (Modern, Minimalist, Islamic, Rustic, etc.) and color.
- Search by name.
- Detail page: screenshot carousel per section, "Use This Template" button, "View Demo" button (opens the public demo in a new tab, with dummy data).

## F2. Invitation Setup Wizard (first-time)
- Step 1: select a template (if not already chosen from the catalog).
- Step 2: input the initial slug + internal invitation name (for multi-invitation users).
- Step 3: redirect to the Editor.
- The wizard only appears once at the start; afterward, users go straight to the Editor.

## F3. Editor
- 3-column layout: Section List (left) — Live Preview (center) — Properties Panel (right). See details in UI-UX/12-EDITOR-UX.md and FRONTEND/06-EDITOR-ARCHITECTURE.md.
- Autosave with a 1-2 second debounce + status indicator ("Saving..."/"Saved").
- Undo/redo at least 1 level (optional for MVP).
- Inline validation per field according to the template schema (see 07-TEMPLATE-SYSTEM.md).

## F4. Media Manager
- Drag-drop or file-picker upload, multi-file.
- Progress bar per file, retry on failure.
- Reorder via drag (gallery), set primary photo (couple photo, cover).
- Basic crop/adjust (optional for MVP, minimum aspect-ratio guide).

## F5. Maps Picker
- Text address input + interactive map pin (Google Maps/OpenStreetMap embed) to capture latitude/longitude.
- "Use Current Location" button (optional).
- Auto-generate `maps_url` from coordinates.

## F6. Preview & Share Preview
- Device toggle (mobile 375px / full desktop).
- "Share Preview" button generates a temporary link (token, 7-day expiry) with a "PREVIEW - NOT YET PUBLISHED" visual watermark.

## F7. Checkout
- Package options displayed as cards (feature comparison).
- Price summary + voucher code (optional for MVP).
- Redirect to the payment gateway page/snap popup.

## F8. Publish Flow
- Once `paid`, the "Publish" button becomes active.
- Final slug confirmation modal.
- After successful publish → show the link + share buttons (WA, copy).

## F9. Public Invitation Page
- See UI-UX/14-PUBLIC-INVITATION-UX.md for section order & interactions.
- Dynamic SEO meta (og:title, og:image from the cover photo) — see PLAN/15-SEO.md.
- Background music autoplay toggle (if the music section is active).
- Client-side JS countdown, synced to Asia/Jakarta timezone by default (configurable).

## F10. RSVP Management (Owner side)
- Table of incoming RSVPs (name, guest count, status, submission time), status filter, CSV export.
- Summary (total confirmed attending, total guest count).

## F11. Guestbook Management (Owner side)
- List of messages with pending/approved status, approve/reject/delete buttons.
- Moderation on/off toggle.

## F12. Order History & Invoice
- Order list with status, date, amount.
- Download invoice (PDF, see the pdf skill during implementation).

## F13. Admin — Template Management
- CRUD templates, upload section assets, define schema (see 07-TEMPLATE-SYSTEM.md), create new versions, set status (draft/published/deprecated).

## F14. Admin — User & Order Management
- List/search users, suspend/unsuspend.
- List orders, view payment details, manual refund button (with mandatory reason, logged to the audit log).

## F15. Notifications (email-only for MVP)
- Account verification email.
- Invoice/receipt email.
- Reminder email H-7/H-1 before invitation expiry.
- New RSVP notification email (optional, user can toggle).
