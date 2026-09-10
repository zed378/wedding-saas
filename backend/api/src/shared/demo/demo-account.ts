/**
 * P0-21 — the identity of the seeded demo.
 *
 * `docs/PLAN/07` § Demo Data decides the shape: the catalogue's live demo and the
 * admin's template preview render "a **seeded invitation owned by a system account**,
 * not a separate fixture format: it lives in the same tables as any other invitation,
 * and the demo renders through the production renderer reading the production public
 * API shape".
 *
 * The alternative — a JSON fixture rendered by a demo-only path — was rejected there
 * because it drifts. `docs/UI-UX/11` needs the demo to set accurate expectations before
 * a user commits to a template, and a demo rendered by a second code path stops
 * resembling the product the moment either side changes.
 *
 * The consequence is that the demo is a real row, and every query that counts or lists
 * invitations has to know to leave it out. There is no `is_demo` column: the document
 * picks *ownership* as the marker, so these ids are the marker, and adding a column
 * would have meant a migration and a `docs/DATABASE/04` amendment to say something the
 * specification already says another way.
 *
 * Fixed UUIDs, not generated, so the seed is idempotent and so an admin query can name
 * the account it is excluding.
 */

/**
 * The system account that owns the demo.
 *
 * It cannot be logged into: the seed writes it with `password_hash = NULL` and no OAuth
 * provider, so neither authentication path has anything to verify against. That is a
 * control rather than a convenience — a seeded account with a known id and a guessable
 * password is a back door that ships with the product.
 *
 * Its email is under `.invalid`, which RFC 2606 reserves and guarantees will never
 * resolve, so a notification job that reaches it fails loudly instead of mailing a
 * stranger.
 */
export const SYSTEM_ACCOUNT_ID = "00000000-0000-4000-8000-000000000001";

export const SYSTEM_ACCOUNT_EMAIL = "system-demo@wedding-invitation.invalid";

/** The demo invitation for the reference template. */
export const DEMO_INVITATION_ID = "00000000-0000-4000-8000-000000000002";

/**
 * The demo's public slug.
 *
 * Published and reachable — that is the point of a live demo (`docs/UI-UX/11` § Template
 * Detail Page) — but never *listed*: `invitation_settings.seo_indexable` is false, and
 * anything that enumerates invitations excludes the system account.
 */
export const DEMO_INVITATION_SLUG = "demo-elegant-rose";

/**
 * Is this the demo?
 *
 * Every count, list and dashboard metric over invitations has to exclude it, or the
 * product reports one more customer than it has. `P5` owns the admin dashboard; this
 * function exists now so that work has one answer to import rather than a literal to
 * copy.
 */
export function isSystemAccount(ownerId: string): boolean {
  return ownerId === SYSTEM_ACCOUNT_ID;
}
