# Deploying to staging

The runbook for `https://app.vizunicum.my.id`, running on the VM at `10.1.200.13`.

There is no pipeline. `P0-17` is deferred (ADR-028) and the **deployment** half of its
definition of done was waived by the project owner on 2026-09-11, so this is a person
running commands. That is the accepted state, not an oversight — but it means the order
below matters, because nothing else is checking it.

---

## Before the first Phase 1 deploy

The stack that is running on the VM today is `P0-23`'s: Phase 0, no authentication, no
media pipeline. Phase 1 added three things that will stop it starting if they are skipped.

### 1. Two secrets, generated on the host

`JWT_SIGNING_KEY` and `REFRESH_TOKEN_PEPPER` became required in `P1-03` (ADR-047), at 32
characters, in every environment. The API validates its configuration at startup and
**exits 78** naming what is missing — so a deploy without them does not half-work, the
container restarts forever.

Generate them **on the VM**. They must not pass through a terminal anywhere else, a chat
transcript, or a commit:

```bash
cd ~/wedding-invitation                       # wherever the checkout lives
echo "JWT_SIGNING_KEY=$(openssl rand -base64 48)"      >> .env
echo "REFRESH_TOKEN_PEPPER=$(openssl rand -base64 48)" >> .env
chmod 600 .env
```

Neither rotates for free once users exist — `SECRETS.md` has the blast radius. On staging,
where the only accounts are test accounts, rotating is harmless.

### 2. The address the browser will use for the API

`API_PUBLIC_BASE_URL` is new and required. It is inlined into the `web-app` **browser
bundle** at build time, so it is a compose build argument: changing it means rebuilding
the image, not restarting the container.

```bash
echo 'API_PUBLIC_BASE_URL=https://app.vizunicum.my.id/api/v1' >> .env
```

It cannot be `http://api:3000` — a compose service name resolves inside the network and
means nothing in a browser. Before the tunnel routes `/api/*` (step 3), the VPN-reachable
`http://10.1.200.13:18000/api/v1` works and is the honest interim value.

### 3. The tunnel has to route the API

**This is the one step that is not in this repository.** `P0-23` deliberately did not
expose the API: there was no authenticated endpoint worth exposing before Phase 1. There
is now — every login, every editor save — and `app.vizunicum.my.id/api/*` currently
returns 404 from the catch-all.

The tunnel's ingress lives in Cloudflare (`config_src: cloudflare`), not here. In Zero
Trust → Networks → Tunnels → the tunnel → Public Hostnames, `app.vizunicum.my.id` needs a
path rule ahead of its catch-all:

| Hostname              | Path        | Service               |
| --------------------- | ----------- | --------------------- |
| `app.vizunicum.my.id` | `api/*`     | `http://api:3000`     |
| `app.vizunicum.my.id` | (catch-all) | `http://web-app:3100` |

**Use the compose service name.** Inside the `cloudflared` container `localhost` is
cloudflared itself — this was set to `http://localhost:3100` once and could not work.

Until this exists, the deployed application will render and every API call from the
browser will fail. That is worth knowing before concluding the build is broken.

---

## The deploy

```bash
cd ~/wedding-invitation
git pull --ff-only origin main
```

Then, from the repository root, with `.env` beside it:

```bash
COMPOSE="docker compose -f deploy/docker-compose.staging.yml --env-file .env"

# 1. Build. --profile migrate is not optional here: rebuilding `api` does NOT rebuild
#    `migrate`, and a stale migrator applies the schema the old code expected. That has
#    already cost one debugging session (P0-23).
$COMPOSE --profile migrate --profile seed build

# 2. Migrate, before anything serves traffic. Runs as the OWNER role, which the API
#    container does not have. Expand-contract (migrations/README.md) means this is safe
#    to run while the old containers are still up.
$COMPOSE --profile migrate run --rm migrate

# 3. Replace the running services.
$COMPOSE up -d

# 4. The tunnel, if it is not already running.
$COMPOSE --profile tunnel up -d
```

Phase 1 ships migrations `0000` through `0006`. A host that last deployed at `P0-23` has
`0000`–`0004`; `0005_unique_google_identity` and `0006_slug_blocklist` are what step 2
will apply.

### ClamAV costs about a gigabyte, once

`worker-media` **refuses to start** without a reachable scanner (`P1-18`), and
`MEDIA_SCAN_DISABLED` is rejected outright when `APP_ENV` is staging or production — an
unscanned upload that reached `ready` is the outcome that layer exists to prevent.

The first `up` therefore downloads the full signature database. Its healthcheck has a
300-second `start_period` for that reason, and `worker-media` waits on it, so the first
deploy after this change takes minutes rather than seconds. Nothing is wrong.

---

## Verifying

Check the containers first, then the behaviour. A green `ps` with a failing request is the
common outcome and each check below distinguishes a different cause.

```bash
$COMPOSE ps                     # every service Up; worker-media not restarting
$COMPOSE logs --tail=50 api     # "listening", not an exit-78 list of variables
curl -fsS http://localhost:18000/health     # {"status":"ok"}
curl -fsS http://localhost:18000/readyz     # database and redis reachable
```

From outside, over the tunnel:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://app.vizunicum.my.id/
curl -sS -o /dev/null -w '%{http_code}\n' https://invitation.vizunicum.my.id/demo-elegant-rose
curl -sS https://app.vizunicum.my.id/api/v1/health      # 404 means step 3 is not done
```

And the one that proves the browser bundle got the right API address — it should print the
public origin, not `localhost`:

```bash
curl -sS https://app.vizunicum.my.id/login | grep -o 'https://[a-z.]*/api/v1' | head -1
```

The accessibility suite can be pointed at the live host, which is how `P0-23` was verified:

```bash
E2E_WEB_APP_URL=https://app.vizunicum.my.id pnpm --filter @wi/e2e test:e2e
```

---

## Rolling back

The images are built from the checkout, so rollback is a checkout and a rebuild:

```bash
git log --oneline -5
git checkout <previous merge commit>
$COMPOSE --profile migrate build && $COMPOSE up -d
```

**Do not roll the database back as a matter of course.** `db:rollback` is development-only
and `migrations/README.md`'s expand-contract rule exists so that the previous application
version still runs against the newer schema. Reversing a migration to undo a deploy is the
step most likely to lose data; reverse it only when the migration itself is the fault.

---

## What this runbook does not cover

- **Anything automatic.** `P0-17`, backlog `DF-10`.
- **Synthetic monitoring.** Unblocked since `P0-23` — there is a public endpoint to probe —
  and still not done.
- **Production.** There is no production environment yet. `P3-11` is the single-VPS
  production topology and `P6-*` the launch checks.
- **Secret rotation with users on the system.** `SECRETS.md` has the blast radius per
  secret; on staging every account is a test account and this does not arise.
