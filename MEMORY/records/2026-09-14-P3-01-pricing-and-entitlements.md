# P3-01 — Package and Addon Master Data, Pricing Service

| | |
|---|---|
| **Task** | `P3-01` |
| **Date** | 2026-09-14 |
| **Branch** | `feat/P3-01-pricing` |
| **Status** | DONE |
| **Spec** | [`MEMORY/specs/P3-01-pricing-and-entitlements.md`](../specs/P3-01-pricing-and-entitlements.md) |

---

## What changed

- **`PricingService.calculate({ packageId, addonIds, orderType })`** computes an order's total from
  the `packages` and `addons` rows, read at request time. No amount enters: the input type has no
  field for one, and the service copies the three fields it uses.
- **`EntitlementsService.forInvitation(invitationId)`** answers photo quota, watermark, validity
  months and custom-domain permission from the latest `paid` order's package, or the unpaid rule
  (ADR-073).
- **Three places now ask it** instead of deciding on their own: the upload quota (was a `200`
  constant in `MediaService`), the gallery attach quota (the same constant), and the public
  payload's `display.watermark` (was a private query in `PublicInvitationRepository`).
- **`scripts/check-price-literals.mjs`** in `pnpm verify`: any seeded price, in any rupiah spelling,
  in application code fails the build. It found two, both replaced.

No endpoint, no migration, no seed change. The seed already matched ADR-023 (`P0-10`).

## Why

`docs/SECURITY/07` § Pricing; the card's goal of one pricing service and one entitlement answer, so
`P3-02` has exactly one source for `amount_total` and a second tier is a row.

## How

`backend/api/src/modules/order/`: `CatalogRepository` (with a `CatalogReader` interface and a
`CATALOG` token so the services test against a fixture catalogue), `PricingService`,
`EntitlementsService`, `PricingModule` (imported by media, invitation and publishing).

## Files and Components Touched

- New: `src/modules/order/{catalog.repository.ts, catalog.token.ts, pricing.service.ts, entitlements.service.ts, pricing.module.ts}`, `scripts/check-price-literals.mjs`, `test/pricing.service.spec.ts`, `test/integration/pricing.itest.ts`, `MEMORY/specs/P3-01-pricing-and-entitlements.md`
- Changed: `src/modules/media/{media.service.ts, media.module.ts, media.controller.ts (comment)}`, `src/modules/invitation/{gallery.service.ts, invitation.module.ts}`, `src/modules/publishing/{public-invitation.service.ts, public-invitation.dto.ts, publishing.module.ts}`, `src/shared/tenancy/public-invitation-repository.ts` (watermark query removed)
- Tests adjusted: `gallery.itest.ts`, `media-upload.itest.ts` (quota read from the row via `seededMaxPhotos`), `public-invitation-service.spec.ts`, `public-payload-combinations.spec.ts`, `test/support/{factories.ts (package/addons/createdAt on orders), rejection.ts (details)}`, `change-template.itest.ts` (cast no longer needed)
- `scripts/verify.sh`; `frontend/web-app/src/app/workbench/stories.tsx`, `packages/ui/src/components/InteractiveCard.tsx` (price literals replaced with an example figure)

## Decisions Made

ADR-073: one entitlements service; paid = latest `paid` order's package; unpaid = smallest active
tier's quota, watermarked; no active package fails loudly; price-literal guard.

## Deviations from `docs/`

None. The unpaid rule fills a gap without contradicting `docs/PLAN/11` (it yields the same 200).

## Tests Added

| Test | Proves |
|---|---|
| `pricing.service.spec.ts` (32) | 2 tiers × 8 addon subsets total their rows; smuggled amount ignored and absent from the result; renewal = first publish; inactive/unknown/empty package → 422; inactive and unknown addons → one 422 naming each; repeated addon → 400; bigint beyond 2^53; entitlements for paid tier, deactivated tier, custom-domain addon, unpaid minimum, non-UUID id without a query, no active package |
| `pricing.itest.ts` (16) | Real seed: standard at its row's price; renewal Rp 139,000 / 12 months; a changed row changes the next quote; seeded addons refused; inactive package refused; a test tier priced as a row; entitlements for none / pending / refunded / failed / expired / paid / latest-of-several / another invitation's order; unpaid minimum with a smaller tier; **upload refused at the fourth photo on a three-photo paid tier** |

**Mutation runs**: dropping `status = 'paid'` from `latestPaidPurchase` failed 5 tests (4 in
`pricing.itest.ts`, plus `public-invitation.itest.ts` › "stays true for an order that is only
pending"); `Math.min` → `Math.max` failed the unpaid-minimum unit test. The guard was exercised
against `139_000n`, `139000`, `139.000`, `139,000` (all refused) and `1139000`, `139000.5`, `13900`,
`2139_000` (all allowed).

## Security Verification

- **Client amount ignored**: `pricing.service.spec.ts` › "ignores any amount smuggled into the
  input". Only the service level exists in this task; the request-body test belongs to `P3-02`.
- **Watermark not removable by an unpaid order**: `pricing.itest.ts` › "a pending order grants
  nothing" and `public-invitation.itest.ts` › "stays true for an order that is only pending" (still
  passing through the new path).
- **Refund reverses the entitlement (BR-5.4)**: `pricing.itest.ts` › "a refunded order grants
  nothing".
- **Unscoped `orders` read**: returns entitlements only; callers authorize first (spec § 6).
  `pricing.itest.ts` › "never reads another invitation's orders". The IDOR sweep is unchanged and
  still passes: no new route.

## Abuse Cases Covered

Spec § 11, every row with its named test.

## Definition of Done Verification

All six card items checked on the card with their tests. Global DoD: `pnpm verify` passed (including the new
guard); integration suite 35 files / 937 tests passed; API unit suite 618 passed.

## What Did Not Work

- **`forInvitation` first sent any `:id` string to Postgres.** The media controller does not validate
  `:id` as a UUID before the service, and the repository's own query had been the first thing to see
  it. An entitlement lookup placed before that query would have turned a malformed id's 404 into a
  cast error. Fixed by returning the unpaid entitlements for a non-UUID id without querying, tested.
- **Docker Desktop was not running** at the start of the session, so the integration suite first
  failed on "no database"; started it and the compose services on 54432/56279.

## Follow-Ups and Open Questions

- **`OQ-28`**: no endpoint gives checkout a price. Blocks `P3-14`.
- **`requireVerifiedEmail` obligation from `P1-02`**: the P1-02 card says `POST /orders` is `P3-01`;
  it is `P3-02` (this task has no endpoint). The obligation moves to `P3-02` and, for publish, `P3-09`.
- `P3-09` should read `durationMonths` from `EntitlementsService.forPackage` / the order's package,
  not the seed.

## What to Watch

`entitlements.no_active_package` at `error` means every upload is failing: the `packages` seed is
missing or all rows were deactivated.
