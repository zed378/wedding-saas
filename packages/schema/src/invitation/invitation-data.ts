/**
 * P0-20 — the runtime shape the field registry names.
 *
 * `docs/PLAN/08` describes the canonical invitation as a domain model. The registry in
 * `field-registry.ts` turns it into a list of paths. This file is the third leg: the
 * object those paths actually walk, so the registry can be *tested* rather than asserted.
 *
 * These are types, not validators. Structural validation of user input belongs to the
 * editor and the invitation endpoints (`docs/BACKEND/03`, Phase 1) and would be a
 * different schema with different rules -- what is required in the DB is explicitly not
 * what is required to publish (`docs/PLAN/08` § Validation). Declaring the shape here and
 * the input rules there keeps those two from being confused for one another.
 *
 * Every field is optional at this level. An invitation in `draft` is a half-filled form
 * by definition, and the whole point of `collectMissingRequiredFields` is to answer what
 * is still missing -- which it cannot do if the type system pretends nothing is.
 */

/** `docs/PLAN/08` § Entity: Person. Used for both groom and bride. */
export interface PersonData {
  full_name?: string | null;
  nickname?: string | null;
  /** A media reference, resolved to a URL by the renderer. */
  photo?: string | null;
  instagram?: string | null;
  father_name?: string | null;
  mother_name?: string | null;
  child_order?: string | null;
}

/** `docs/PLAN/08` § Entity: Event. An invitation has 1..N of these. */
export interface EventData {
  type?: "akad" | "reception" | "custom" | null;
  title?: string | null;
  /** ISO date, `YYYY-MM-DD`. */
  date?: string | null;
  /** `HH:MM` or `HH:MM:SS`. */
  start_time?: string | null;
  end_time?: string | null;
  venue_name?: string | null;
  address?: string | null;
  latitude?: string | number | null;
  longitude?: string | number | null;
  maps_url?: string | null;
  description?: string | null;
}

/** `docs/PLAN/08` § Entity: Photo. */
export interface PhotoData {
  media_id?: string | null;
  caption?: string | null;
  order?: number | null;
  is_cover?: boolean | null;
}

/** `docs/PLAN/08` § Entity: BankAccount. */
export interface GiftAccountData {
  type?: "bank" | "ewallet" | null;
  provider_name?: string | null;
  account_number?: string | null;
  account_holder?: string | null;
  order?: number | null;
}

/** `docs/PLAN/08`: "Quote is a simple entity: { text, source }". */
export interface QuoteData {
  text?: string | null;
  source?: string | null;
}

/**
 * The object every canonical path walks.
 *
 * Assembled by the API from the `invitation_*` tables and sent to the renderer as the
 * public payload (`docs/API/08`). The key names here are the wire names -- snake_case,
 * matching `docs/PLAN/08` and the paths in the registry -- not the camelCase of the
 * Drizzle schema. That mapping happens once, where the query is, rather than being
 * smeared across the renderer.
 */
export interface InvitationData {
  couple?: {
    groom?: PersonData | null;
    bride?: PersonData | null;
  } | null;
  events?: readonly EventData[] | null;
  gallery?: { photos?: readonly PhotoData[] | null } | null;
  gift?: { accounts?: readonly GiftAccountData[] | null } | null;
  quote?: QuoteData | null;
}
