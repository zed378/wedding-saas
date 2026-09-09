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

## Public Invitation App (separate, SSR/ISR)
```
/                (resolved from the Host header subdomain/custom domain → a specific invitation)
```
Routing here is not path-based but rather **host-based multi-tenancy** — a middleware/edge function determines the `invitation_id` from the `Host` header before the request reaches the render handler (see ARCHITECTURE/08, PLAN/10).

## Admin Panel
```
/dashboard, /users, /users/[id]
/templates, /templates/[id]/versions/[vid]/edit
/orders, /orders/[id]
/moderation/guestbook
/audit-logs
```
Base path/subdomain separate (`admin.maindomain.com`) — conventional internal routing.

## Route Guards
- Protected route: redirect to `/login` if the token is invalid/expired, save the intended URL to redirect back after a successful login.
- Admin route: redirect to an "Unauthorized" page (not a generic 404) if the role doesn't match, with a clear message.

## Important Query Parameters
- `?to=Name` on the Public Invitation — guest name personalization (purely client-side, doesn't affect server-side routing/caching).
- `?returning=true` on the order page after a redirect from the payment gateway — triggers status polling.
