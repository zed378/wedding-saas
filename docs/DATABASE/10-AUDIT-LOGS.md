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
- Minimum retention of 2 years (compliance & incident investigation — see SECURITY/12-INCIDENT-RESPONSE.md).
- `before_state`/`after_state` store only the relevant fields' snapshots (not the entire row if it contains highly sensitive data) — avoid unnecessarily duplicating bank account data, etc.
