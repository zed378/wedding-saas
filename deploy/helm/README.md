# `deploy/helm/`

The Kubernetes chart for the platform: the API, the three worker pools, and the ingress that separates the public invitation surface from the authenticated application.

**This is not the MVP deployment path.** ADR-015 runs the MVP on a single VPS with Docker Compose (`deploy/docker-compose.yml`), and that decision stands. The chart exists so the move to a cluster is a deployment change rather than a project — the day a single host stops being enough (risk **R14** in `docs/PLAN/18`), the topology is already written down and lints.

```
wedding-invitation/
├── Chart.yaml
├── values.yaml            defaults; nothing here is a secret
└── templates/
    ├── _helpers.tpl       naming, labels, image, security contexts, shared env
    ├── api-deployment.yaml
    ├── api-service.yaml
    ├── api-hpa.yaml
    ├── worker-deployment.yaml   one Deployment per pool
    ├── ingress.yaml
    └── NOTES.txt
```

## Using it

```bash
deploy/helm/verify.sh                       # everything checkable without a cluster
helm lint deploy/helm/wedding-invitation --set image.tag=0.1.0
helm template wi deploy/helm/wedding-invitation --set image.tag=0.1.0
helm upgrade --install wi deploy/helm/wedding-invitation \
  --namespace wedding --create-namespace \
  --set image.tag=0.1.0 \
  --values values.production.yaml     # not in this repo — see Secrets
```

**`helm lint` needs `--set image.tag`.** The chart has a required value, so a bare
`helm lint` fails — and unhelpfully: lint renders in a tolerant mode that downgrades the
guard rail to `[INFO] Fail` and then reports the resulting broken YAML as the error.
`helm template` shows the real message. `verify.sh` passes the value for you.

## Secrets are never values

The chart carries no credential and no `Secret` template. It reads them with `envFrom` from a Secret that already exists in the namespace (`secrets.existingSecret`, default `wedding-invitation-secrets`), created out of band by the secret store — `P0-18`, `docs/DEVOPS/00-ENVIRONMENTS.md`.

That is deliberate rather than incomplete. A chart that templates secrets from values puts every credential in whatever values file the deploy uses, which is the file people commit. Using `envFrom` also means adding a variable is a secret-store change, not a chart change and a redeploy.

## Three things the chart refuses to render

Rendering failures are the point: each of these is a configuration that would work fine on the day it was applied and hurt later.

**`image.tag` must be set.** No default, not `latest`, not `appVersion`. "Roll back to the previous image" is the entire recovery plan in `docs/DEVOPS/08-ROLLBACK.md`, and a moving tag makes that sentence meaningless — you cannot roll back to a tag that has since been overwritten.

```
Error: ... image.tag must be set to an immutable tag or digest. See docs/DEVOPS/08-ROLLBACK.md.
```

**`workers.pools.cron.replicaCount` must be 1.** A second cron instance runs every scheduled job twice. "Expire every invitation past its date" and "send the reminder email" are not safe to run concurrently without leader election (`docs/BACKEND/08-JOBS-WORKERS.md`), and the failure is silent — two emails to a real couple, not an error in a log.

```
Error: ... workers.pools.cron.replicaCount must be 1: a second instance runs every
scheduled job twice (docs/BACKEND/08). Add leader election before raising it.
```

The cron pool also deploys with `strategy: Recreate` for the same reason: a rolling update briefly runs two instances, which is the same hazard through a different door.

**A worker pool with no resource limits** is not refused by the chart, but it is not the default either. The media pool has hard CPU and memory caps because it processes hostile input — one crafted image must not be able to starve the rest of the cluster, which is layer 6 of `docs/SECURITY/06-FILE-UPLOAD-SECURITY.md`.

## The ingress splits two origins

The application host routes `/api`. The public invitation host routes **only** `/public` — same API, different origin.

That separation is ADR-024 and `docs/SECURITY/02`: guest-submitted content (RSVP messages, guestbook entries) renders on the public origin, and if one of them ever gets past sanitization, a same-origin script there must not be able to act against a logged-in dashboard session. Nothing authenticated is routed to the invitation host.

No wildcard certificate: one per host. Per-invitation subdomains are `P7-01`, and until then invitations are published by path.

## Readiness currently points at liveness

`api.probes.readiness` defaults to `/health`, which is a **liveness** probe — it touches no dependency, by design, because a readiness-style probe used for liveness restarts healthy pods during a database blip and turns one outage into two.

The consequence today is the other half of that trade: a pod that cannot reach PostgreSQL will still be sent traffic. `/readyz` arrives with `P0-13`; set `api.probes.readiness` to it then. `NOTES.txt` prints this after every install until the two values differ.

## What is not here yet

| Missing | Why | Owner |
|---|---|---|
| `NetworkPolicy` | Nothing to isolate until the workloads talk to each other | `P0-23` |
| `PodDisruptionBudget` | Meaningful once replicas are above one in a real cluster | `P0-23` |
| PostgreSQL / Redis | Managed services or their own operators, not subcharts — a database whose lifecycle is bound to the application release is a database you can delete with `helm uninstall` | — |
| Frontend surfaces | `web-app`, `public-invite` and `admin` are static/SSR bundles served from the CDN (ADR-013); only `admin` may later need a Deployment | `P0-22` |
| Kubernetes schema validation | Requires a reachable API server — see below | `P0-23` |

## What has actually been verified

Run `deploy/helm/verify.sh` — it is the list, executable. It lints, renders, counts the security posture across all four Deployments, checks that no moving tag or plaintext credential reached the output, asserts the invitation host exposes exactly one path, and triggers both guard rails to confirm they still fail the render. All twelve checks pass.

The origin check is a real one, not a formality: injecting a second path under the invitation host into the rendered output makes it report 2 and fail.

**Server-side schema validation has not been done.** `kubectl apply --dry-run=server` and even `--dry-run=client` need to reach a live API server to download the OpenAPI schema, and there is no cluster available here. So the manifests are known to be well-formed and to render what they claim; they are **not** known to be accepted by a real Kubernetes version. That check belongs to `P0-23`, when a cluster exists.
