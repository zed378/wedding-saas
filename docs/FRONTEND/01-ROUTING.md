# 01 - Routing

## Web App (Authenticated + Marketing)
```
/                                  Landing (public)
/templates                          Catalog (public)
/templates/[slug]                    Detail (public)
/login, /register, /forgot-password    (public)
/dashboard                              (protected)
/dashboard/new                           (protected)
/editor/[invitationId]                    (protected, route guard: client-side ownership check for a fast UX, ALWAYS revalidated server-side on every API call)
/checkout/[invitationId]                   (protected)
/orders, /orders/[orderId]                  (protected)
/settings/account                            (protected)
```

## Public Invitation App (separate, SSR)

Served on its own hostname, `invitation.vizunicum.my.id` (PLAN/10-DOMAIN-PUBLISHING.md, MEMORY ADR-024):

```
/{slug}             The invitation
/preview/{token}    Share-preview of an unpublished invitation (noindex, watermarked, submissions disabled)
/public/*           Proxied to the API — guest RSVP, guestbook and view counter, same-origin
```

Everything else on this host is a 404. That is deliberate: with invitations at the root, any other route would be able to shadow one.

Resolution is **path-based at MVP** and moves to host-based later without a rewrite — the slug is read by a configured strategy (BACKEND/06-PUBLISHING.md). Path URLs will redirect permanently to subdomain URLs when that happens.

The authenticated application lives on a different hostname (`app.vizunicum.my.id`). Keeping guest-submitted content on its own origin is a security boundary, not a cosmetic split (SECURITY/02).

## Admin Panel
```
/dashboard, /users, /users/[id]
/templates, /templates/[id]/versions/[vid]/edit
/orders, /orders/[id]
/moderation/guestbook
/audit-logs
```
Served on its own hostname (`admin.vizunicum.my.id`) with its own cookie scope — conventional internal routing within it (SECURITY/02 boundary 3→4).

## Route Guards
- Protected route: redirect to `/login` if the token is invalid/expired, save the intended URL to redirect back after a successful login.
- Admin route: redirect to an "Unauthorized" page (not a generic 404) if the role doesn't match, with a clear message.

## Important Query Parameters
- `?to=Name` on the Public Invitation — guest name personalization (purely client-side, doesn't affect server-side routing/caching).
- `?returning=true` on the order page after a redirect from the payment gateway — triggers status polling.
