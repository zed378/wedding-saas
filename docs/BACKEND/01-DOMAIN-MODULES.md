# 01 - Domain Modules

Implementation detail for ARCHITECTURE/01-APPLICATION-ARCHITECTURE.md § Domain Modules.

## Module: auth
- Service: `AuthService` (register, login, oauth, refresh, verify-email, reset-password).
- Depends on: `UserRepository`, `TokenService`, `EmailNotificationPort` (an interface, concretely implemented in the notification module).

## Module: invitation
- Service: `InvitationService` (CRUD for the invitation + sub-entities: person, event, gallery, bank_account, quote, settings).
- Separate sub-services per sub-entity to maintain single-responsibility: `EventService`, `GalleryService`, etc., all called from `InvitationService` as a facade OR the controller calls each sub-service directly (team's decision, must be consistent).
- Depends on: `TemplateService` (for validating required_fields at publish time), `MediaService` (validating media ownership when attaching to the gallery).

## Module: template
- Service: `TemplateService`, `TemplateVersionService`.
- Doesn't depend on any other module (the most independent, purely admin-managed data).

## Module: media
- Service: `MediaService` (upload orchestration, validation, enqueueing the processing job).
- Depends on: `StoragePort` (an interface to object storage), `QueuePort`.

## Module: order & payment
- `order`: `OrderService` (create an order, calculate price from `packages`/`addons`).
- `payment`: `PaymentService` (initiate with the provider), `PaymentWebhookHandler`.
- The `payment` module does NOT know about `Invitation` — it only interacts with the `order` module via `OrderService.markPaid(orderId)`, which in turn notifies the `invitation` module (an `order.paid` event) — decoupling per ARCHITECTURE/01.

## Module: publishing
- Service: `PublishingService` (completeness validation, status transitions, slug resolution, cache invalidation triggering).

## Module: rsvp & guestbook
- A public-facing service separate from the authenticated `InvitationService` for public endpoints, but sharing the same repository.

## Module: notification
- `NotificationService` acts as an event consumer from other modules (event-driven, see 07-NOTIFICATION.md).

## Module: admin
- Has no repository of its own — it orchestrates other modules' services with additional permissions + MUST call `AuditLogService.record(...)` for every write action.

## Internal Event Bus (between modules, in-process for MVP)
```
order.paid          → the invitation module (sets status to paid), the notification module (sends the invoice)
invitation.published → the notification module, the analytics/cache module
guestbook.submitted  → the notification module (optionally to the owner)
```
