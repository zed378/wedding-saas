# 02 - Business Rules

## BR-1 Ownership & Access
- BR-1.1 Each invitation is owned by exactly one user (`owner_id`). No shared ownership in the MVP.
- BR-1.2 Users can only view/modify/delete their own invitations. Violation = a security incident (see SECURITY/05).
- BR-1.3 Admins can view all invitations for moderation/support purposes, logged in the audit log.

## BR-2 Invitation Lifecycle
- BR-2.1 A new invitation starts as `draft`. Drafts can be edited freely and are not public.
- BR-2.2 The invitation becomes `pending_payment` when the user checks out.
- BR-2.3 The invitation becomes `paid` after a validated payment callback is received.
- BR-2.4 A `paid` invitation can be `published` (becomes publicly accessible).
- BR-2.5 A `published` invitation can be `unpublished` (returns to private, data is not lost, remains `paid`).
- BR-2.6 A `published` invitation that passes its `expiry_date` automatically becomes `expired` (not publicly accessible, shows an "invitation has ended" page).
- BR-2.7 Status transitions MUST NOT move backward automatically except by an admin (e.g., refund).
- See the full diagram in 06-INVITATION-LIFECYCLE.md.

## BR-3 Template
- BR-3.1 An invitation stores a reference to a specific `template_id` + `template_version_id` (not "latest"), so that a published invitation's appearance doesn't change when the template is updated by an admin.
- BR-3.2 Users can explicitly "upgrade" to the latest template version; this is a conscious action, not automatic.
- BR-3.3 A deprecated template can still be rendered for existing invitations that reference it, but no longer appears in the catalog for new invitations.

## BR-4 Section Data
- BR-4.1 Sections not supported by the active template are NOT displayed publicly, but the data remains stored in the database (to remain safe if the user switches templates).
- BR-4.2 Required fields (`required: true` per the template schema) must not be empty when publishing — validation blocks the action if empty.

## BR-5 Payment & Orders
- BR-5.1 One order corresponds to one invitation and one package (+ optional add-ons).
- BR-5.2 Payment status is only changed by the system based on a validated callback/webhook from the payment provider whose signature has been verified. Never from direct user input.
- BR-5.3 If a payment fails/expires, the invitation remains `draft`, the order status becomes `failed`/`expired`, and the user can create a new order.
- BR-5.4 Refunds can only be performed manually by an admin. The invitation returns to `draft` from whatever state it was in — including directly from `published`, which stops it being publicly accessible immediately (cache invalidated, not left to expire). A refund reverses the entitlement, not only the payment: leaving the invitation `paid` would return the customer's money and leave them the product. All data is preserved and the user may order again at any time. See BACKEND/05-PAYMENT-FLOW.md § Refund.

## BR-6 Slug & Domain
- BR-6.1 The subdomain slug must be globally unique, 3-50 characters, letters/numbers/dashes only, and must not contain words on the blocklist (hate speech, "admin," "api," etc. — see SECURITY/10-ABUSE-PREVENTION.md).
- BR-6.2 The slug can be changed before the first publish; after publishing, changing the slug requires explicit confirmation (since old links become invalid) and is rate-limited.

## BR-7 RSVP & Guestbook
- BR-7.1 RSVP can be submitted by anyone who has the invitation link (no login required) — rate-limited per IP/device to prevent spam.
- BR-7.2 Ideally each guest submits once; the system uses a cookie/local identifier to prevent accidental duplicate submission, but this is not strictly enforced (different guests may share the same device).
- BR-7.3 Guestbook with moderation enabled: new messages start as `pending` and only appear publicly after being `approved` by the invitation owner.

## BR-8 Media
- BR-8.1 Total storage quota per invitation is limited according to the package (e.g., Basic: 20 photos, Premium: unlimited up to a reasonable cap of 200).
- BR-8.2 All files are reprocessed (resized, EXIF stripped) before being permanently stored — see SECURITY/06-FILE-UPLOAD-SECURITY.md.

## BR-9 Expiry & Retention
- BR-9.1 After being `expired` for 90 days without renewal, invitation data may be permanently deleted (soft-delete → hard-delete), with 3 notifications sent to the user before deletion.
