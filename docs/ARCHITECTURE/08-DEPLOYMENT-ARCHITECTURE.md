# 08 - Deployment Architecture

## Topology (MVP)
```
Internet
   │
   ▼
CDN / Edge (static + public page cache + optional TLS termination here)
   │
   ▼
Reverse Proxy / Load Balancer (e.g., Nginx/Traefik or a managed LB)
   │  — routes based on Host header: wildcard subdomain, custom domain (Phase 2), admin subdomain
   ├──► Frontend App (containers, horizontal autoscale)
   ├──► Backend API (containers, horizontal autoscale, stateless)
   └──► Admin Panel (containers, separate/separate route)
              │
              ▼
   Worker(s) (containers, autoscale based on queue depth)
              │
   ┌──────────┼───────────────┐
   ▼          ▼                ▼
Postgres   Redis            Object Storage
(managed,  (managed)        (managed/S3-compatible)
primary +
backup)
```

## Containerization
- Every service (API, Frontend SSR, Worker, Admin) is containerized (see DEVOPS/02-CONTAINERIZATION.md) for consistency across dev/staging/production environments.

## Environments
- At least 3 environments: `development` (local), `staging` (pre-prod, dummy data, used for UAT), `production`. Details in DEVOPS/00-ENVIRONMENTS.md.

## Scaling Strategy
- Backend API & Worker: horizontal autoscale based on CPU/queue-depth metrics.
- Database: vertical scale initially, consider a read-replica in Phase 2 (ARCHITECTURE/04).
- Media processing (CPU-intensive) should ideally be in a separate worker pool from the email/notification worker so they don't starve each other's resources.

## TLS/SSL
- A wildcard certificate for `*.maindomain.com`.
- Custom domain (Phase 2): on-demand SSL provisioning per domain (see PLAN/10-DOMAIN-PUBLISHING.md).

## Zero-downtime Deployment
- Rolling deployment for API/Frontend (health-check before traffic is shifted).
- Database migrations run as a separate step before rolling out a new version, backward-compatible with the old version during the rolling period (expand-contract pattern for schema changes).

## Rollback
- See DEVOPS/08-ROLLBACK.md — every deploy must be rollback-able to the previous image/version within < 5 minutes.
