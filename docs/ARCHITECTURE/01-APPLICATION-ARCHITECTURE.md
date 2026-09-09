# 01 - Application Architecture

## Approach: Modular Monolith
The MVP uses a single backend application (one deployable unit) organized into domain modules with clear boundaries, so it can be split into separate services in the future without a major rewrite.

## Domain Modules (aligned with BACKEND/01-DOMAIN-MODULES.md)
```
app/
├── modules/
│   ├── auth/            (register, login, oauth, session/token)
│   ├── user/             (profile, preferences)
│   ├── invitation/       (invitation CRUD, person, event, gallery, bank_account, quote, settings)
│   ├── template/         (catalog, version, schema, rendering config)
│   ├── media/             (upload, processing pipeline)
│   ├── order/             (order lifecycle)
│   ├── payment/           (gateway integration, webhook handling)
│   ├── publishing/        (publish/unpublish, slug/domain resolution)
│   ├── rsvp/               (public submission + owner management)
│   ├── guestbook/          (public submission + moderation)
│   ├── notification/       (event-driven email/whatsapp)
│   └── admin/              (cross-cutting admin operations, reuses domain services)
├── shared/
│   ├── auth-middleware/
│   ├── validation/
│   ├── audit-log/
│   └── rate-limit/
└── infra/
    ├── db/
    ├── cache/
    ├── storage/
    └── queue/
```

## Inter-Module Boundary Rules
- Modules may ONLY call other modules through their public service layer (see 02-SERVICE-LAYER.md), never directly accessing another module's model/table.
- The `admin` module has no business logic of its own — it orchestrates services from other modules with additional authorization.
- The `payment` module does NOT know the `invitation` domain's details; it only communicates via the `order` module (loose coupling so the payment gateway can be swapped out).

## Layering per Module
```
Controller/Route → Service (business logic) → Repository (data access) → DB
                              │
                              └──► Event publisher (for side effects: notification, audit)
```

## Async Communication
- Side effects that don't need to block the response (sending email, processing images, logging analytics) are published as events to a queue, consumed by separate workers (see 07-QUEUE-WORKER-ARCHITECTURE.md).

## Public vs Authenticated Surface
- The API is explicitly separated: `/api/v1/*` (authenticated, for owners/admins) vs `/public/*` or a separate public path for unauthenticated access (see API/08-PUBLIC-INVITATION-API.md) — making it easier to apply different rate-limiting & caching.

## Evolution Toward Microservices (if needed later)
First candidates for separation if scale increases: `media` (I/O intensive), `payment` (compliance/isolation), `notification` (queue-heavy). Other modules remain a monolith until the load demands otherwise.
