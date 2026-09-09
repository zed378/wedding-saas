# 10 - Component Specification (Key Components)

## InvitationCard (Dashboard List)
- Props: template thumbnail, internal_name, status badge, slug (if published), the nearest event date, action buttons (Edit/Preview/Duplicate/Delete).
- Empty state: an illustration + a "Create Your First Invitation" button.

## TemplateCard (Catalog)
- Props: thumbnail, name, category tags, a Premium badge (if applicable), hover shows "View Details" & "Use" buttons.

## SectionListItem (Editor Sidebar)
- Props: section name, icon, on/off toggle (if `configurable: true` in the template schema), an "incomplete" indicator (a red dot) if any required_fields are empty.
- Interaction: click → sets the active section in the Properties Panel & scrolls the preview to that section.

## LivePreviewFrame
- An iframe/embed that renders the template components with the editor state's current data (not an API round-trip on every keystroke — direct client-side rendering from local state, synced separately/asynchronously with the server draft).
- Device toggle: mobile (375px frame) / desktop (scaled full width).

## PropertiesPanel (Dynamic Form)
- Generated from the `required_fields`/`optional_fields` of the template schema (not hard-coded per section) — the field type (text/textarea/photo/date/time/select) is determined from the canonical field metadata (PLAN/08).
- Inline validation per field according to its type (e.g., date format, text length).

## PaymentStatusBanner
- States: `pending` (yellow, with a spinner + auto-poll), `success` (green + optional light confetti), `failed`/`expired` (red + a "Try Again" button).
- Never displays "success" without confirmation from a server status GET (SECURITY/07).

## RsvpTable (Owner Dashboard)
- Columns: Name, Attendance Status (colored badge), Guest Count, Message (truncate + expand), Submission Time.
- Filter by status, a CSV Export button, a summary in the header (X Attending, Y Not Attending, Z Maybe).

## GuestbookModerationList
- Item: name, message, status badge, Approve/Reject/Delete buttons, timestamp.
- Filter tabs: Pending / Approved / Rejected.

## ModalConfirmDestructive
- Props: title, impact description, a confirmation input (retype the name/slug for very destructive actions like deleting an invitation), a danger button.
