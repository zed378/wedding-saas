# 09 - Privacy & Data Protection

## Principles
- Aligned with Indonesia's PDP Law (Personal Data Protection): minimal data collection (data minimization), clear purpose (purpose limitation), adequate security, and respect for data subject rights.

## Personal Data Managed
| Data | Source | Sensitivity | Notes |
|---|---|---|---|
| Names, photos of the couple & family | User (owner) input | Sensitive | Displayed with the conscious consent of the user (the one publishing) |
| Venue address & coordinates | User input | Sensitive (may be a private home address) | Photo EXIF GPS is stripped (SECURITY/06); the venue's text address is intentionally public for invitation purposes |
| Bank account number | User input | Critical (financial) | Intentionally displayed by the user for digital gifts; API access remains fully protected |
| Guest data (RSVP, guestbook name+message) | Anonymous visitor input | Sensitive | No identity verification, an implicit product disclaimer |
| Visitor IP address | Automatic (request) | Sensitive | Stored as a HASH only for rate-limit/anti-spam purposes, NOT stored raw except when needed for short-term security investigation with limited retention |

## Data Subject Rights
- Users can request account & data deletion (API/02-USER-API.md `DELETE /users/me`) — triggers a soft-delete, then full hard-delete after the retention period (PLAN/02 § BR-9).
- Users can export their invitation data (optional Phase 2 — data portability).
- Guests who submitted RSVP/guestbook entries can request their message be deleted via support contact (a manual process for MVP, since there is no guest account).

## Data Minimization
- The system does NOT collect data unnecessary for the product's function (e.g., it does not request a national ID, does not track granular visitor behavior without a clear purpose — see PLAN/14-ANALYTICS.md § Privacy).
- Default `seo_indexable = false` so the invitation (which contains guest info, RSVP) isn't automatically indexed by search engines without the user's explicit consent (PLAN/15-SEO.md).

## Encryption
- Data in-transit: TLS across all connections (client-server, server-DB if across a network, server-storage).
- Data at-rest: **storage-level encryption for the whole database**, plus encrypted backups (DEVOPS/04-DATABASE-BACKUP.md).
- **No column-level encryption for `invitation_bank_accounts.account_number`** (decided — MEMORY ADR-025). The reasoning matters more than the conclusion, because the instinct runs the other way:
  - The field exists so a guest who cannot attend can send a gift. The couple enters it **in order to publish it** on their own invitation. The platform never uses it to move money; a transfer happens between a guest and the couple's own bank, outside the system.
  - For a published invitation with the gift section enabled, that number is already served to every guest who opens the link. Encryption protects only the subset that is not public — drafts, invitations with the gift section off, expired ones.
  - Against a stolen dump, encrypting this one column changes little: the same dump holds names, home and venue addresses, coordinates, phone numbers, photographs and complete guest lists in plaintext. Encryption of the whole store is the proportionate control, not one column inside it.
  - It also forecloses the one query worth having — whether an account number is reused across unrelated invitations, which is a real fraud signal.
- **What replaces it is integrity protection**, because for a number published in order to receive money, tampering is the worse outcome. An attacker who changes the account number on a live invitation collects every guest's gift, and the couple finds out after the wedding. So: object-level authorization (SECURITY/05), an audit trail on bank account writes, and an email to the owner whenever gift account details change on a `published` invitation (PLAN/13-NOTIFICATION-SYSTEM.md).
- `payments.raw_callback_payload` is a separate case and is also **not** column-encrypted: it is never displayed, and it is retained precisely so a signature can be re-verified during an investigation, which redaction would destroy. Access is restricted and logged (API/09). If a provider is ever seen sending card-like data, that is a PCI scope change to catch in the payment security review.

## Retention & Deletion
- Per BR-9 (PLAN/02): an invitation `expired` for > 90 days without renewal → soft-delete → hard-delete 30 days later, with 3 email notifications sent beforehand.
- Application logs containing PII (if any) have limited retention (e.g., 90 days), different from `audit_logs` (2 years, since audit_logs is for admin accountability, not guest personal data).

## Third-Party Data Sharing
- Data sent to the payment gateway (name, email for invoicing) is limited to the minimum fields the provider requires, and is disclosed in the product's privacy policy.
