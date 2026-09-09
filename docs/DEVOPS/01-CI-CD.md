# 01 - CI/CD

## Pipeline (per Pull Request)
```
1. Lint & format check (fail fast)
2. Unit test (backend + frontend)
3. Type check (TypeScript)
4. Build (verify the build succeeds without errors)
5. Integration test (with a DB testcontainer)
6. Security scan (dependency audit, SAST — SECURITY/11)
7. (if everything passes) → allow merging, requires at least 1 reviewer's approval
```

## Pipeline (Deploy to Staging — automatic on every merge to `main`/`develop`)
```
1. Build the image/artifact
2. Run the database migration (staging)
3. Deploy to the staging environment (rolling)
4. Run the E2E test suite against staging
5. Notify the team (Slack/email) of the deploy result
```

## Pipeline (Deploy to Production — manual trigger/approval, from a release branch/tag)
```
1. Approval from the Engineering Lead (a manual gate)
2. Database backup (a safety net before any destructive migration)
3. Run the database migration (an expand-contract pattern for breaking changes — ARCHITECTURE/08)
4. Rolling deploy with a health-check before full traffic is shifted
5. Automated post-deploy smoke test (key endpoints: health check, login, get the template catalog)
6. Heightened monitoring (an error-rate dashboard) for 30-60 minutes post-deploy
7. If an anomaly is detected: trigger a rollback (08-ROLLBACK.md)
```

## Branch Strategy
- `main` = production-ready, `develop`/a feature branch for active development, a PR review is mandatory before merging into `main`.

## Secrets in CI/CD
- All secrets (DB credentials, payment API keys, the JWT secret) are stored in the CI/CD secret manager (not hard-coded in the pipeline config), scoped per environment.

## Artifact Versioning
- Every production build is tagged with a version/commit SHA — making it easy to roll back to a specific image (08-ROLLBACK.md).
