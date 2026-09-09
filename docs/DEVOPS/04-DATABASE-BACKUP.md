# 04 - Database Backup

## Strategy
- **Automated daily full backup** (snapshot), a 30-day rolling retention.
- **Continuous WAL archiving** for Point-in-Time Recovery (PITR) — allows restoring to a specific second, not just a daily snapshot point (an RPO close to 0, aligned with ARCHITECTURE/09-DISASTER-RECOVERY.md).
- Backups are stored in storage separate from the primary DB (a different region/account if possible).

## Encrypted Backups
- Backup files are encrypted at rest (either via the managed DB provider's built-in feature or additional encryption) — given they contain fully sensitive data (SECURITY/09).

## Backup Verification (Mandatory, Not Assumed)
- A periodic automated job (e.g., weekly) performs a **test restore** to a temporary instance & runs basic validation queries (row counts of key tables aren't zero, no corruption) — a backup that has never had its restore tested is a hidden risk.

## Retention
- Daily backups: 30 days.
- Weekly backup (long-term): 6 months.
- Monthly backup: 1 year (for long-term audit/compliance needs).

## Object Storage Backup
- Even though provider durability is high, enable **bucket versioning** for `user-media` — protecting against accidental deletion (an application bug that mass-deletes files, human error).

## Restore Runbook
- See ARCHITECTURE/09-DISASTER-RECOVERY.md § Restore Runbook for detailed steps.

## Backup Monitoring
- Automatic alerting if a backup job fails/doesn't run on schedule (DEVOPS/07-ALERTING.md) — a silent backup failure is one of the most dangerous operational risks.
