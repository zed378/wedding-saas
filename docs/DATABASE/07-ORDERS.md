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
CREATE INDEX idx_orders_user ON orders(user_id);
CREATE INDEX idx_orders_status ON orders(status);
```

## Notes
- `amount_total` is stored as a snapshot (not recalculated on read) so the order history remains accurate even if package prices change later.
- `order_type` distinguishes a first-time publish order from a renewal order (PLAN/09).
- `addons.is_active` gates availability: `custom_domain` is seeded with `is_active = false` until the Phase 2 custom domain feature ships (PLAN/09 § Add-on Availability at MVP). The order service refuses an inactive addon.
- Application-level constraint (not DB-level): only 1 order with `status='pending'` may be active per invitation at a time (checked in the service layer before insert, see API/06-ORDER-API.md error `ACTIVE_ORDER_EXISTS`).
