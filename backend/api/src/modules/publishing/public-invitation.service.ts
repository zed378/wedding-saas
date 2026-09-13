import { Inject, Injectable } from "@nestjs/common";

import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env.schema";
import { NotFoundError } from "../../http/errors";
import { PublicInvitationRepository } from "../../shared/tenancy/public-invitation-repository";
import {
  toPublicInvitation,
  type PublicInvitationDto,
} from "./public-invitation.dto";
import { checkSlugFormat } from "../invitation/slug.service";
import {
  hashPreviewToken,
  PREVIEW_TOKEN_PATTERN,
} from "../invitation/preview-link.service";

/**
 * `P2-07` — `GET /public/i/:slug`. `docs/API/08`.
 *
 * ## One 404, whatever the reason
 *
 * `docs/API/08` is explicit that the API must not distinguish "never published" from
 * "intentionally unpublished" from "expired" from "does not exist". This service can
 * hardly do otherwise, because the repository already collapsed them: it returns `null`
 * for all of them and there is nothing left to tell apart.
 *
 * That is deliberate design rather than convenience. `docs/SECURITY/01` names leaking an
 * unpublished invitation as the information-disclosure risk on this surface, and the
 * cheapest way to keep a promise about indistinguishable responses is to destroy the
 * distinction at the query rather than ask every branch after it to preserve one.
 *
 * ## The slug is untrusted
 *
 * `docs/BACKEND/06` § Slug Resolution: *"Normalize and validate the slug shape BEFORE
 * querying (a path segment is untrusted input, and so is a proxy-supplied header — neither
 * is a fact)"*. A slug that cannot be valid is answered without a database round trip,
 * which is also the cheapest possible answer to somebody enumerating addresses.
 */
@Injectable()
export class PublicInvitationService {
  constructor(
    private readonly repository: PublicInvitationRepository,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async bySlug(rawSlug: string): Promise<PublicInvitationDto> {
    const slug = rawSlug.trim().toLowerCase();

    // Shape first, and the same rejection as everything else. A malformed slug is not a
    // different kind of failure to a slug nobody owns -- to the person asking, both mean
    // "there is no invitation here".
    if (checkSlugFormat(slug) !== undefined) throw notFound();

    const found = await this.repository.findPublishedBySlug(slug);
    if (found === null) throw notFound();

    return toPublicInvitation(found, this.env.CDN_BASE_URL);
  }

  /**
   * `P2-12` — `GET /public/preview/:token`. `docs/API/08`, `docs/DATABASE/04`.
   *
   * The same payload as the public invitation, built by the same function, with four things
   * forced regardless of what the invitation's own settings say — each one a line in
   * `docs/DATABASE/04` § Share-Preview Tokens:
   *
   *   - `display.watermark: true` and `display.preview: true` — *"always watermarked"*
   *     (FR-4.3's "PREVIEW — NOT YET PUBLISHED");
   *   - `settings.seo_indexable: false` — *"always `noindex`"*;
   *   - `settings.rsvp_enabled` and `settings.guestbook_enabled: false` — *"submissions are
   *     disabled in preview mode"*.
   *
   * Forced in the payload rather than left to the page to remember. A preview renderer that
   * forgot one flag would publish an unfinished invitation to a search index, and the payload
   * is the one place every future consumer reads.
   *
   * **The same 404 as the slug lookup.** A malformed, unknown, expired or revoked token all
   * answer with `notFound()` — the identical object — so a token cannot be probed for
   * whether it once existed.
   */
  async byPreviewToken(rawToken: string): Promise<PublicInvitationDto> {
    // Shape first: a string that `randomBytes(32).toString("base64url")` cannot produce is
    // answered without hashing or querying anything.
    if (!PREVIEW_TOKEN_PATTERN.test(rawToken)) throw notFound();

    const found = await this.repository.findPreviewByTokenHash(
      hashPreviewToken(rawToken),
    );
    if (found === null) throw notFound();

    const payload = toPublicInvitation(found, this.env.CDN_BASE_URL);

    return {
      ...payload,
      status: "preview",
      display: { watermark: true, preview: true },
      invitation: {
        ...payload.invitation,
        settings: {
          ...payload.invitation.settings,
          seo_indexable: false,
          rsvp_enabled: false,
          guestbook_enabled: false,
        },
      },
    };
  }
}

/**
 * The single 404.
 *
 * A function rather than five `throw`s so that the code and the message are physically
 * the same object in every case. Two call sites that each construct their own are two
 * call sites that can drift apart by a word — and one word is enough to tell an attacker
 * which slugs exist.
 */
function notFound(): NotFoundError {
  return new NotFoundError("Undangan tidak ditemukan.");
}
