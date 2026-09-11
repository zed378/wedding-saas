# P0-23 (partial) — Staging deployed; hostnames and TLS still blocked

| | |
|---|---|
| **Date** | 2026-09-11 |
| **Task** | `TASKS/PHASE-0-FOUNDATION.md` § P0-23 |
| **Phase** | Phase 0 |
| **Surface** | infra, backend, frontend |
| **Author** | Claude Code session |
| **Commits / PR** | `feat/P0-23-domain-and-vm-deploy`, `feat/P0-23-app-env`, then direct to `main` |
| **Status** | **Partial** — the environment runs and is verified; DoD items 1–3 are not met |

---

## What Changed

The whole stack runs on a real host. Ten services, migrated, seeded, and verified end to end — reachable over the VPN by port.

What it is **not** yet: reachable by hostname, over TLS. That is DoD items 1, 2 and 3, and it is blocked on a Cloudflare permission. The task stays open.

## Why This Is Written Up Before The Task Is Done

Three decisions were made and two real bugs were found. A record written only on completion would lose them, and the task cannot complete without someone else granting a permission.

## How

**The domain changed** (ADR-042). `zedth.my.id` became `vizunicum.my.id`. Verified rather than assumed: the zone is active on Cloudflare nameservers, and all three hostnames were **NXDOMAIN** — so `docs/PLAN/10`'s "exists today" was corrected, because on the new domain nothing is in service.

**`APP_ENV` split from `NODE_ENV`** (ADR-043). Deploying staging forced it: `docs/DEVOPS/00` § Parity wants staging to run what production runs (`NODE_ENV=production`), while § Environment List wants it seeded and on sandbox payment credentials. One variable cannot say both. The visible symptom was `db:seed` refusing to run on the one deployed environment that is supposed to be seeded; the quiet one was that `secret-rules.ts` would have accepted a **live Midtrans key** on staging, which is the single check that file exists for.

**The staging stack is a variant, not a replacement.** Every secret from the environment with `${VAR:?required}`; only the four application ports published; PostgreSQL, Redis and MinIO publish nothing at all.

**Migrations got their own image.** The runtime image cannot run them — `pnpm deploy --prod` leaves it with `dist/` and production dependencies, while `migrate.mts` runs from source. A `migrator` target is the build stage with an entrypoint. It is separate from the runtime image deliberately: the thing that can alter the schema should not be the thing serving traffic, and one image doing both would put `MIGRATION_DATABASE_URL` in the process handling requests.

**Secrets were generated on the host.** `openssl rand` into `.env`, mode 600, git-ignored. No staging password has ever been typed into a terminal elsewhere or passed through a chat transcript.

## Files and Components Touched

| Path | Change |
|---|---|
| 37 files outside `MEMORY/` | `zedth.my.id` → `vizunicum.my.id` |
| `MEMORY/DECISIONS.md` | ADR-042, ADR-043; ADR-024 gains a forward pointer |
| `docs/PLAN/10` | Hostname provenance; "exists today" corrected |
| `backend/api/src/config/env.schema.ts` | `APP_ENV`, defaulting to `NODE_ENV` |
| `backend/api/src/config/secret-rules.ts` | Every environment decision reads `APP_ENV` |
| `backend/api/src/infra/db/seed.mts` | Guard keys on the deployment, not the build |
| `backend/api/Dockerfile` | **New `migrator` target** |
| `frontend/{web-app,public-invite}/Dockerfile`, `admin/Dockerfile` | **New** — the three frontends had none |
| `frontend/*/next.config.ts` | `output: "standalone"`, workspace tracing root |
| `admin/nginx.conf` | **New** — static serving, `noindex`, security headers |
| `deploy/docker-compose.staging.yml` | **New** — the deployed topology |
| `deploy/staging.env.example` | **New** |
| `deploy/postgres/init/01-app-role.sql` → `.sh` | Password from the environment |
| `.env.example`, `deploy/docker-compose.yml` | Origins aligned to the ports `P0-22` gave the surfaces |

## Decisions Made

| Decision | Rationale | ADR |
|---|---|---|
| `vizunicum.my.id` replaces `zedth.my.id` | Project owner's domain; verified active, records absent | ADR-042 |
| ADR-024 keeps its text, gains a pointer | An ADR edited to match the present erases that the decision changed | ADR-042 |
| `APP_ENV` for the deployment, `NODE_ENV` for the build | Staging is a production build in a non-production environment | ADR-043 |
| Migrations in their own image | Schema authority separated from request handling | — |
| Cloudflare Tunnel, not Caddy + Let's Encrypt | Private origin; ACME HTTP-01 cannot reach it, and a permanently failing renewal trains people to ignore logs | — |
| Ports 18000–18399 | The host runs eight other compose projects | — |

## Deviations from `docs/`

`docs/PLAN/10` § Hostnames amended — the domain named, provenance recorded, and "exists today" corrected. Both amendments are in ADR-042.

## Tests Added

Five, in `backend/api/test/secret-rules.spec.ts`, all about the new axis:

| Case | Why it matters |
|---|---|
| `APP_ENV` defaults to `NODE_ENV` | Development and test need no new variable |
| Staging is a production build, not a production environment | The whole point of the split |
| **Refuses a live payment key on staging** | Fails against the old code — the hole this closed |
| Still accepts a sandbox key on staging | Otherwise the rule would just block everything |
| Rejects an `APP_ENV` outside the four documented names | `docs/DEVOPS/00` § Environment List |

API unit total: 91 → 96. Nothing else changed.

## Security Verification

