import type { SanitizationMode } from "./sanitize";

/**
 * P1-16 step 3 — every free-text path in the product, in one list.
 *
 * The card names them: "person names, parent names, child order, event title/venue/
 * address/description, gallery caption, bank provider/holder, quote text and source, RSVP
 * guest name and message, guestbook name and message, invitation internal name, user full
 * name."
 *
 * ## Why a registry rather than a call at each site
 *
 * Because the failure mode of per-site sanitization is not "somebody does it wrong" — it
 * is "somebody adds the eleventh endpoint and does not think about it at all". A registry
 * turns that into a build failure: `scripts/check-sanitized-fields.mjs` reads this file,
 * reads every request schema, and refuses a string field that appears in neither this list
 * nor `NOT_USER_TEXT`.
 *
 * ## Keys are request-body field names
 *
 * `full_name`, not `fullName`, because the check runs against the Zod schemas at the API
 * boundary and those are `snake_case` (`docs/API/00`). A field that appears in several
 * schemas is listed once: `title` means the same thing wherever it appears, and a registry
 * with per-endpoint entries would be a registry nobody could audit at a glance.
 */
export const TEXT_FIELDS: Readonly<Record<string, SanitizationMode>> = {
  // --- person (docs/PLAN/08 § Person) ---
  full_name: "plain",
  nickname: "plain",
  father_name: "plain",
  mother_name: "plain",
  child_order: "plain",
  instagram: "plain",

  // --- events (docs/DATABASE/05) ---
  title: "plain",
  venue_name: "plain",
  address: "plain",
  description: "plain",

  // --- gallery ---
  caption: "plain",

  // --- bank accounts (docs/DATABASE/06) ---
  provider_name: "plain",
  account_holder: "plain",
  // `account_number` is NOT here and that is deliberate -- see NOT_USER_TEXT.

  // --- quote ---
  text: "plain",
  source: "plain",

  // --- RSVP and guestbook (public, Phase 2; registered now so those tasks cannot
  //     introduce an unregistered field without the check noticing) ---
  guest_name: "plain",
  message: "plain",

  // --- invitation and user ---
  internal_name: "plain",
};

/**
 * String fields that are **not** user-facing prose, with the reason each one is exempt.
 *
 * This list is the other half of the check, and it is the half that will be abused: the
 * cheapest way past a failing build is to add a field here. So every entry carries a
 * reason, and a reviewer's job is to disbelieve them.
 */
