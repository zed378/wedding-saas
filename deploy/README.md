# `deploy/`

Everything needed to run this system: the local stack, and the charts that will run it on a cluster.

| Path                         | What it is                                               |
| ---------------------------- | -------------------------------------------------------- |
| `docker-compose.yml`         | The local development stack (`P0-05`)                    |
| `docker-compose.staging.yml` | The deployed staging topology (`P0-23`)                  |
| `STAGING-DEPLOY.md`          | **How to deploy.** Read it before touching the VM        |
| `staging.env.example`        | Every variable staging needs, and where to generate it   |
| `SECRETS.md`                 | The secret inventory, rotation and blast radius          |
| `postgres/init/`             | First-run SQL: creates the unprivileged application role |
| `helm/`                      | Kubernetes charts (`P0-26`)                              |

The origin reverse proxy (Caddy) and the single-VPS production topology are `P0-23` and `P3-11`.

## Local stack

```bash
docker compose -f deploy/docker-compose.yml up -d
```

Brings up PostgreSQL, Redis, MinIO, Mailpit and the API. The API waits for PostgreSQL and Redis to report **healthy**, not merely started — `service_started` would race the first query against a database still running its init scripts.

```bash
docker compose -f deploy/docker-compose.yml --profile media up -d   # adds ClamAV
docker compose -f deploy/docker-compose.yml logs -f api
docker compose -f deploy/docker-compose.yml down                    # -v also discards data
```

ClamAV sits behind a profile because it downloads a signature database on first start and holds around a gigabyte of memory. Nothing needs it before `P1-18`, and a stack that is slow to start is a stack people stop starting.

### Ports

| Service       | Default | Override             |
| ------------- | ------- | -------------------- |
| API           | 3000    | `API_PORT`           |
| PostgreSQL    | 5432    | `POSTGRES_PORT`      |
| Redis         | 6379    | `REDIS_PORT`         |
| MinIO S3      | 9000    | `MINIO_PORT`         |
| MinIO console | 9001    | `MINIO_CONSOLE_PORT` |
| Mailpit SMTP  | 1025    | `MAILPIT_SMTP_PORT`  |
| Mailpit UI    | 8025    | `MAILPIT_UI_PORT`    |
| ClamAV        | 3310    | `CLAMAV_PORT`        |

Only the host side moves; container ports are fixed. A hardcoded host port turns "something else is already using 6379" into "the stack will not start", which is the opposite of what this file is for:

```bash
REDIS_PORT=56379 MAILPIT_SMTP_PORT=52025 docker compose -f deploy/docker-compose.yml up -d
```

### Credentials

The values in `docker-compose.yml` are local-development credentials, deliberately committed so the stack starts with one command. **They are not secrets and must never be used anywhere else.** Staging and production read theirs from the secret store (`P0-18`, `docs/DEVOPS/00-ENVIRONMENTS.md`). Any real `.env` is git-ignored and stays that way.

### Two things the stack does on purpose

**The application connects as a role that does not own its tables**, with neither `SUPERUSER` nor `BYPASSRLS` (`postgres/init/01-app-role.sh`). This matters before there is anything to protect: the moment row-level policies exist, a superuser or table-owner connection would bypass every one of them and no test would fail. The migration role and the application role are separate for the same reason.

**Both object storage buckets are created private** (`user-media`, `template-assets`, per `docs/ARCHITECTURE/05`). Public reads only ever go through a CDN with origin access control — a bucket readable directly by URL makes every uploaded photo enumerable, which is exactly what `docs/SECURITY/06` § Storage isolation is guarding against. Verified: an unauthenticated `GET` against either bucket returns 403.

## Images

Tags are pinned rather than `latest`. A moving tag means the stack can change under you between two runs, which is the "works on my machine" variable this directory exists to remove (`docs/DEVOPS/02`, supply chain).

## Building the API image

```bash
docker build -f backend/api/Dockerfile -t wi-api .
```

**From the repository root**, because the build needs the workspace. Two details that cost time when they are wrong:

- `.dockerignore` must live at the root of the build context, not beside the `Dockerfile`. A copy next to the Dockerfile is silently ignored, and the symptom is host `node_modules` landing in the image and overwriting the symlink farm pnpm created inside it.
- `pnpm deploy --legacy` produces the self-contained runtime bundle. Without `--legacy`, pnpm 10+ requires `inject-workspace-packages=true` on the workspace, which would copy workspace packages into their consumers during ordinary local installs too — trading a stale-copy failure mode in development for a flag here.

The runtime image runs as the unprivileged `node` user and carries no package manager, no source and no dev dependencies.
