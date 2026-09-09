# 08 - Table: payments

```sql
CREATE TABLE payments (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id                 UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  provider                    VARCHAR(30) NOT NULL,          -- 'midtrans' | 'xendit'
  provider_reference_id          VARCHAR(150) NOT NULL,
  method                             VARCHAR(30),               -- 'va_bca' | 'gopay' | 'qris' etc.
  amount                               BIGINT NOT NULL,
  status                                 VARCHAR(20) NOT NULL DEFAULT 'pending'
                                        CHECK (status IN ('pending','success','failed')),
  raw_callback_payload                    JSONB,
  signature_valid                            BOOLEAN,
  verified_at                                  TIMESTAMPTZ,
  created_at                                     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                                       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_payments_provider_ref ON payments(provider, provider_reference_id);
CREATE INDEX idx_payments_order ON payments(order_id);
```

## Critical Notes
- `UNIQUE (provider, provider_reference_id)` is the primary idempotency mechanism at the DB level: a webhook received multiple times (a provider retry is normal) will not create a duplicate row — the service layer does an upsert/`ON CONFLICT DO NOTHING` then checks the existing status (see API/07-PAYMENT-API.md, BACKEND/05-PAYMENT-FLOW.md).
- `raw_callback_payload` is stored in full for audit/debugging purposes, BUT fields that potentially contain card data/extensive financial PII from the provider must be reviewed to avoid violating PCI-DSS compliance — ideally the provider already sends tokenized data, not raw card data (see SECURITY/07-PAYMENT-SECURITY.md).
- `signature_valid` is explicitly recorded so that fake callback attempts (invalid signature) remain logged for security investigation, even though they are not processed as valid payments.
