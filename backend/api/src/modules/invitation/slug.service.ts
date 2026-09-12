import { Inject, Injectable } from "@nestjs/common";
import { and, eq, isNull, sql } from "drizzle-orm";

import { DB, type Database } from "../../infra/db/client";
import { slugBlocklist } from "../../infra/db/schema/templates";
import { InvitationRepository } from "../../shared/tenancy/invitation-repository";

/**
 * P1-09 — slug validation. `docs/PLAN/10` § Subdomain and `docs/SECURITY/10` § Slug
 * Blocklist.
 *
 * The slug is the invitation's public address — `invitation.vizunicum.my.id/{slug}` today
 * and `{slug}.invitation.…` later (`docs/PLAN/10`). Three separate things can be wrong
 * with one, and they are separate on purpose:
 *
 *   **format** — 3 to 50 characters, `[a-z0-9-]`, no leading or trailing dash;
 *   **blocked** — a reserved system word or profanity, from `slug_blocklist`;
 *   **taken** — another live invitation already has it.
 *
 * The first two are `400` with a field error; the third is `409 SLUG_TAKEN`, because
 * "this is not a valid address" and "somebody got there first" are different problems for
 * the person typing.
 *
 * ## Why the blocklist is a table
 *
 * `docs/SECURITY/10` requires it "managed by admins, updatable without a deploy", and
 * `docs/PLAN/10` § 2 adds a harder reason: **every path segment served on the public host
 * is a reserved slug**, because invitations sit at the root of that host. An unreserved
 * route could shadow a published invitation and take a wedding page offline silently.
 */

/** `docs/PLAN/10`: "3-50 characters, `[a-z0-9-]`, cannot start or end with a dash". */
const SLUG_FORMAT = /^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])?$/;
export const SLUG_MIN_LENGTH = 3;
export const SLUG_MAX_LENGTH = 50;

export type SlugRejection =
  | { readonly kind: "format"; readonly message: string }
  | {
      readonly kind: "blocked";
      readonly term: string;
      readonly message: string;
    }
  | { readonly kind: "taken"; readonly message: string };

/**
 * Basic leetspeak folding, before substring comparison.
 *
 * `docs/DATABASE/12`: "SECURITY/10 also asks for basic leetspeak folding (`4`→`a`, `3`→`e`,
 * `1`→`i`, `0`→`o`) before substring comparison; that normalization happens in the
 * service, not in the query, so the stored term stays readable."
 *
 * Applied only to the **substring** (profanity) pass. Folding before the exact pass would
 * be wrong in a way that is easy to miss: `s0ny` would fold to `sony`, and a couple whose
 * slug is `r0sa-dan-budi` has done nothing but pick a stylised spelling.
 */
export function foldLeet(value: string): string {
  return value
    .replace(/4/g, "a")
    .replace(/3/g, "e")
    .replace(/1/g, "i")
    .replace(/0/g, "o")
    .replace(/5/g, "s")
    .replace(/7/g, "t")
    .replace(/@/g, "a")
    .replace(/\$/g, "s");
}

/** Shape only. No database, so a caller can check a format without a round trip. */
export function checkSlugFormat(slug: string): SlugRejection | undefined {
  if (slug.length < SLUG_MIN_LENGTH || slug.length > SLUG_MAX_LENGTH) {
    return {
      kind: "format",
      message: `Alamat undangan harus ${SLUG_MIN_LENGTH}-${SLUG_MAX_LENGTH} karakter.`,
    };
  }
  if (!SLUG_FORMAT.test(slug)) {
    return {
      kind: "format",
      message:
        "Alamat undangan hanya boleh berisi huruf kecil, angka dan tanda hubung, dan tidak boleh diawali atau diakhiri tanda hubung.",
    };
  }
  return undefined;
}

@Injectable()
export class SlugService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly invitations: InvitationRepository,
  ) {}

  /**
   * Everything that can be wrong with a slug, in the order a user would want to hear it.
   *
   * Returns the **first** problem rather than all of them: a slug has one address and
   * telling somebody it is both badly formatted and taken is noise, since fixing the
   * format changes whether it is taken.
   */
  async check(
    rawSlug: string,
    /**
     * The invitation being renamed, if any. `P1-14`: an invitation keeping its own slug
     * must not be told the slug is taken by itself, which is what an unconditional
     * uniqueness check would say on every settings save that did not change it.
     */
    excludeInvitationId?: string,
  ): Promise<SlugRejection | undefined> {
    const slug = rawSlug.trim();

    // The format check sees the RAW value, so uppercase is rejected rather than
    // normalised away. Lowercasing first would accept `Budi-Dan-Ani` and store an
    // address that does not resolve for the person who typed it.
    const format = checkSlugFormat(slug);
    if (format !== undefined) return format;

    const blocked = await this.findBlockingTerm(slug);
    if (blocked !== undefined) {
      return {
        kind: "blocked",
        term: blocked,
        message: "Alamat undangan ini tidak dapat digunakan.",
      };
    }

    if (await this.isTaken(slug, excludeInvitationId)) {
      return {
        kind: "taken",
        message: "Alamat undangan ini sudah digunakan.",
      };
    }

    return undefined;
  }

  /**
   * The blocklist term that rejects this slug, if any.
   *
   * Two passes with different semantics, exactly as `docs/DATABASE/12` § Match Semantics
   * describes:
   *
   *   **exact** — the whole slug equals the term. Reserved words only. Matching these as
   *     substrings would reject `sandi-april` for containing `api`, and a couple named
   *     Aprilia should not lose their address to a routing concern.
   *   **substring** — the term appears anywhere, after leetspeak folding. Profanity, where
   *     evasion by padding is the whole point.
   */
  async findBlockingTerm(slug: string): Promise<string | undefined> {
    const normalised = slug.trim().toLowerCase();

    const [exact] = await this.db
      .select({ term: slugBlocklist.term })
      .from(slugBlocklist)
      .where(
        and(
          eq(slugBlocklist.matchType, "exact"),
          sql`lower(${slugBlocklist.term}) = ${normalised}`,
        ),
      )
      .limit(1);

    if (exact !== undefined) return exact.term;

    // The folded form is compared, the stored term is not -- so `slug_blocklist` stays
    // readable to whoever maintains it.
    const folded = foldLeet(normalised);

    const substrings = await this.db
      .select({ term: slugBlocklist.term })
      .from(slugBlocklist)
      .where(eq(slugBlocklist.matchType, "substring"));

    // In application code rather than SQL, because the folding is applied to the SLUG and
    // a `LIKE` would have to fold the column instead -- which would mean storing folded
    // terms and losing the readability the document asks for.
    return substrings.find((row) =>
      folded.includes(foldLeet(row.term.toLowerCase())),
    )?.term;
  }

  /**
   * Whether a live invitation already holds this slug.
   *
   * Delegated to `InvitationRepository`, which is where every `invitations` query lives.
   * This is the one read in that file with no owner predicate -- the slug is a global
   * public namespace -- and it carries the paragraph explaining why there, rather than
   * here where it would look unremarkable.
   */
  async isTaken(slug: string, excludeInvitationId?: string): Promise<boolean> {
    return this.invitations.slugTaken(slug, excludeInvitationId);
  }
}
