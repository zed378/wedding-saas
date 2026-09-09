# 00 - Environments

## Environment List
| Environment | Purpose | Data | Access |
|---|---|---|---|
| `development` | Local developer work | Dummy/seed, per-developer (local docker-compose) | Developer |
| `staging` | UAT, QA, internal demos, payment sandbox integration testing | Realistic dummy data, periodically reset | Internal team (VPN/basic auth) |
| `production` | The live service for users | Real data | Public (the user-facing application), restricted (admin panel) |

## Configuration per Environment
- Separate environment variables per environment (`.env.development`, managed via a secret manager for staging/production — NEVER committed to the repo).
- Payment gateway: `staging` uses the provider's sandbox/test mode; `production` uses live credentials (stored in a secret manager, access restricted).
- Feature flags: allow new features to be tested on staging/a subset of production before a full rollout.

## Parity
- `staging` is kept as close as possible to `production` (dependency versions, service topology) to minimize "works on staging, fails on production" bugs — the difference should only be resource/data scale.

## Data Refresh
- `staging` data is refreshed/reset periodically (e.g., weekly) from curated seed data (NOT a raw copy of production data — avoiding leaking real user data into a non-production environment, aligned with SECURITY/09).

## Access Control
- `production` databases & storage are NOT directly accessible from an individual developer's local machine — access goes through a bastion/VPN with auditing, or a read-only replica for debugging purposes if truly necessary.
