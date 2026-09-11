# P0-23 — Staging environment, hosts and TLS

| | |
|---|---|
| **Date** | 2026-09-11 |
| **Task** | `TASKS/PHASE-0-FOUNDATION.md` § P0-23 |
| **Phase** | Phase 0 |
| **Surface** | infra, backend, frontend |
| **Author** | Claude Code session |
| **Commits / PR** | `feat/P0-23-domain-and-vm-deploy`, `feat/P0-23-app-env`, then direct to `main` |
| **Status** | **Completed** — four of five DoD items met; the fifth **waived by the project owner** on 2026-09-11 |

---

## What Changed

The whole stack runs on a real host and is reachable from the public internet over HTTPS:

| | |
|---|---|
| `https://app.vizunicum.my.id` | the application |
| `https://invitation.vizunicum.my.id/{slug}` | public invitations |

Eleven services on the project owner's VM, migrated, seeded, and verified end to end — including the whole `P0-22` browser accessibility suite run against the live URL.

The host has a **private** address, so there is no inbound port and no certificate on it at all. A Cloudflare Tunnel dials out; Cloudflare terminates TLS at its edge.

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

- [x] **`invitation.vizunicum.my.id/{slug}` reaches public-invite over HTTPS with the slug available to the handler, and nothing else on that host reaches any other app.** Verified from outside: `/demo-elegant-rose` renders `data-slug="demo-elegant-rose"` and `/budi-dan-siti` renders `data-slug="budi-dan-siti"`, so the parameter reaches the handler rather than a static page. `ssl_verify_result=0` on every request.

  The host-isolation half was checked by trying to reach the *other* app through it. `invitation.../workbench` returns 200 — and that is correct: it is **public-invite** treating `workbench` as a slug (`data-slug="workbench"`, title *Undangan Pernikahan*), not the web-app. The control, `app.../workbench`, returns the real page (title *Workbench · Undangan Digital*, one `data-story` block). Two apps, two hostnames, no crossing.

  It is also a live demonstration of the collision hazard `docs/PLAN/10` § Route collision safety describes: every application route name is a valid slug on that host. `slug_blocklist` closes it and is `P5-13`'s.

- [x] **No wildcard DNS record or wildcard certificate.** Two explicit CNAMEs, both proxied, both pointing at the tunnel. The zone had zero records before this and has exactly two now.

- [x] **The application host is served separately from the public invitation host, with distinct cookie scopes.** Separate hostnames, separate origins, separate applications. The admin host follows at `P5-01`. The API is **not** routed through the tunnel at all — `app.../api/v1/_reference` hits the catch-all and returns 404 — so nothing reaches it from the internet yet; `P1` adds that route when there is an endpoint worth exposing.

- [x] **Staging carries no production data and no live payment credentials.** The database was created empty and seeded from `P0-21`'s curated data; one invitation exists and it is the demo. A live Midtrans key is now rejected at startup on staging, which it would not have been before ADR-043.

- [–] **A merge reaches staging without a manual step.** **WAIVED.** The project owner said on 2026-09-11 that automated deployment can be skipped for now. Deploying is therefore `git pull` plus a compose command, run by hand, and that is the accepted state rather than an oversight.

  **What the waiver does not cover.** `P0-17` is a CI *pipeline*, not just a deploy step, and Phase 0's exit criteria ask for more than deployment: "A push runs lint, type check, unit and integration tests, dependency audit and **SAST**." Only the deployment half was waived. Lint is still not wired anywhere (`P0-17`), and dependency auditing and SAST have never run — `scripts/verify.sh` says so in its own closing output. `scripts/verify.sh` and the eleven blocking git hooks are the compensating control and they do not cover those three. That gap is `P0-17`'s and it is still open.

  Step 6 (synthetic monitoring) is likewise not done. It is no longer *blocked* — there is a public endpoint to probe now — just not done.

**Verified against the live deployment**, not against localhost: the full `P0-22` workbench suite — 11 tests including per-story axe with colour contrast, the `<dialog>` focus-trap and inertness checks, and the security headers — ran against `https://app.vizunicum.my.id` and passed.

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

**7. A permission probe created a real tunnel.**

Checking whether `POST /cfd_tunnel` was permitted meant sending one. While it was denied that was harmless; the moment the permission was granted, the same probe **succeeded** and left a tunnel called `perm-probe` on the account. Deleted — it had zero connections and never ran — and the existing `mt-10.1.112.112` tunnel, which belongs to something else, was left alone.

The fix is to probe writes with a request that cannot succeed even when authorised: `PATCH /dns_records/00000000000000000000000000000000`. Auth is evaluated before the record lookup, so `Authentication error` means no permission and `Record does not exist` means permission granted — and nothing is created either way. That is how the later DNS checks were done.

**8. `nslookup` said NXDOMAIN while `curl` was already succeeding.**

Immediately after creating the records, `1.1.1.1` still served the cached negative answer while the system resolver had the new one — so the resolution check and the HTTPS check disagreed for about a minute. Neither was wrong. Worth knowing before concluding a record failed to create: poll the thing you actually care about, which is the request, not the lookup.

## Follow-Ups and Open Questions

- **`P0-17` is deferred**, so there is no pipeline. Deploying is `git pull` and a compose command, run by hand. That is the one unmet DoD item.
- **Synthetic monitoring** (step 6) is now unblocked — there is a public endpoint to probe — and not done.
- **The API is not routed through the tunnel.** Deliberate: there is no authenticated endpoint worth exposing before `P1`. When it is added, `app.vizunicum.my.id/api/*` gets an ingress rule and the CORS origins already name the right hostnames.
- **The tunnel ingress must use compose service names.** It was edited to `http://localhost:3100` at one point, which cannot work: inside the `cloudflared` container `localhost` is cloudflared itself, and the web app is a different container. Restored to `http://web-app:3100`. Anyone editing it in the Zero Trust dashboard needs to know this.
- **ClamAV is absent.** `docs/BACKEND/04` runs it only in the media pool and no upload path exists before `P1-16`; adding it now costs ~1.5 GB of signatures to scan nothing.
- **The `MODULE_TYPELESS_PACKAGE_JSON` warning appears on every seed run**, from `demo-account.ts` imported by an `.mts` script. Cosmetic, recorded in the `P0-21` record, still unfixed.

## What to Watch

**The host is shared with eight other compose projects.** `zedauth`, `callibrator`, `stocks`, `commercial2026`, `office`, `stirling`, `bentopdf` and `portainer` are on it. Ports 18000–18399 were free when this was allocated; `docker compose ls` before taking more. A `docker system prune` on that box would remove other people's images.

**`worker-media` has hard CPU and memory caps for that reason** — one crafted image must not starve the other seven projects.

**`.env` on the host is the only copy of the staging secrets.** It is not in any secret manager. If that VM is rebuilt, they are gone — which is survivable for staging and would not be for production.

**Every application route name is a valid invitation slug on the public host.** `invitation.../workbench` renders an invitation page for a slug called "workbench" today. Harmless while nothing is published under those names, and it is the exact failure `slug_blocklist` exists to prevent — `P5-13`.

**The tunnel's ingress lives in Cloudflare, not in the repository.** `config_src: cloudflare` means the routing is editable in the dashboard by anyone with access, and the file in this repo does not describe it. That is what let it be changed to `localhost` without any commit.

**The seeded demo has six media rows and no image bytes.** The page will show broken images until `P1-16`. That is written in `demo-invitation.json`, but it will still look like a bug to whoever opens it first.
