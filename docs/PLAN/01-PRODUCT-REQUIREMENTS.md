# 01 - Product Requirements

Cross-references: 08-INVITATION-DATA-MODEL.md, 07-TEMPLATE-SYSTEM.md, UI-UX/05-USER-FLOWS.md.

## 1. Authentication & Account
- FR-1.1 Users can register with email+password (email verification required before publish, not required for drafts).
- FR-1.2 Users can log in with Google OAuth.
- FR-1.3 Users can reset their password via email.
- FR-1.4 A single account can own more than one invitation (multi-invitation, MVP priority: minimum 1, architecture must be ready for N).

## 2. Template Selection
- FR-2.1 Users can browse the template catalog with filters (category, color, popularity).
- FR-2.2 Users can view template details (preview per section, public demo).
- FR-2.3 Users can select a template to start a new invitation.
- FR-2.4 Users can change an existing invitation's template WITHOUT losing data (invitation data is independent of the template — see 08-INVITATION-DATA-MODEL.md). Fields not supported by the new template are kept but hidden (not deleted).

## 3. Invitation Creation (Editor)
- FR-3.1 Input couple data (groom & bride): full name, nickname, photo, Instagram, father's name, mother's name, birth order.
- FR-3.2 Input event data (supports multiple events, e.g., Akad + Reception): type, title, date, start time, end time, venue name, address, coordinates, maps link, description.
- FR-3.3 Input photo gallery (multi-upload, reorder, delete, item limit based on package).
- FR-3.4 Input bank account/e-wallet for digital gifts (bank, account number, account holder name — multiple entries).
- FR-3.5 Input opening quote/verse (free text, optional source).
- FR-3.6 Configure RSVP (enable/disable, custom guest-count question, attendance options).
- FR-3.7 Configure Guestbook (enable/disable, moderation on/off).
- FR-3.8 Configure which sections are active/inactive based on template capability (see 07-TEMPLATE-SYSTEM.md § Configurable Sections).
- FR-3.9 Auto-save draft on every change (debounced) — no mandatory "save" button.

## 4. Preview
- FR-4.1 Real-time live preview while editing (changes in the editor are immediately reflected without a full reload).
- FR-4.2 Toggle mobile/desktop preview.
- FR-4.3 Preview accessible via a temporary link (share preview) before publishing, with a "PREVIEW" watermark.

## 5. Order & Payment
- FR-5.1 Users select a package (e.g., Basic, Premium) when publishing.
- FR-5.2 Checkout shows a price summary, add-ons (custom domain, etc.).
- FR-5.3 Payment gateway integration (minimum VA, e-wallet, QRIS).
- FR-5.4 Order/payment status only changes based on a validated callback from the provider (see SECURITY/07-PAYMENT-SECURITY.md — client parameters must NEVER be trusted).
- FR-5.5 Users receive an invoice (email + order history page).

## 6. Publish & Domain
- FR-6.1 After successful payment, the invitation automatically becomes eligible to publish (user clicks the Publish button).
- FR-6.2 Users choose a subdomain slug (uniqueness validation, format, blocked words).
- FR-6.3 (Phase 2) Users can connect a custom domain.
- FR-6.4 Users can unpublish/republish without losing data.
- FR-6.5 The invitation has an active period (expiry) based on the package; the system sends a reminder before expiry.

## 7. Public Invitation Page
- FR-7.1 Guests can open the invitation without logging in.
- FR-7.2 Displays all active sections per user and template configuration.
- FR-7.3 Automatic countdown to the nearest event date.
- FR-7.4 Guests can submit RSVP (name, guest count, attendance status, optional message).
- FR-7.5 Guests can write in the guestbook (name, message) — moderation according to owner's settings.
- FR-7.6 "Copy Account Number" button on the gift section.
- FR-7.7 Share button (WhatsApp, copy link).
- FR-7.8 Guest name personalization via query parameter (`?to=Guest+Name`), optional.

## 8. Admin Panel
- FR-8.1 Manage users (view, suspend).
- FR-8.2 Manage templates (CRUD metadata, versions, publish/deprecate).
- FR-8.3 Manage orders & payments (view status, manual refund).
- FR-8.4 Content moderation (reports on inappropriate guestbook/gallery content).
- FR-8.5 Basic metrics dashboard (user count, invitation count, revenue).

## Non-Functional Requirements Summary
See 17-ACCEPTANCE-CRITERIA.md for measurable criteria; see ARCHITECTURE/ and SECURITY/ for detailed NFRs (performance, availability, security).
