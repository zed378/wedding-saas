# 09 - Order & Payment

See also BACKEND/05-PAYMENT-FLOW.md and SECURITY/07-PAYMENT-SECURITY.md for technical & security details.

## Entities
```
Order
├── order_id
├── invitation_id
├── user_id
├── package_id          (Basic/Premium)
├── addons[]             (custom_domain, extra_photo_quota, extended_validity)
├── amount_total
├── status               enum: pending | paid | failed | expired | refunded
├── created_at
└── expired_at            (payment deadline, e.g., 24 hours)

Payment
├── payment_id
├── order_id
├── provider              (midtrans/xendit)
├── provider_reference_id
├── method                 (va, ewallet, qris)
├── amount
├── status                 enum: pending | success | failed
├── raw_callback_payload   (stored for audit purposes, DO NOT use as the source of a decision without signature verification)
└── verified_at
```

## Add-on Availability at MVP

`custom_domain` is defined in the `addons` table (DATABASE/07) but is **seeded inactive** (`is_active = false`) until the custom domain feature ships, which PLAN/00 § Phase 2 Scope places after the MVP. An inactive addon cannot be added to an order (API/06), so the catalogue and the shipped capability stay in step. Selling access to something that does not exist yet is a support problem first and a consumer-protection problem second.

`extended_validity` is active at MVP: it is the renewal path described below, and needs no feature that is not already built.

## Packages (example, final pricing out of scope for this document)
| Package | Photos | Custom Domain | Watermark | Active Period |
|---|---|---|---|---|
| Basic | 20 | No | Yes (small) | 6 months |
| Premium | Unlimited* | Add-on | No | 12 months |

## Order Flow
1. User clicks "Publish" on an invitation eligible for publishing but not yet paid → the system checks the invitation's status.
2. If there is no active order → create a new `Order` with status `pending`, `expired_at = now + 24h`.
3. Redirect/embed the payment page from the provider, referencing `order_id`.
4. User pays on the provider's side.
5. The provider sends a webhook to the backend endpoint (see API/07-PAYMENT-API.md).
6. The backend verifies the webhook signature → updates `Payment.status` → if `success`, updates `Order.status = paid` AND `Invitation.status = paid` in a single transaction.
7. The user is redirected to the "Order Successful" page (the client does NOT change any status — it only displays the latest result fetched via GET from the server).

## Critical Rule (BR-5.2)
> Payment status is NEVER decided based on redirect URL parameters or client input. It always comes from a validated webhook OR the server polling the provider's API for status.

## Order Expiry
- A scheduled job marks `Order.status = expired` if `expired_at` has passed and no successful payment has occurred (see BACKEND/08-JOBS-WORKERS.md).
- Users can create a new order anytime after the old one expires/fails.

## Refund
- Performed manually by an admin (see API/09-ADMIN-API.md), a reason is mandatory and logged in the audit log, triggering the state transition in 06-INVITATION-LIFECYCLE.md.

## Invoice
- An invoice/receipt is generated after `Payment.status = success`, sent via email, and available for download (PDF) in the Order History.
