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
  checkout_url                                   TEXT,          -- P3-04, ADR-076: the provider's payment page for this attempt
  checkout_token                                 VARCHAR(255),  -- P3-04: the widget token for the same page
  created_at                                     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                                       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_payments_provider_ref ON payments(provider, provider_reference_id);
CREATE INDEX idx_payments_order ON payments(order_id);
```

## Critical Notes
- `UNIQUE (provider, provider_reference_id)` is the primary idempotency mechanism at the DB level: a webhook received multiple times (a provider retry is normal) will not create a duplicate row — the service layer does an upsert/`ON CONFLICT DO NOTHING` then checks the existing status (see API/07-PAYMENT-API.md, BACKEND/05-PAYMENT-FLOW.md).
- `raw_callback_payload` is stored in full for audit/debugging purposes, BUT fields that potentially contain card data/extensive financial PII from the provider must be reviewed to avoid violating PCI-DSS compliance — ideally the provider already sends tokenized data, not raw card data (see SECURITY/07-PAYMENT-SECURITY.md). It is **not** column-encrypted (MEMORY ADR-025): it is retained precisely so a signature can be re-verified during an investigation, which redaction or encryption-in-place would work against. Access is restricted to a narrower role and every access is logged (API/09).
- `signature_valid` on `payments` is set only from a **verified** notification. Fake callback attempts are kept in `payment_notifications` below — a forged callback has no payment of its own, and writing its claim onto the real payment row it names would let a forger overwrite a genuine record (ADR-077).
- `checkout_url` / `checkout_token` (ADR-076) let a repeated initiation return the **same** payment page while the payment is `pending` and the order is still payable, instead of opening a second provider transaction for one order — two live pages is how a customer pays twice. Null until the provider answers; a `pending` row with no checkout older than 30 seconds is an initiation that died mid-call and is marked `failed`.

## Table: payment_notifications (P3-05, ADR-077)

```sql
CREATE TABLE payment_notifications (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider           VARCHAR(30) NOT NULL,
  claimed_reference  VARCHAR(150),                 -- what the payload names; unverified when signature_valid is false
  payment_id         UUID REFERENCES payments(id) ON DELETE RESTRICT,  -- only for a verified one that matched
  signature_valid    BOOLEAN NOT NULL,
  rejection_reason   VARCHAR(30),                  -- 'malformed' | 'signature_mismatch'
  outcome            VARCHAR(20),                  -- 'pending' | 'success' | 'failed' | 'ignored'
  provider_status    VARCHAR(40),
  amount             BIGINT,
  result             VARCHAR(40),                  -- what processing did; null until processed
  needs_review       BOOLEAN NOT NULL DEFAULT false,
  raw_payload        JSONB,                        -- invalid ones: only a JSON object of at most 8 KB
  received_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at       TIMESTAMPTZ
);
CREATE INDEX idx_payment_notifications_reference ON payment_notifications(provider, claimed_reference);
CREATE INDEX idx_payment_notifications_received ON payment_notifications(received_at);
CREATE INDEX idx_payment_notifications_review ON payment_notifications(received_at) WHERE needs_review;
```

- One row per notification received, genuine or forged, written before processing in its own statement — so it survives a processing failure that rolls back.
- **Append-mostly by permission**: the application role may INSERT and SELECT, may UPDATE only `payment_id`, `result`, `needs_review`, `processed_at`, and may not DELETE. It is evidence in a fraud investigation (SECURITY/12).
- `result` values: `applied`, `late_payment`, `duplicate_charge`, `refunded_order`, `applied_entitlement_skipped`, `duplicate`, `failed`, `failed_other_payment_live`, `no_change`, `ignored`, `unknown_reference`, `amount_mismatch`.
