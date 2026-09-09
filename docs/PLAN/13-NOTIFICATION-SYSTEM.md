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

## Architecture Summary
- Event-driven: domain modules (order, invitation, rsvp) publish events to a queue (see ARCHITECTURE/07-QUEUE-WORKER-ARCHITECTURE.md and BACKEND/07-NOTIFICATION.md).
- A separate worker consumes events → renders the email template → sends it via a provider (e.g., SES/SendGrid/Mailgun).
- Retry with backoff for delivery failures; a dead-letter queue for permanent failures.

## Notification Preferences
- Users can set toggles (e.g., disable per-submission RSVP notifications, only get a daily summary) — stored in `user_notification_preferences`.

## Email Templates
- All emails use a centralized template (not hard-coded in the event code) so they can be easily changed without a deploy — consistent with the same data-driven principle as the invitation template.