| Control | Requirement | How it was verified |
|---|---|---|
| A live payment key cannot be used on staging | `docs/DEVOPS/00` § Configuration | "refuses a live payment key on staging" — a new test that **fails against the previous code** |
| The application role cannot alter schema | `backend/api/migrations/README.md` | Two URLs, two roles; `MIGRATION_DATABASE_URL` exists only in the `migrate` and `seed` services, verified by reading the running container's environment |
| The database is not reachable from the host | — | `docker compose ps` shows `postgres 5432/tcp` with no published mapping; same for Redis and MinIO |
| Staging carries no production data | `docs/DEVOPS/00` § Data | The database was created empty and seeded from `P0-21`'s curated data. One invitation exists and it is the demo |
| The demo is not indexed | `docs/UI-UX/11` | `select slug, status, seo_indexable` → `demo-elegant-rose | published | f` |
| Secrets never entered the repository or the transcript | `docs/DEVOPS/00` | Generated on the host with `openssl rand`; `.env` is mode 600 and git-ignored, confirmed with `git check-ignore` |
| No credential reached a commit | — | `scripts/check-secrets.mjs` **refused the first commit** — see below |

## Abuse Cases Covered

- **A live payment key configured on staging charges a real card from a test.** Now rejected at startup, exit 78.
- **A published database port on a shared host.** Nothing is published; the eight other projects on this box cannot reach it and neither can anything else.
- **Seed data written to production.** The guard keys on `APP_ENV`, and the second guard still requires a local-looking database host.

## DoD Verification

- [ ] **`invitation.vizunicum.my.id/{slug}` reaches public-invite over HTTPS.** **Not met.** Blocked — see below.
- [x] **No wildcard DNS record or wildcard certificate exists.** The zone has **zero** records.
- [ ] **The application host is served separately from the public host with distinct cookie scopes.** The two apps are separate and on separate ports; without hostnames there are no cookie scopes to be distinct yet.
- [x] **Staging carries no production data and no live payment credentials.** Verified above.
- [ ] **A merge reaches staging without a manual step.** Not met, and not blocked by this task: `P0-17` is deferred (ADR-028), so deploys are `git pull` plus a compose command.

## What Did Not Work

**1. The secret scanner refused my first commit, correctly.**

`deploy/staging.env.example` used `CHANGE_ME_owner` in a DSN. The scanner's placeholder allowance matches `changeme` on a word boundary, and `CHANGE_ME_owner` does not. **The commit did not happen, but the `git push` in the same command did** — pushing the *previous* commit. That is precisely the failure mode an earlier record warned about, and it is why the push output has to be read rather than assumed.

**2. Compose interpolates services behind inactive profiles.**

`${CLOUDFLARE_TUNNEL_TOKEN:?required}` on the profiled `cloudflared` service broke `up` for the **whole stack** whenever the tunnel was not in use — which is most of the time. Found by deploying: an `up` that had worked five minutes earlier stopped working the moment the tunnel service existed. Changed to `:-`.

**3. `run --rm migrate node src/infra/db/seed.mts` runs `node node …`.**

The migrator's `ENTRYPOINT` is already `node`. `MODULE_NOT_FOUND`, pointing at nothing useful. Fixed by adding a named `seed` service so the mistake is not available.

**4. Rebuilding `api` does not rebuild `migrate`.**

The seed kept refusing with the *old* message after the `APP_ENV` fix, because the migrator image predated it. The message was the tell — it named `NODE_ENV`, which the new code does not.

**5. The `minio-init` buckets were wrong.**

It created `media` and `templates`; `env.schema.ts` defaults to `user-media` and `template-assets`, which is also what `docs/ARCHITECTURE/05` specifies. A bucket the application does not look for stays empty forever while every upload fails with `NoSuchBucket`. Caught by comparing against the dev compose before deploying, not by anything automatic.

**6. I generalised a permission result and was wrong.**

`/accounts/{id}` returned 403, and I reported that account-scoped endpoints were unavailable. The **tunnel** endpoints under the same account were 200. Corrected by probing each endpoint and each method separately rather than inferring a scope from one sample.

## Follow-Ups and Open Questions

- **Blocked on `Account → Cloudflare Tunnel → Edit`.** The token now has `Zone:DNS:Edit` (added mid-session) and `Cloudflare Tunnel:Read`, but tunnel **create** is denied. Either that permission, or a tunnel created in the Zero Trust dashboard and its **run token** handed over — the run token is the better credential, since it can join one tunnel and do nothing else.
- **`P0-17` is deferred**, so there is no pipeline. Deploying is `git pull` and a compose command, run by hand.
- **No synthetic monitoring** (step 6). It needs a public endpoint to probe.
- **ClamAV is absent.** `docs/BACKEND/04` runs it only in the media pool and no upload path exists before `P1-16`; adding it now costs ~1.5 GB of signatures to scan nothing.
- **The `MODULE_TYPELESS_PACKAGE_JSON` warning appears on every seed run**, from `demo-account.ts` imported by an `.mts` script. Cosmetic, recorded in the `P0-21` record, still unfixed.

## What to Watch

**The host is shared with eight other compose projects.** `zedauth`, `callibrator`, `stocks`, `commercial2026`, `office`, `stirling`, `bentopdf` and `portainer` are on it. Ports 18000–18399 were free when this was allocated; `docker compose ls` before taking more. A `docker system prune` on that box would remove other people's images.

**`worker-media` has hard CPU and memory caps for that reason** — one crafted image must not starve the other seven projects.

**`.env` on the host is the only copy of the staging secrets.** It is not in any secret manager. If that VM is rebuilt, they are gone — which is survivable for staging and would not be for production.

**The seeded demo has six media rows and no image bytes.** The page will show broken images until `P1-16`. That is written in `demo-invitation.json`, but it will still look like a bug to whoever opens it first.
