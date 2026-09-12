# 10 - Table: audit_logs

```sql
CREATE TABLE audit_logs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id              UUID NOT NULL REFERENCES users(id),
  action                  VARCHAR(60) NOT NULL,          -- 'user.suspend' | 'order.refund' | 'template.publish' | 'guestbook.moderate' etc.
  resource_type              VARCHAR(40) NOT NULL,          -- 'user' | 'order' | 'template' | 'guestbook_entry'
  resource_id                   UUID NOT NULL,
  reason                           TEXT,
  before_state                       JSONB,
  after_state                          JSONB,
  ip_address                              INET,
  created_at                                TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_admin ON audit_logs(admin_id);
CREATE INDEX idx_audit_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX idx_audit_created ON audit_logs(created_at);
```

## Policy
- Rows in `audit_logs` are **append-only** — there are no UPDATE/DELETE operations from the application (protected at the DB user permission level where possible).
- Every admin endpoint that modifies data (see API/09-ADMIN-API.md) MUST write an entry here before/within the same transaction as the data change.
- **`admin_id` is the acting user, which is an admin for admin endpoints and the resource's *owner* for owner-sensitive resources** (ADR-053, added by `P1-13`). Gift accounts are the first of these: `docs/PLAN/18` R16 makes substitution on a live invitation the risk that matters, and the trail has to answer "who changed this" without the reader knowing in advance whether an admin or the owner did it. Anything filtering for admin activity should filter on `action` or `resource_type`, which were always the meaningful discriminators.
- Minimum retention of 2 years (compliance & incident investigation — see SECURITY/12-INCIDENT-RESPONSE.md).
- `before_state`/`after_state` store only the relevant fields' snapshots (not the entire row if it contains highly sensitive data) — avoid unnecessarily duplicating bank account data, etc.
