# 01 - Threat Model (STRIDE Summary)

## Key Assets
- Invitation data (personal info, address, bank account).
- User credentials (password, token).
- Payment data (order, payment record).
- Public page availability (business reputation on the wedding day).

## Actors
- Authenticated users (honest & malicious).
- Anonymous visitors (invitation guests, honest & malicious/spammers).
- Internal admins (honest & insider threat).
- External systems (payment gateway, OAuth provider) — partially trusted, validated via signatures.

## STRIDE per Key Component

### Editor/Invitation API
- **Spoofing**: a stolen token → mitigation: short-lived access tokens, refresh token rotation, anomalous login detection.
- **Tampering**: a user modifying another user's invitation → mitigation: object-level authorization on EVERY endpoint (05-MULTI-TENANCY-SECURITY.md).
- **Repudiation**: a user denying they made a change → mitigation: `updated_at`, application logs with `user_id` on every write.
- **Information Disclosure**: enumerating invitation/media IDs reveals other users' data → mitigation: non-sequential UUIDs, and a consistent 404 for both "does not exist" and "not yours" (API/00 § 403 vs 404).
- **Denial of Service**: bulk requests creating spam invitations/orders → mitigation: rate limiting.
- **Elevation of Privilege**: a user gaining admin access via token/role manipulation → mitigation: role is validated server-side from the DB on every request, JWT signed with a strong secret.

### Public Invitation Page & RSVP/Guestbook
- **Spoofing**: submitting an RSVP under someone else's name → accepted risk (the product is intentionally open to the public), mitigation only at the abuse level (rate limiting), not identity.
- **Tampering**: XSS via a message/guest name → mitigation: input sanitization & output encoding (08-API-SECURITY.md).
- **DoS**: RSVP/guestbook submission flooding → mitigation: rate limiting per IP+slug, CAPTCHA if needed (10-ABUSE-PREVENTION.md).
- **Information Disclosure**: leaking data from an unpublished/expired invitation to the public → mitigation: public queries ALWAYS filter by `status='published'`.

### Payment Webhook
- **Spoofing**: a malicious party sends a fake webhook claiming a successful payment → MANDATORY mitigation: verify the provider's signature (07-PAYMENT-SECURITY.md).
- **Replay**: a valid webhook resent for a duplicate effect → mitigation: idempotency via a unique `provider_reference_id`.

### Media Upload
- **Tampering/Malware**: uploading a malicious file (a webshell disguised as an image, a decompression bomb) → mitigation via multiple layers (06-FILE-UPLOAD-SECURITY.md).

### Admin Panel
- **Elevation of Privilege**: a compromised admin account has very broad impact → mitigation: mandatory 2FA, separate subdomain, full audit log, stricter login rate limits.

## Mitigation Priority (by impact × likelihood)
1. Object-level authorization (IDOR) — very high impact on the privacy of thousands of users.
2. Payment webhook signature verification — direct financial impact.
3. File upload validation — RCE/server compromise impact.
4. Rate limiting public endpoints — availability impact during critical moments (the wedding day).
