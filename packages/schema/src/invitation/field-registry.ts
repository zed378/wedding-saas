/**
 * P0-20 — the canonical field-path vocabulary.
 *
 * `docs/PLAN/08-INVITATION-DATA-MODEL.md` is "the core document — the canonical
 * invitation data schema, independent of the template (the template only 'selects &
 * displays' a subset of this data)". This file is that document expressed as data, so a
 * template definition can be checked against it instead of trusted.
 *
 * The failure this prevents is quiet. A template that asks for `couple.groom.nickmame`
 * is syntactically fine, passes every type check, is stored happily in a JSONB column,
 * and renders an empty hero section on every invitation that uses the template. Nobody
 * finds it until a customer does. With this list, the typo is rejected at authoring
 * time with the path in the message.
 *
 * **The paths are the API's vocabulary too.** `docs/API/03` § Important Rules says
 * `sections[].required_fields` "uses dot-notation referring to the canonical structure
 * in PLAN/08 … used by the frontend for dynamic validation in the Editor without
 * hard-coding per template". Changing a path here changes a published contract.
 */

/**
 * Whether a path names a single value or a collection.
 *
 * The distinction is load-bearing for `max_items` (only a collection can have one) and
 * for emptiness: an empty collection is missing, and so is a collection whose elements
 * are missing the value -- see `isPathMissing` in `../resolver/resolve-path.ts`.
 */
export type FieldKind = "scalar" | "collection";

export interface FieldDefinition {
  /** The dot path, with `*` standing for "every element of the collection". */
  readonly path: string;
  readonly kind: FieldKind;
  /** The table `P0-09` created for it. Present so a reader can check the claim. */
  readonly source: string;
}

/**
 * Every path a template may reference.
 *
 * Two families are deliberately absent.
 *
 * **`settings.*`** — a template selects *content*. `enabled_sections`, `slug`,
 * `theme_override` and the toggles are how an invitation configures a template, and a
 * template declaring `settings.slug` as a required field would invert that relationship.
 * `docs/FRONTEND/04` step 2 reads `enabled_sections` directly, not through this resolver.
 *
 * **RSVP and guestbook entries** — they are guest-submitted, after publication. A
 * template that could require them non-empty would make publishing impossible by
 * construction.
 */
export const INVITATION_FIELDS: readonly FieldDefinition[] = [
  // --- Couple (docs/PLAN/08 § Entity: Person), one row per role -------------
  ...(["groom", "bride"] as const).flatMap((role) =>
    (
      [
        "full_name",
        "nickname",
        "photo",
        "instagram",
        "father_name",
        "mother_name",
        "child_order",
      ] as const
    ).map((field) => ({
      path: `couple.${role}.${field}`,
      kind: "scalar" as const,
      source: `invitation_people (role = '${role}')`,
    })),
  ),

  // --- Events (docs/PLAN/08 § Entity: Event). 1..N, not a fixed pair --------
  { path: "events", kind: "collection", source: "invitation_events" },
  ...(
    [
      "type",
      "title",
      "date",
      "start_time",
      "end_time",
      "venue_name",
      "address",
      "latitude",
      "longitude",
      "maps_url",
      "description",
    ] as const
  ).map((field) => ({
    path: `events.*.${field}`,
    kind: "scalar" as const,
    source: "invitation_events",
  })),

  // --- Gallery (docs/PLAN/08 § Entity: Photo) -------------------------------
  { path: "gallery.photos", kind: "collection", source: "invitation_gallery" },
  ...(["media_id", "caption", "order", "is_cover"] as const).map((field) => ({
    path: `gallery.photos.*.${field}`,
    kind: "scalar" as const,
    source: "invitation_gallery",
  })),

  // --- Gift (docs/PLAN/08 § Entity: BankAccount) ----------------------------
  //
  // Named `gift.accounts` rather than `bank_accounts` because the section key is `gift`
  // and one of the two types is an e-wallet. `docs/SECURITY/09` treats these as
  // sensitive: the paths exist so a template can *display* them, and nothing here
  // decides who may read the values.
  {
    path: "gift.accounts",
    kind: "collection",
    source: "invitation_bank_accounts",
  },
  ...(
    [
      "type",
      "provider_name",
      "account_number",
      "account_holder",
      "order",
    ] as const
  ).map((field) => ({
    path: `gift.accounts.*.${field}`,
    kind: "scalar" as const,
    source: "invitation_bank_accounts",
  })),

  // --- Quote (docs/PLAN/08 § Design Principles: "a simple entity") ----------
  { path: "quote.text", kind: "scalar", source: "invitation_quote" },
  { path: "quote.source", kind: "scalar", source: "invitation_quote" },
] as const;

/** Lookup set. Built once; `INVITATION_FIELDS` is the source of truth. */
const FIELD_PATHS = new Set(INVITATION_FIELDS.map((f) => f.path));

/** Every canonical path, in registry order. */
export const INVITATION_FIELD_PATHS: readonly string[] = INVITATION_FIELDS.map(
  (f) => f.path,
);

/** Is this a path a template is allowed to reference? */
export function isCanonicalFieldPath(path: string): boolean {
  return FIELD_PATHS.has(path);
}

/** The definition behind a path, or `undefined` if it is not in the registry. */
export function fieldDefinition(path: string): FieldDefinition | undefined {
  return INVITATION_FIELDS.find((f) => f.path === path);
}

/**
 * Paths a human might plausibly have meant, for the error message.
 *
 * A validator that says "unknown field path: couple.groom.nickmame" is already useful.
 * One that adds "did you mean couple.groom.nickname?" is the difference between a
 * five-second fix and a trip through `docs/PLAN/08`. The metric is deliberately crude --
 * a shared prefix and a similar length -- because a wrong suggestion is only a mild
 * annoyance while no suggestion is the status quo.
 */
export function suggestFieldPaths(path: string, limit = 3): readonly string[] {
  const scored = INVITATION_FIELD_PATHS.map((candidate) => ({
    candidate,
    score: sharedPrefixLength(candidate, path) - lengthPenalty(candidate, path),
  }))
    .filter((s) => s.score > 3)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map((s) => s.candidate);
}

function sharedPrefixLength(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return i;
}

function lengthPenalty(a: string, b: string): number {
  return Math.abs(a.length - b.length);
}
