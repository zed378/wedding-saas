# 07 - Notification (Technical Implementation)

Technical complement to PLAN/13-NOTIFICATION-SYSTEM.md.

## Event-Driven Consumer
```
The NotificationModule listens for events on the internal event bus:
  'user.registered'        → send a verification email
  'user.password_reset_requested' → send a reset email
  'order.paid'              → send the invoice/receipt email
  'invitation.published'     → send a publish-confirmation email
  'invitation.expiring_soon'  → (from the reminder job) send an H-7/H-1 reminder
  'invitation.expired'         → send a notification email
  'rsvp.submitted'              → email the owner (if the preference is enabled)
  'order.refunded'               → send a refund notification email
```

## Handler Structure
```
async function handleOrderPaid(event) {
  const { orderId, invitationId } = event;
  const order = await orderRepo.find(orderId);
  const user = await userRepo.find(order.user_id);
  await emailPort.send({
    to: user.email,
    template: 'invoice',
    data: { orderNumber: order.id, amount: order.amount_total, invitationName: ... }
  });
}
```
- Every handler is wrapped in try-catch + a retry policy (ARCHITECTURE/07) — an email delivery failure does NOT affect the main transaction (the order/invitation was already committed before the event was emitted; the event is delivered "at-least-once," separately).

## Email Templates
- Stored centrally (e.g., a `templates/email/*.mjml` folder or similar), rendered with data via a templating engine — NOT a hard-coded HTML string inside the handler logic.
- Consistent branding (the same header/footer across all emails).

## Preferences
```
async function handleRsvpSubmitted(event) {
  const pref = await notifPrefRepo.find(event.ownerId);
  if (!pref.rsvp_email) return; // respect the user's preference, skip sending
  ...
}
```

## Provider Abstraction
```
interface EmailPort {
  send(params: { to: string; template: string; data: object }): Promise<void>;
}
// Concrete implementations: SesEmailAdapter, SendgridEmailAdapter — can be swapped without changing the NotificationModule
```

## Dead Letter & Monitoring
- A notification job that permanently fails after max retries goes into the dead-letter queue and is alerted on (DEVOPS/07-ALERTING.md) for manual investigation — especially for critical transactional emails (invoice, account verification).
