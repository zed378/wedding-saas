# 11 - Table: invitation_view_counts

Backs the page-view counter in PLAN/14-ANALYTICS.md and the `POST /public/i/:slug/view` endpoint in API/08-PUBLIC-INVITATION-API.md.

```sql
CREATE TABLE invitation_view_counts (
  invitation_id       UUID NOT NULL REFERENCES invitations(id) ON DELETE CASCADE,
  view_date           DATE NOT NULL,
  view_count          BIGINT NOT NULL DEFAULT 0,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (invitation_id, view_date)
);
CREATE INDEX idx_view_counts_invitation ON invitation_view_counts(invitation_id);
```

## Why Daily Grain

A single lifetime counter answers "how many people opened it" and nothing else. A daily row answers the question owners actually ask in the week before the wedding — "is anyone opening the link I sent yesterday" — for the cost of one row per invitation per day, and it lets an expired invitation's history be summarized and pruned without losing the total.

## Write Path (PLAN/14 § Implementation Summary)

A page view **never writes to this table synchronously**. The public page request increments a Redis counter; a scheduled job (`analytics_counter_flush`, every minute — BACKEND/08-JOBS-WORKERS.md) folds the accumulated counters into this table with an upsert:

```sql
INSERT INTO invitation_view_counts (invitation_id, view_date, view_count)
VALUES ($1, $2, $3)
ON CONFLICT (invitation_id, view_date)
DO UPDATE SET view_count = invitation_view_counts.view_count + EXCLUDED.view_count,
              updated_at = now();
```

This is the traffic pattern the whole caching architecture exists for (ARCHITECTURE/06): hundreds of guests opening the same link within minutes. A row-per-view write on the primary database during that spike is the failure mode being avoided.

The flush is explicitly **best-effort** (ARCHITECTURE/07 § Job Types): losing a batch on failure is acceptable for an aggregate vanity metric, and that trade is deliberate rather than accidental.

## Privacy

No per-visitor data is stored — no identifier, no IP, no user agent, no referrer. PLAN/14 § Privacy and SECURITY/09-PRIVACY-DATA-PROTECTION.md both scope MVP analytics to aggregates: the RSVP and guestbook are data a guest consciously provided, and a page view is not.

Richer analytics (unique visitors via hashed IP+UA, referrer, device breakdown) is Phase 2 (PLAN/14 § Phase 2), and adding it requires updating the privacy policy before, not after.

## Retention

Rows follow their invitation: `ON DELETE CASCADE` removes them when an invitation is hard-deleted at the end of the BR-9 retention chain. Daily rows older than 12 months may be collapsed into a monthly total by a maintenance job; nothing depends on day-level history beyond a season.
