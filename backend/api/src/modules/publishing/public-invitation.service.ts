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
