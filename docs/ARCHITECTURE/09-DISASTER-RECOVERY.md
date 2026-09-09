# 09 - Disaster Recovery

## Targets
- **RPO (Recovery Point Objective)**: maximum 24 hours of data loss (ideal target of 1 hour for the transactional DB with continuous backup/WAL archiving).
- **RTO (Recovery Time Objective)**: maximum 4 hours for full service recovery after a major incident.

## Backup
- **Database**: automated daily full backup + continuous WAL archiving (point-in-time recovery) — see DEVOPS/04-DATABASE-BACKUP.md. Minimum 30-day retention.
- **Object Storage**: built-in provider durability + cross-region replication for `user-media` (data that cannot be recreated if lost, unlike a cache/render that can be regenerated).
- Backups are stored in a region/account different from the primary to avoid a single point of failure at the cloud-account level.

## Scenarios & Mitigation
| Scenario | Mitigation |
|---|---|
| Database corrupted/lost | Restore from the latest backup + replay WAL up to the point right before the incident |
| Cloud region outage | (Phase 2) Multi-region failover; MVP: manual runbook documentation for migrating to a backup region |
| Object storage bucket accidentally deleted | Bucket versioning enabled + cross-region replica |
| Bad deploy corrupts data (migration bug) | Expand-contract migrations, backup before any destructive migration, rollback plan (DEVOPS/08) |
| Payment gateway down | Graceful degradation: show a "try again later" status, don't change invitation status, job retries the webhook |
| Security incident (breach) | See SECURITY/12-INCIDENT-RESPONSE.md |

## Restore Runbook (summary)
1. Identify the last known-good data point in time.
2. Provision a new DB instance from the nearest backup snapshot.
3. Replay WAL up to the target point (if PITR is available).
4. Validate critical data integrity (user, invitation, order counts are not anomalous).
5. Redirect the application's connection to the new instance (update connection string/DNS).
6. Verify the application runs normally, monitoring active.
7. A post-mortem is mandatory (see SECURITY/12-INCIDENT-RESPONSE.md).

## DR Testing
- A restore drill is mandatory at least once before the MVP launch, and periodically thereafter (e.g., quarterly) — results documented (ref in 17-ACCEPTANCE-CRITERIA.md).