export const NOT_USER_TEXT: Readonly<Record<string, string>> = {
  // Credentials and tokens. Sanitizing a password would silently change it.
  password:
    "a credential; never rendered, and altering it would change the secret",
  new_password: "a credential; stripping a tag from it would change the secret",
  old_password: "a credential, compared against a hash; never rendered",
  token: "an opaque credential compared byte for byte against a stored hash",
  id_token: "a Google JWT, accepted only if its signature verifies (P1-04)",
  refresh_token:
    "an opaque credential; never rendered, never stored in the clear",

  // Identifiers and opaque values. Format-validated, and none of them is prose.
  email:
    "format-validated by `z.email()`, and rendered only back to its own owner",
  slug: "matched against `^[a-z0-9-]+$` before storage; no tag survives that character set",
  template_id: "a UUID, validated by `z.uuid()`; not rendered as text",
  media_id: "a UUID, validated by `z.uuid()`; not rendered as text",
  ordered_photo_ids:
    "a list of UUIDs, each validated by `z.uuid()` and then checked to be exactly this invitation's photos (P1-19)",
  invitation_id: "a UUID, validated by `z.uuid()`; not rendered as text",
  exclude_invitation_id:
    "a UUID, validated by `z.uuid()`; used only to exclude one row from a slug lookup (P1-21)",
  user_id: "a UUID, validated by `z.uuid()`; not rendered as text",
  event_id: "a UUID, validated by `z.uuid()`; not rendered as text",
  photo_media_id:
    "a UUID, and additionally checked for tenancy per docs/SECURITY/05 § 6",

  // Enumerations and structured scalars. Each is constrained to a shape no tag fits in.
  type: "a closed `z.enum`; an unlisted value is rejected before storage",
  status: "a closed `z.enum`; an unlisted value is rejected before storage",
  purpose: "a closed `z.enum` of cover|gallery|profile (P1-17); never rendered",
  phone: "digits with an optional +62 prefix, format-validated (P1-08)",
  event_date: "an ISO date, parsed before storage; not free text",
  start_time: "`HH:MM`, matched by regex before storage",
  end_time: "`HH:MM`, matched by regex before storage",
  latitude: "a number with a range check; coerced, never stored as text",
  longitude: "a number with a range check; coerced, never stored as text",
  per_page:
    "a pagination integer, coerced and bounded; never stored or rendered",
  page: "a pagination integer, coerced and bounded; never stored or rendered",

  /*
   * The catalog's read filters (`P2-01`). None of the three is ever written anywhere or
   * rendered anywhere: they narrow a SELECT and form part of a cache key, and the
   * response is a list of templates rather than an echo of the query.
   *
   * `search` is the one worth pausing on, because it IS free text a user typed. Two
   * things make sanitizing it wrong rather than merely unnecessary. It never reaches
   * storage, so there is no stored XSS to prevent — `docs/SECURITY/08`'s concern does not
   * arise. And stripping characters from it would silently change what the user searched
   * for: a search for `<3` would quietly become a search for nothing. Its real hazards
   * are SQL injection and LIKE-wildcard abuse, and both are handled where they live —
   * parameter binding by the driver, and `escapeLike` in the repository.
   */
  category:
    "a catalog read filter, bounded to 40 characters; matched against a stored tag, never written or rendered (P2-01)",
  search:
    "a catalog read filter; bound as a parameter and LIKE-escaped, never written or rendered — sanitizing it would change what the user searched for (P2-01)",
  is_premium:
    "a closed `z.enum` of true|false from a query string; coerced to a boolean, never stored or rendered (P2-01)",

  /**
   * A list of section keys, each checked against the **template's own** `section_key` set.
   *
   * Not prose and not free text: a key the active template does not define is rejected
   * (`P1-14`), so nothing a user invents can be stored, let alone rendered. Sanitizing
   * would be the wrong defence — it would leave an unknown-but-clean key in the array and
   * the settings object would disagree with the page forever.
   */
  enabled_sections:
    "section keys, validated against the template's own set (P1-14)",

  /**
   * Theme overrides. **Keys and values are both validated**, and neither is prose.
   *
   * Keys must appear in the template's `customizable_theme_keys`; values must match
   * `HEX_COLOR` or `CSS_TOKEN` from `@wi/schema` — the same patterns a template definition
   * is held to, imported rather than re-derived so the two cannot disagree.
   *
   * The value check is the one that matters and the one that is easy to miss: a theme value
   * becomes a **CSS custom property** on the public page, so `red; background: url(...)`
   * would be a CSS injection reaching every guest. Tag stripping would not have caught it.
   */
  theme_override:
    "theme keys and values, both validated against the template (P1-14); values become CSS custom properties",

  /**
   * A URL that becomes an `href`, so it needs a **scheme allowlist**, not tag stripping.
   *
   * Sanitizing it as prose would be the wrong defence twice over: `sanitizePlainText`
   * would mangle a legitimate query string, and it would do nothing about the actual risk.
   * `z.url()` alone is not enough either -- measured, not assumed: it accepts
   * `javascript:alert(1)`, `JaVaScRiPt:alert(1)` and `data:text/html,...`, because all
   * three are valid URLs. The schema therefore requires `^https?://` before parsing.
   */
  maps_url:
    "a URL rendered as an href; guarded by an http/https scheme allowlist",

  /**
   * The one that deserves an argument rather than a label.
   *
   * A bank account number is digits and separators, and it is displayed to guests. It is
   * **not** sanitized as prose because `sanitizePlainText` would silently alter a value
   * whose exact characters matter — and because the defence it needs is a format check,
   * not tag stripping. The column is also deliberately unencrypted (ADR-025): the couple
   * enters it in order to publish it.
   *
   * `P1-13` owns the format validation. If that lands without one, this exemption is
   * wrong and the field should move to `TEXT_FIELDS`.
   */
  account_number:
    "digits and separators; needs a format check, not tag stripping",
};

/** Every field name the check knows about, registered or exempt. */
export function isKnownField(name: string): boolean {
  return name in TEXT_FIELDS || name in NOT_USER_TEXT;
}
