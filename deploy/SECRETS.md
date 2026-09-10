# Secrets

Every secret this system needs, where it lives per environment, who rotates it, and what breaks while it is being rotated.

The last column is the one that matters. A rotation runbook without a blast radius tells you how to turn the key but not whether you can do it at 3pm on a Friday.

## The rule

`docs/DEVOPS/00`: staging and production values live in a secret manager and are **never** committed. `scripts/check-secrets.mjs` enforces that on every commit through `.githooks/pre-commit`.

The values in `deploy/docker-compose.yml` and `.env.example` are local-development credentials, deliberately committed so the stack starts with one command. They are not secrets and must never be used anywhere else.

## Where they live

| Environment   | Store                                            | Why                                                                       |
| ------------- | ------------------------------------------------ | ------------------------------------------------------------------------- |
| `development` | `.env`, git-ignored, seeded from `.env.example`  | Nothing here is real                                                      |
| `staging`     | Secret manager, staging scope (ADR-034)          | Separate scope so a staging value cannot be read from production and back |
| `production`  | Secret manager, production scope, access audited | `docs/DEVOPS/00` § Access Control                                         |

**Scopes are separate stores, not folders in one store.** A single store with a naming convention makes a cross-environment read a typo away, and the typo that matters is reading production credentials into staging.

## The inventory

| Secret                                                | Needed by              | Rotation                                                                                          | Blast radius while rotating                                                                                                                                                                                                                                  |
| ----------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`                                        | API, worker            | Change the role's password, update the secret, restart. Old connections survive until they close. | Brief connection errors on new connections only. Migrations use a **different** role (`MIGRATION_DATABASE_URL`), so a rotation of one does not block the other.                                                                                              |
| `MIGRATION_DATABASE_URL`                              | Migration command only | As above                                                                                          | None at runtime — nothing holds it open. A rotation mid-deploy fails the migration step, which stops the deploy rather than half-applying it.                                                                                                                |
| `REDIS_URL`                                           | API, worker            | Rotate the password, update, restart.                                                             | **Cache and rate-limit state are lost** (both share this Redis, ADR-009). Rate limits reset to empty, which briefly widens the window `docs/SECURITY/10` closes. Queued jobs survive — Redis persists with `appendonly yes`.                                 |
| `JWT_SIGNING_KEY`                                     | API                    | **Every access token signed with the old key becomes invalid.**                                   | Every logged-in user is signed out. Access tokens are 15 minutes (`docs/SECURITY/03`), so a dual-key window — accept old, sign new, retire after 15 minutes — avoids that entirely and is the way to do this without an outage.                              |
| `REFRESH_TOKEN_PEPPER`                                | API                    | **Cannot be rotated without invalidating every refresh token.**                                   | Every session ends; every user logs in again. `refresh_tokens.token_hash` is peppered, so old hashes stop matching. Rotate only in response to a compromise, and expect the support load.                                                                    |
| `MIDTRANS_SERVER_KEY`                                 | API                    | From the Midtrans dashboard, then update the secret.                                              | In-flight checkouts fail. **Webhooks signed with the old key stop verifying** — `signature_valid` goes false and payments stop being confirmed while looking like forgeries. Rotate during low traffic and watch `docs/DEVOPS/07`'s invalid-signature alert. |
| `MIDTRANS_CLIENT_KEY`                                 | web-app (public-ish)   | As above                                                                                          | Checkout page cannot open the Snap dialog until deployed.                                                                                                                                                                                                    |
| `MIDTRANS_WEBHOOK_SECRET`                             | API                    | As above                                                                                          | Same as the server key: incoming webhooks fail verification until updated. Failed ones are **recorded** with `signature_valid = false` (`P0-10`), so nothing is lost — but nothing is confirmed either.                                                      |
| `STORAGE_ACCESS_KEY_ID` / `STORAGE_SECRET_ACCESS_KEY` | API, worker            | Create a second key, deploy, delete the first.                                                    | None if done in that order. Deleting first breaks every upload and every variant write mid-flight.                                                                                                                                                           |
| `RESEND_API_KEY`                                      | worker                 | Create new, deploy, revoke old.                                                                   | Email sending fails between revoke and deploy. `notification.send` retries three times then dead-letters (`P0-15`), so mail is delayed rather than lost — provided the DLQ is drained.                                                                       |
| `TURNSTILE_SECRET_KEY`                                | API                    | Rotate in the Cloudflare dashboard.                                                               | CAPTCHA verification fails, which **fails closed** — guests cannot submit RSVPs. Short window; do it deliberately.                                                                                                                                           |
| `MAPS_API_KEY`                                        | web-app editor         | Rotate in the provider console.                                                                   | The editor's map picker fails to load. Public invitations are unaffected — they use a static image and a deep link, not a map SDK (ADR-014).                                                                                                                 |

## The environment split is enforced, not documented

`backend/api/src/config/secret-rules.ts` refuses to start when the configuration mixes environments:

- A **live** Midtrans key (no `SB-` prefix) outside production. A live key on staging charges real cards from a test run.
- A **sandbox** key in production. Every payment would succeed against the provider's test environment and no money would arrive — nothing errors, the orders just look paid.
- A `JWT_SIGNING_KEY` under 32 characters in production.
- A non-`https://` origin in production.
- A `localhost` database in production.

Exit code 78 (`EX_CONFIG`), the same as any other configuration failure, naming every violation at once.

## If a secret leaks

1. **Rotate first, investigate second.** The blast-radius column above tells you what breaks; none of it is worse than the leak.
2. Assume anything written to a shared repository is compromised, even in a deleted commit. Git history is not a delete.
3. `payments.raw_callback_payload` retains provider payloads (ADR-025) so a signature can be re-verified during an investigation — that is the record to check for a payment-key compromise.
4. `audit_logs` is append-only (`P0-10`), so an attacker with application access cannot erase what they did.
