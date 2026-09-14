# P3-01 — Feature Spec: Pricing and Package Entitlements

| | |
|---|---|
| **Task** | `P3-01` |
| **Date** | 2026-09-14 |
| **Author** | Claude (autonomous run) |
| **Status** | Implemented |

---

## 1. Goal

One service computes what an order costs, from `packages` and `addons` rows read at request time,
and one service answers "what is this invitation allowed" (photo quota, watermark, validity months,
custom domain). After this task, `P3-02` can create an order whose `amount_total` has exactly one
possible source, and the three places that today decide an entitlement on their own — the upload
quota constant in `MediaService`, the same constant in `GalleryService`, and the watermark query in
`PublicInvitationRepository` — ask the same service.

## 2. Specification Sources

| Document | Section | What it dictates |
|---|---|---|
| `docs/SECURITY/07` | § Pricing | `amount_total` always calculated server-side from `packages`/`addons`; the client never sends a price |
| `docs/DATABASE/07` | tables, § Notes | `packages.price` is the source of truth; seed data, not migration; `addons.is_active` gates availability; no addon active at MVP |
| `docs/PLAN/09` | § Add-on Availability, § Package (MVP) | One package `standard`, Rp 139,000, 12 months, 200 photos, no watermark; renewal same price; no price constant in code |
| `docs/PLAN/11` | § Limits per Package | `standard` 200 photos; free draft (unpaid) 200 photos |
| `docs/API/06` | § Critical Rules | Recalculated from `package_id`/`addon_ids` when the request is received |
| `docs/API/08` | `display.watermark` | Derived server-side from the package the invitation was paid for |
| ADR-022, ADR-023, ADR-052 | — | Addons inactive; one tier; trial publish is watermarked |

No disagreement between them. One thing is **not stated anywhere**: the entitlements of an
invitation that has not been paid for, beyond `docs/PLAN/11`'s "200" and the watermark. See § 14 and
ADR-073.

## 3. Business Rules Implemented

| Rule | Statement | Enforced in |
|---|---|---|
| BR-5.1 | One order = one invitation, one package, optional addons | `PricingService.calculate` input shape |
| `SECURITY/07` § Pricing | Price only from the database | `PricingService.calculate`; `scripts/check-price-literals.mjs` |
| BR-5.4 | A refund reverses the entitlement | `EntitlementsService.forInvitation` counts only `status = 'paid'` orders |
| BR-2.8 | A trial publish is an unpaid invitation | Unpaid entitlements carry `watermark: true` |

## 4. API Contract

No endpoint in this task. `P3-02` exposes `calculate` through `POST /invitations/:id/orders`.

Errors the service throws, for `P3-02` to surface (422, `BusinessRuleError`):

- `PACKAGE_NOT_AVAILABLE` — unknown or inactive `package_id`.
- `ADDON_NOT_AVAILABLE` — any unknown or inactive addon id; `details` names each one.

A repeated addon id is a 400 `VALIDATION_ERROR`: asking to pay twice for one addon is a malformed
request, not a rule. Unknown and inactive are deliberately the same code: the catalogue is not
secret, but "exists but not for sale" gives a client nothing to act on that "not available" does not.

## 5. Data Model Impact

| Table | Read / Write | Notes |
|---|---|---|
| `packages` | Read | Every call; no cache (prices must take effect immediately; one indexed PK read) |
| `addons` | Read | Only when addon ids are given |
| `orders` | Read | Latest `paid` order of an invitation, for entitlements |

Migration required: **no**. Seed unchanged.

## 6. Authorization

- `PricingService` reads public catalogue data; no tenant data, no scope.
- `EntitlementsService.forInvitation(invitationId)` reads `orders` by invitation id **without an
  owner filter**. That is acceptable only because it returns entitlements, never order data, and
  every caller has already authorized the invitation or is serving it publicly:
  - `MediaService.upload` / `GalleryService.attach`: the quota is then enforced inside
    `insertMediaWithinQuota` / `attachGalleryPhoto`, which apply the owner scope and return
    not-found for a non-owner. A non-owner learns nothing from the quota number because the
    request ends in the same 404 as before.
  - `PublicInvitationService.bySlug`: the invitation has already been resolved as published.
- `orders` is not in `scripts/check-tenant-scope.mjs`'s guarded list; this does not add a bypass
  of a guarded table.

## 7. Validation and Sanitization

- The service's input type has `packageId`, `addonIds`, `orderType` and nothing else. There is no
  field through which an amount can enter.
- Free text: none.
- Not accepted from the client: any amount, price, total, discount.

## 8. State Transitions

None.

## 9. Side Effects

None. Read-only.

## 10. Failure Modes

- Database down: the calling request fails (500 through the mapper). Pricing cannot fail open.
- No active package exists (a broken seed): unpaid entitlements cannot be computed; the service
  throws and logs `entitlements.no_active_package` at `error`. Refusing uploads loudly is better
  than silently inventing a quota.
- A paid order whose package was later deactivated: entitlements still follow that package — the
  customer bought it, and deactivation stops new sales, not existing ones.

## 11. Abuse Cases

| Abuse case | Source | Expected behaviour | Test name |
|---|---|---|---|
| Amount smuggled into the input object | `SECURITY/07` § Pricing | Ignored; total from rows | `pricing.service.spec.ts` › "ignores any amount smuggled into the input" |
| Ordering an inactive addon (`custom_domain`) | ADR-022 | 422 `ADDON_NOT_AVAILABLE` | `pricing.itest.ts` › "refuses the seeded inactive addons" |
| Ordering an inactive package | `DATABASE/07` | 422 `PACKAGE_NOT_AVAILABLE` | `pricing.service.spec.ts`, `pricing.itest.ts` |
| Same addon twice to double a line | — | 400 | `pricing.service.spec.ts` › "refuses a repeated addon" |
| Removing the watermark by opening checkout | `API/08` | Pending order = unpaid entitlements | `entitlements.itest.ts` › "a pending order grants nothing" |
| Keeping the product after a refund | BR-5.4 | Refunded order = unpaid entitlements | `entitlements.itest.ts` › "a refunded order grants nothing" |

## 12. Test Plan

| Layer | Cases |
|---|---|
| Unit | Every package × addon-subset combination of a fixture catalogue; inactive/unknown package and addon; duplicates; renewal equals new publish; smuggled amount; bigint sums; entitlement mapping for paid/unpaid; minimum across active packages |
| Integration | Real seed: `standard` totals its row's price; a price changed in the row changes the next calculation; seeded addons refused; a second active tier is priced and entitled without code change; entitlements for none/pending/paid/refunded/failed; upload and gallery quota follow the entitlement; public watermark follows it |
| Security | `check-price-literals` guard in `pnpm verify` |

## 13. Observability

`entitlements.no_active_package` at `error`. Pricing refusals are client errors and are logged by
the HTTP layer as such.

## 14. Open Questions

- **Unpaid entitlements** are not specified beyond `docs/PLAN/11`'s photo number and the watermark.
  Decided in ADR-073 rather than raised, because today every option yields identical behaviour
  (one package, 200 = 200) and the choice only matters when a second tier exists: the unpaid photo
  quota is the **smallest** `max_photos` among active packages, so nothing uploaded to a draft can
  exceed what the cheapest purchase allows. Flagged for review when a second tier is proposed.
- **No catalogue endpoint exists** for `P3-14`'s checkout to show a price. Without one the web app
  would have to hard-code Rp 139,000, which this task forbids. Raised as a specification gap for
  `P3-14` (`OQ-28`), not solved here.
- `OQ-18` (DB constraint for one pending order) is `P3-02`'s, and stays open.
