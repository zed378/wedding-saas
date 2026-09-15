# P3-08 — Invoice Generation and Order History

| | |
|---|---|
| **Task** | `P3-08` |
| **Date** | 2026-09-15 |
| **Branch** | `feat/P3-08-invoice-history` |
| **Status** | DONE (seller identity pending `OQ-29`) |
| **Spec** | Not required by the card |

---

## What changed

- **`GET /api/v1/orders`** (paginated), **`GET /api/v1/orders/:order_id`** — current status, `created_at`,
  `paid_at`, `invoice_available`.
- **`GET /api/v1/orders/:order_id/invoice`** — PDF attachment, owner only, paid only.
- **`InvoiceService`** + **`InvoiceRepository`**; **`simple-pdf.ts`** and **`invoice-document.ts`**.
- **Migration `0014`**: `invoices`, immutable for the application role.
- **`invoice.generate`** queued by the webhook after commit, consumed by the API jobs process; also added to
  the worker's job catalogue.
- `INVOICE_SELLER_NAME` (default `vizunicum.my.id`), `INVOICE_SELLER_ADDRESS`.

## Why

Card goal; `docs/PLAN/09` § Invoice; `docs/PLAN/04` F12.

## How

ADR-079.

## Files and Components Touched

- New: `src/modules/order/invoice/{simple-pdf.ts, invoice-document.ts, invoice.repository.ts, invoice.service.ts}`, `migrations/0014_invoices{.sql,.down.sql}` + snapshot, `test/invoice-document.spec.ts`, `test/integration/order-history-invoice.itest.ts`
- Changed: `src/modules/order/{order.controller.ts, order.service.ts, order.module.ts}`, `src/shared/tenancy/order-repository.ts`, `src/modules/payment/payment-webhook.service.ts`, `src/jobs/{domain-jobs.ts, main.ts}`, `src/infra/db/schema/orders.ts`, `src/config/env.schema.ts`, `backend/worker/src/jobs.ts`
- Tests changed: `test/order-http.spec.ts`, `test/domain-jobs.spec.ts`, `test/integration/domain-jobs.itest.ts`, `test/support/phase-one-tenant.ts` (paid order), `test/integration/idor-sweep.itest.ts`
- Docs: `docs/API/06`, `docs/DATABASE/07`, `docs/PLAN/09`, `TASKS/BACKLOG.md` (`OQ-29`)

## Decisions Made

ADR-079.

## Deviations from `docs/`

ADR-017's PDF library not used. Card step 2 says "in the worker"; it runs in the API jobs process
(ADR-078). Card step 5 (attach to the confirmation email) is `P4-07`'s and not done here.

## Tests Added

| Test | Proves |
|---|---|
| `invoice-document.spec.ts` (8) | PDF header/trailer; every xref offset lands on its object; exact stream length; escaping and WinAnsi replacement; WIB dating across midnight UTC; rupiah formatting; required contents present and no invitation content; renewal label and optional address |
| `order-history-invoice.itest.ts` (14) | List newest first with current status incl. a swept `expired`; no cross-user listing; pagination; detail + 404 for others/unknown/malformed; webhook queues `invoice.generate`; generated once (idempotent, one row); owner download generates if missing; 422 and no row for pending/expired/failed/refunded; 404 for another user's invoice; failing generation leaves order `paid` and payment `success`; trial's first payment labelled "Publikasi"; app role cannot update or delete an invoice |
| `order-http.spec.ts` (+3) | List pagination meta; unknown query refused; PDF headers and bytes |
| `idor-sweep.itest.ts` (+2 cases) | `GET /orders/:order_id`, `GET /orders/:order_id/invoice` |

No mutation run was recorded for this task.

## Security Verification

- IDOR: `order-history-invoice.itest.ts` › "shows one order in detail, and 404 to anyone else", "answers another user's invoice with 404"; sweep cases.
- PII in the document limited to the buyer's own name and email: `invoice-document.spec.ts` › "carries what an invoice needs and nothing about the invitation".
- Issued documents cannot be rewritten by the app: "cannot update or delete an invoice".
- Not cached by intermediaries: `order-http.spec.ts` › "sends the PDF as a private, uncached attachment".

## Abuse Cases Covered

Cross-user listing, detail and invoice download — tests named above.

## Definition of Done Verification

All four card items checked with named tests. `pnpm verify` passed; integration suite 42 files / 1040 tests passed; `db:roundtrip` passed with migration `0014`.

## What Did Not Work

- **`paid_at` was null for every order** on the first run: a Drizzle-interpolated correlated subquery rendered
  its columns unqualified (`"order_id" = "id"`), so both sides resolved against `payments`. Rewritten with
  explicit aliases; the history test caught it.
- A test fixture wrote a PDF with literal newlines through a Python edit, breaking the TypeScript string;
  fixed.
- The price-literal guard (`P3-01`) failed `pnpm verify` on a doc comment of mine that used `Rp 139.000` as the formatting example; the example now uses another figure. The guard working as intended.
- The first invoice text claimed the document was legally valid without a signature — removed before commit;
  that is exactly what `OQ-29` must answer.

## Follow-Ups and Open Questions

- **`OQ-29`** before launch.
- `P4-07`: link or attach the invoice in the payment email.
- Staging: migration `0014`.

## What to Watch

`invoice.not_generated` warnings for paid orders (should not happen); `invoices` table growth is trivial.
