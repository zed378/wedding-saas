# 05 - Payment Flow (Technical Implementation)

Technical complement to API/07-PAYMENT-API.md and SECURITY/07-PAYMENT-SECURITY.md.

## Payment Initiation
```
POST /orders/:orderId/payment
  → OrderService.getOwnedOrder(orderId, currentUser)   // authorization
  → guard: order.status === 'pending', order.expired_at > now()
  → PaymentGatewayPort.createTransaction({
       order_id, amount: order.amount_total,   // from the DB, not the request body
       customer: { name: user.full_name, email: user.email }
     })
  → save a Payment record { status:'pending', provider_reference_id }
  → return { redirect_url / snap_token }
```

## Webhook Handler (Critical)
```
POST /webhooks/payment/:provider
  1. Read the raw body + the signature header
  2. verifySignature(rawBody, signatureHeader, providerSecretKey)
     → if invalid: log a security event, respond 401, STOP (don't process anything)
  3. Parse the payload → find the Payment by (provider, provider_reference_id)
     → if not found: log the anomaly, respond 200 (so the provider doesn't retry forever for an unrecognized case), investigate manually
  4. Idempotency check: if Payment.status is already 'success', respond 200 immediately (no-op)
  5. If the payload states success & the signature is valid:
     db.transaction(() => {
       payment.status = 'success'; payment.verified_at = now();
       order.status = 'paid';
       invitation.status = 'paid';
       statusHistory.record(invitation.id, 'pending_payment', 'paid', changed_by=null, reason='payment webhook');
     });
     eventBus.emit('order.paid', { orderId, invitationId });   // the notification module will send the invoice
  6. respond 200 OK (quickly, < 5 seconds — heavy effects are already offloaded to an event/queue)
```

## Status Polling (UX Fallback)
```
GET /orders/:orderId/payment/status
  → returns the CURRENT status from the DB (already updated by the webhook)
  → (optional) if the status is still pending after some time has passed, the service can perform an active query against the Payment Gateway API as a fallback in case the webhook is suspected to be delayed/failed — this query result ALSO goes through the same verification process before changing state (not trusted raw)
```

## Supporting Jobs
- `order.expire_check` (daily/hourly cron): sets `status='expired'` for `pending` orders whose `expired_at` has passed.
- `payment.reconciliation` (optional, daily cron): compare the transaction list from the Payment Gateway API vs. local data, flag mismatches for manual review (additional mitigation in case a webhook ever fails).

## Refund
```
POST /admin/orders/:id/refund { reason }
  → AdminService (with admin AuthZ) → OrderService.refund(orderId, reason, adminUser)
  → db.transaction(() => {
       order.status = 'refunded';
       invitation.status = 'draft';   // BR-5.4 — a refund reverses the entitlement, not just the payment
       statusHistory.record(invitation.id, previousStatus, 'draft', changed_by=adminUser.id, reason);
       auditLog.record({ admin_id, action:'order.refund', resource_id: orderId, reason });
     });
  → invalidate the public page cache IMMEDIATELY if it was published
  → eventBus.emit('order.refunded', { orderId, invitationId })

Note the target status: `draft`, not `paid`. A refunded invitation that stayed `paid` would remain re-publishable
at no cost, which means the platform returned the money and left the product. `draft` is the state the invitation
was in before it was paid for, which is exactly what a refund reverses it to. The user keeps all of their data
and can pay again whenever they want (BR-5.4, and the diagram in PLAN/06-INVITATION-LIFECYCLE.md).
```
