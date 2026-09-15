# 07 - Table: orders

```sql
CREATE TABLE packages (
  id                 VARCHAR(30) PRIMARY KEY,        -- 'basic' | 'premium'
  name                 VARCHAR(60) NOT NULL,
  price                  BIGINT NOT NULL,               -- master price, the source of truth for pricing
  duration_months           INT NOT NULL,
  max_photos                  INT NOT NULL,
  has_watermark                  BOOLEAN NOT NULL DEFAULT true,
  is_active                        BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE addons (
  id                 VARCHAR(30) PRIMARY KEY,        -- 'custom_domain' | 'extended_validity'
  name                 VARCHAR(60) NOT NULL,
  price                  BIGINT NOT NULL,
  is_active                BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE orders (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id        UUID NOT NULL REFERENCES invitations(id) ON DELETE RESTRICT,
  user_id                UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  package_id                VARCHAR(30) NOT NULL REFERENCES packages(id),
  addon_ids                   VARCHAR(30)[] NOT NULL DEFAULT '{}',
  amount_total                   BIGINT NOT NULL,        -- price snapshot at order creation time (immutable even if the master price changes later)
  status                           VARCHAR(20) NOT NULL DEFAULT 'pending'
                                   CHECK (status IN ('pending','paid','failed','expired','refunded')),
  order_type                          VARCHAR(20) NOT NULL DEFAULT 'new_publish' CHECK (order_type IN ('new_publish','renewal')),
  expired_at                            TIMESTAMPTZ NOT NULL,
  created_at                              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                                TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_orders_invitation ON orders(invitation_id);
CREATE UNIQUE INDEX idx_orders_one_pending ON orders(invitation_id) WHERE status = 'pending';  -- ADR-074
CREATE INDEX idx_orders_user ON orders(user_id);
CREATE INDEX idx_orders_status ON orders(status);
```

## Notes
- `amount_total` is stored as a snapshot (not recalculated on read) so the order history remains accurate even if package prices change later.
- `order_type` distinguishes a first-time publish order from a renewal order (PLAN/09).
- `addons.is_active` gates availability. At MVP **no addon is active**: `custom_domain` waits for the Phase 2 feature and `extended_validity` is redundant beside a 12-month package (PLAN/09 § Add-on Availability at MVP). The order service refuses an inactive addon.
- `packages` is seeded with exactly one active row at MVP: `standard`, Rp 139,000, `duration_months = 12`, `max_photos = 200`, `has_watermark = false` (PLAN/09, ADR-023). Seed data, not a migration — prices change without a schema change, and `amount_total` on existing orders is a snapshot that a later price change must not rewrite.
- Only 1 order with `status='pending'` may be active per invitation at a time. Checked in the service layer before insert, under a lock on the invitation row, so the API can answer `ACTIVE_ORDER_EXISTS` (API/06-ORDER-API.md) — **and** guaranteed by the partial unique index `idx_orders_one_pending`, which holds when anything bypasses that service (ADR-074, answers `OQ-18`).

## Table: invoices (P3-08, ADR-079)

```sql
CREATE TABLE invoices (
  order_id      UUID PRIMARY KEY REFERENCES orders(id) ON DELETE RESTRICT,
  number        VARCHAR(40) NOT NULL UNIQUE,     -- INV-YYYYMMDD-XXXXXXXX (payment day in WIB, order id prefix)
  pdf           BYTEA NOT NULL,                  -- the document as issued
  generated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- One per paid order, inserted once (`ON CONFLICT DO NOTHING`) and never rewritten: the application role has INSERT and SELECT only. An invoice is forwarded to other people; a re-rendered one could differ from what they already have.
- Stored in the database rather than object storage: a few kilobytes, private without a bucket policy to get right.
- A single line at the order's `amount_total`: prices per item at purchase time are not stored, and today's catalogue prices could disagree with what was paid.
