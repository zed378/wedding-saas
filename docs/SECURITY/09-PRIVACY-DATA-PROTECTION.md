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
- Data at-rest: consider column-level encryption for `invitation_bank_accounts.account_number` and `payments.raw_callback_payload` using application-level encryption (not only the provider's disk encryption) as an additional layer.

## Retention & Deletion
- Per BR-9 (PLAN/02): an invitation `expired` for > 90 days without renewal → soft-delete → hard-delete 30 days later, with 3 email notifications sent beforehand.
- Application logs containing PII (if any) have limited retention (e.g., 90 days), different from `audit_logs` (2 years, since audit_logs is for admin accountability, not guest personal data).

## Third-Party Data Sharing
- Data sent to the payment gateway (name, email for invoicing) is limited to the minimum fields the provider requires, and is disclosed in the product's privacy policy.
