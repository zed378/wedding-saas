# 08 - Rollback

## Principle
- Every production deploy must be rollback-able to the previous version within < 5 minutes (not explicitly stated in PLAN/17 but aligned with the product's availability targets).

## Application (Code) Rollback
```
1. Identify the last known-stable image/version (a tag/commit SHA from a previous release, per DEVOPS/01-CI-CD.md artifact versioning).
2. Trigger a deploy of that version's image (the same process as a normal deploy, just in reverse).
3. Verify the health-check & smoke test after the rollback completes.
4. Notify the team + log a brief incident note (what caused the rollback).
```

## Database Migration Rollback
- A destructive migration (dropping a column/table) MUST NOT be run at the same time as the code deploy that stops using it — use the **expand-contract pattern**:
```
Phase 1 (Expand): Add the new column/table, the deployed code supports BOTH THE OLD AND NEW schema simultaneously.
Phase 2: Migrate data if needed (a background job).
Phase 3: Deploy code that fully moves to the new schema.
Phase 4 (Contract): After being confident it's stable (e.g., a few days with no issues), only then remove the old column/table in a separate migration.
```
With this pattern, a CODE rollback (from phase 3 → the previous version) remains safe because the old schema hasn't been dropped yet (still in the expand phase).

## Rollback vs. Roll-Forward
- A critical bug with wide impact & no trivial fix → roll back immediately, investigate calmly once stable.
- A minor/specific bug with a quick fix available → roll forward (deploy the fix) is preferred over rolling back (avoiding losing other unrelated correct changes).

## Feature Flags as a Rollback Alternative
- A risky new feature should ideally sit behind a feature flag — "rolling back" is as simple as turning off the flag, without needing a full deployment rollback, much faster & safer.

## Post-Rollback Documentation
- Every production rollback is logged (when, why, impact) as part of continuous improvement, linked to the Incident Response process if relevant (SECURITY/12).
