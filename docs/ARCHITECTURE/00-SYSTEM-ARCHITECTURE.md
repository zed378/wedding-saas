# 00 - System Architecture

## High-Level Diagram
```
                         ┌─────────────────┐
                         │      CDN         │  (static assets, media, cached public pages)
                         └────────┬────────┘
                                  │
                         ┌────────▼────────┐
                         │ Reverse Proxy /  │  (TLS termination, subdomain/custom-domain routing)
                         │  Edge Router      │
                         └────────┬────────┘
             ┌────────────────────┼───────────────────────┐
             ▼                    ▼                        ▼
   ┌──────────────────┐ ┌──────────────────┐   ┌──────────────────────┐
   │ Frontend App       │ │ Backend API        │   │ Admin Panel (separate │
   │ (User-facing SPA/  │ │ (REST, business    │   │ app or route, RBAC-   │
   │  SSR for public     │ │  logic, auth)       │   │  gated)                │
   │  invitation pages)  │ │                    │   │                        │
   └──────────────────┘ └────────┬──────────┘   └──────────┬────────────┘
                                  │                          │
                     ┌────────────┼──────────────────────────┘
                     ▼            ▼
           ┌─────────────┐ ┌─────────────┐        ┌───────────────────┐
           │  Primary DB  │ │  Cache/Redis │        │  Object Storage    │
           │ (Postgres)   │ │              │        │  (media/assets)     │
           └─────────────┘ └─────────────┘        └───────────────────┘
                     │
                     ▼
           ┌─────────────────────┐
           │ Queue (jobs/events)  │───► Worker(s): payment webhook processing,
           └─────────────────────┘     media processing, notification, expiry job
                     │
                     ▼
           ┌─────────────────────┐
           │ External Services    │  (Payment Gateway, Email Provider, Maps API,
           └─────────────────────┘   OAuth Provider)
```

## Core Components
1. **Frontend App** — the user-facing application (marketing, auth, editor, dashboard). The public invitation page can be a separate application/dedicated route with a different rendering strategy (see FRONTEND/07-PUBLIC-INVITATION.md — SSR/ISR for SEO & performance).
2. **Backend API** — a stateless REST API handling all business logic (see 01-APPLICATION-ARCHITECTURE.md, 03-BACKEND-ARCHITECTURE.md).
3. **Admin Panel** — logically separated (separate route/subdomain) to reduce the attack surface and simplify RBAC.
4. **Primary DB** — PostgreSQL (relational, supports ACID transactions for order/payment).
5. **Cache/Redis** — session, rate-limiting counters, public page/template rendering cache, analytics counters.
6. **Object Storage** — media (photos), accessed via CDN.
7. **Queue & Workers** — separates async processes (payment webhooks, image processing, email, expiry jobs) from the request-response cycle of the API.
8. **External Services** — payment gateway, email provider, maps, OAuth.

## Architectural Principles
- **Stateless API**: all state is in the DB/cache, making horizontal scaling easier.
- **Async for heavy/non-blocking operations**: image processing, notifications, webhook processing must not block user requests.
- **Cache-first for public pages**: because public traffic is read-heavy and spiky (see 06-CACHING-ARCHITECTURE.md).
- **Logical (not physical) multi-tenancy** at the application level — all tenants (invitations) share the same database, isolation is guaranteed at the query/authorization level (see SECURITY/05).
- **Generic template rendering**: one rendering engine, many template data configurations — no separate deployment per template.

## Non-Goals (MVP)
- Not using a full microservices architecture at MVP — a modular monolith (see 01-APPLICATION-ARCHITECTURE.md) is sufficient for the initial scale, with clear domain boundaries so it can be split later if needed.
