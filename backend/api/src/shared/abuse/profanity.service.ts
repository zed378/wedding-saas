import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";

import { DB, type Database } from "../../infra/db/client";
import { slugBlocklist } from "../../infra/db/schema/templates";
import { foldLeet } from "../../modules/invitation/slug.service";
import { metrics } from "../metrics/metrics";

/**
 * P4-05 — Profanity detection for free-text guestbook/RSVP content.
 * Checks against profanity terms in `slug_blocklist` with leetspeak normalization.
 */
@Injectable()
export class ProfanityService {
  private cachedTerms: string[] | null = null;
  private cacheExpiresAt = 0;
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * Check whether input text contains blocked profanity.
   * If detected and a surface is provided, increments abuseProfanityFlagged metric.
   */
  async containsProfanity(
    text: string | null | undefined,
    surface?: "guestbook" | "rsvp",
  ): Promise<boolean> {
    if (!text || !text.trim()) return false;

    const terms = await this.getProfanityTerms();
    if (terms.length === 0) return false;

    const folded = foldLeet(text.toLowerCase());

    const hasMatch = terms.some((term) => folded.includes(term));
    if (hasMatch && surface) {
      metrics.abuseProfanityFlagged.inc({ surface });
    }

    return hasMatch;
  }

  /**
   * Retrieves and caches normalized profanity terms from the blocklist table.
   */
  private async getProfanityTerms(): Promise<string[]> {
    const now = Date.now();
    if (this.cachedTerms !== null && now < this.cacheExpiresAt) {
      return this.cachedTerms;
    }

    const rows = await this.db
      .select({ term: slugBlocklist.term })
      .from(slugBlocklist)
      .where(eq(slugBlocklist.category, "profanity"));

    const normalized = rows
      .map((r) => foldLeet(r.term.trim().toLowerCase()))
      .filter((t) => t.length > 0);

    this.cachedTerms = normalized;
    this.cacheExpiresAt = now + this.CACHE_TTL_MS;

    return this.cachedTerms;
  }

  /** Clears cache for tests or after admin blocklist updates. */
  clearCache(): void {
    this.cachedTerms = null;
    this.cacheExpiresAt = 0;
  }
}
