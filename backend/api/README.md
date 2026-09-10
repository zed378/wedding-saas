# @wi/api

The REST API. NestJS, twelve domain modules, layered `Controller -> Service -> Repository -> DB`.

**Governed by**: `docs/ARCHITECTURE/01-APPLICATION-ARCHITECTURE.md` (module boundaries),
`docs/ARCHITECTURE/03-BACKEND-ARCHITECTURE.md` (layering), `docs/API/` (the contract),
`docs/BACKEND/` (standards, validation, services).

## Layout

```
src/modules/    auth user invitation template media order payment
                publishing rsvp guestbook notification admin
src/shared/     auth-middleware validation audit-log rate-limit sanitizer
src/infra/      db cache storage queue
```

Modules talk to each other only through public service interfaces, never another module's
repository or tables. The `payment` module does not know the invitation domain exists — it
reaches `order`, which emits `order.paid` (`docs/BACKEND/01`).

## Two rules that are not negotiable here

- **Object-level authorization lives in the service layer**, expressed as a query filter
  (`WHERE owner_id = :current_user_id`), never as a controller check or a decorator that can be
  omitted. A non-owner gets 404, never 403. `docs/SECURITY/05` is the project's first priority.
- **Business logic lives only in services.** Controllers parse, delegate and format.

## Surfaces

Three route trees, mounted separately because they differ in authentication, rate limiting and
caching (`docs/ARCHITECTURE/01`):

| Prefix            | Who calls it                                          |
| ----------------- | ----------------------------------------------------- |
| `/api/v1/*`       | Authenticated users and admins                        |
| `/public/*`       | Anonymous guests — served from the invitation host    |
| `/api/webhooks/*` | Payment provider, signature-verified, no user session |

Commands are wired in `P0-04`.
