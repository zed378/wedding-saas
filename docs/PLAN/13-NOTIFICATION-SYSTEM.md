# 13 - Notification System

## MVP Channels
- Email (transactional) — mandatory.
- (Phase 2) WhatsApp Business API.
- (Phase 2) In-app notification bell for owners (new RSVP, new guestbook entry).

## Notification List
| Event | Trigger | Recipient | Channel |
|---|---|---|---|
| Account verification | Registration | New user | Email |
| Password reset | Reset request | User | Email |
| Invoice/Receipt | Payment success | User | Email |
| Publish successful | Invitation published | User | Email |
| New RSVP | Guest submits RSVP | Invitation owner (if opted in) | Email |
| H-7/H-1 expiry reminder | Scheduled job | User | Email |
| Invitation expired | Status transition job | User | Email |
| Refund processed | Admin action | User | Email |
| **Gift account changed** | Bank account added, edited or removed on a `published` invitation | Invitation owner | Email (not opt-out-able) |

The gift account change notification is a security control, not a convenience: the account number on a published invitation is where guests send money, so a silent change is the highest-consequence tampering the product allows. The email says what changed and when, in the manner of a bank confirming a payee change, so an owner whose account has been compromised finds out before the wedding rather than after (SECURITY/09 § Encryption, MEMORY ADR-025). It is therefore **not subject to notification preferences** — see BACKEND/07 § Preferences.

## Architecture Summary
- Event-driven: domain modules (order, invitation, rsvp) publish events to a queue (see ARCHITECTURE/07-QUEUE-WORKER-ARCHITECTURE.md and BACKEND/07-NOTIFICATION.md).
- A separate worker consumes events → renders the email template → sends it via a provider (e.g., SES/SendGrid/Mailgun).
- Retry with backoff for delivery failures; a dead-letter queue for permanent failures.

## Notification Preferences
- Users can set toggles (e.g., disable per-submission RSVP notifications, only get a daily summary) — stored in `user_notification_preferences`.

## Email Templates
- All emails use a centralized template (not hard-coded in the event code) so they can be easily changed without a deploy — consistent with the same data-driven principle as the invitation template.
