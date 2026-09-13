# P2-12 — Feature Spec: Share-Preview Links

| | |
|---|---|
| **Task** | `P2-12` |
| **Date** | 2026-09-13 |
| **Author** | Claude Opus 5 |
| **Status** | Implemented |

---

## 1. Goal

A couple can create a temporary link that shows their **unpublished** invitation to a partner
or organizer — watermarked, never indexed, unable to take submissions — and can revoke it.
Everybody without the link still sees nothing.

## 2. Specification Sources

| Document | Section | What it dictates |
|---|---|---|
| `docs/DATABASE/04` | § Share-Preview Tokens | The table; the token is a credential (high entropy, hashed, expiring, revocable); always `noindex` and watermarked; submissions disabled; dead and invented tokens indistinguishable |
| `docs/API/04` | § Preview | List, create, revoke; token returned once |
| `docs/API/08` | endpoint table | `GET /public/preview/:token` |
| `docs/PLAN/04` | § F6 | 7-day expiry; "PREVIEW - NOT YET PUBLISHED" watermark |
| `docs/PLAN/01` | FR-4.3 | Preview via temporary link with a watermark |
| `docs/SECURITY/05` | § 1, 6, 7 | Owner-scoped queries, 404 for non-owners, child validated against parent |
| `docs/SECURITY/10` | § Rate Limiting | Public route limited per IP |

The documents agree. None gives response shapes; § 4 defines them (ADR-066).

## 3. Business Rules Implemented

No `BR-x.x` covers previews. The governing rules are `docs/DATABASE/04`'s four bullet points,
each mapped to a test in § 11.

## 4. API Contract

- `POST /api/v1/invitations/:id/preview-link` → **201** `{ id, token, url, expires_at, created_at }`. No body accepted.
- `GET /api/v1/invitations/:id/preview-links` → `[{ id, expires_at, created_at, last_accessed_at }]`, active only.
- `DELETE /api/v1/invitations/:id/preview-links/:tokenId` → `{ status: "revoked" }`.
- `GET /public/preview/:token` → the public invitation payload with `status: "preview"`, `display: { watermark: true, preview: true }`, `settings.seo_indexable/rsvp_enabled/guestbook_enabled: false`. Headers `Cache-Control: private, no-store`, `X-Robots-Tag: noindex, nofollow`.
- Errors: 404 for every failure on every route; 401 without a session on the owner routes; 429 from the limiter.

## 5. Data Model Impact

`invitation_preview_tokens`, exactly as `docs/DATABASE/04` defines it (table created by `P0-09`).
Read and written through `shared/tenancy/`. No migration.

## 6. Authorization

- **Owner routes**: session required. Create is `INSERT … SELECT … WHERE owner_id` — one statement,
  no check-then-insert window. List checks ownership first so a stranger gets 404, not `[]`.
  Revoke validates token → invitation → owner in one `UPDATE … WHERE EXISTS`.
- **Public route**: no session; the token's hash, non-revocation, non-expiry (database `now()`)
  and the invitation's non-deletion are all SQL predicates. Status is deliberately not a
  predicate — previewing a draft is the purpose.
- **No admin path.**

## 7. Validation and Sanitization

- The public token is shape-checked (`^[A-Za-z0-9_-]{43}$`) before hashing or querying.
- Nothing is accepted in any request body.
- No free text is stored.

## 8. State Transitions

None on the invitation. The token row moves live → revoked (timestamp) or live → expired (time).

## 9. Side Effects

`last_accessed_at` is written on a successful resolve, best-effort — a failed write does not fail
the preview.

## 10. Failure Modes

Database down → 500 (fail closed). A failed `last_accessed_at` write → preview still served.
Public page: 404 → friendly not-found page; 5xx → error page, never "not found".

## 11. Abuse Cases

| Abuse case | Expected | Test |
|---|---|---|
| Minting a link for someone else's invitation | 404, no row | `preview-link.itest.ts` → "refuses to mint a link for somebody else's invitation"; IDOR sweep row |
| Revoking another invitation's link via one's own | 404, link still works | "refuses to revoke another invitation's link through the caller's own invitation"; IDOR sweep cross-parent and same-owner cases |
| Probing whether a token once existed | Identical 404 for expired, revoked, invented, malformed, deleted-invitation | "answers expired, revoked, invented, malformed and deleted-invitation tokens identically" |
| Reading the token from storage | Only SHA-256 stored | "is returned once and stored only as its hash" |
| A preview indexed by a search engine | `noindex` in payload, header and page | "is always noindex, whatever the invitation's own setting says"; SSR "is noindex regardless" |
| A preview mistaken for the published invitation | Watermark in payload and HTML | "is always watermarked…"; SSR "renders the invitation with the watermark" |
| A revoked preview served from a cache | `private, no-store` | "is never cacheable by a shared cache" |
| The token leaking via `Referer` or page head | `no-referrer`; token absent from `<head>` | SSR "sends no referrer…", "never puts the token in the page head" |
| A preview creating guest rows | No submission route accepts an unpublished invitation | Structural today; pinned in `P4-01`/`P4-03` DoD |

## 12. Test Plan

Unit (token shape, service), integration (16 in `preview-link.itest.ts` + 3 IDOR sweep rows),
SSR (6 in `initial-html.ssr.ts`), component (4 in `share-preview.spec.tsx`).

## 13. Observability

Nothing logged beyond the request line; the token is never logged. `last_accessed_at` is the
owner-visible signal.

## 14. Open Questions

None blocking. Submissions-from-preview is guaranteed structurally and handed to `P4` as DoD lines.
