import { Controller, Get, Param, UseGuards } from "@nestjs/common";

import { ok } from "../../http/envelope";
import { rateLimit } from "../../shared/rate-limit/rate-limit.guard";
import { PublicInvitationService } from "./public-invitation.service";

/**
 * `P2-07` — the public invitation. `docs/API/08`.
 *
 * ## Not under `/api/v1`, on purpose
 *
 * `docs/API/08` opens by saying these routes are *"kept separate from `/api/v1/*` to make
 * caching & policy differences easier"*. This is the one route in the product that serves
 * user data to anybody who asks, and having it on its own prefix means a cache rule, a
 * WAF rule or a rate-limit policy can address it without an exception carved out of the
 * authenticated API's own rules.
 *
 * ## No authentication, and therefore no ownership check
 *
 * A reviewer grepping this file for `requireOwnership` will find nothing, and should stop
 * there rather than wonder. The check that replaces it is in the repository: the query
 * carries `status = 'published' AND deleted_at IS NULL`, so an invitation that is not
 * currently public cannot be selected at all. See
 * `shared/tenancy/public-invitation-repository.ts`, which exists as its own file for
 * exactly this reason.
 *
 * ## Rate limited as a public route
 *
 * `general-public`, keyed on a hashed IP — there is no session to key on, and
 * `docs/SECURITY/09` forbids storing a guest's address in the clear. The limit is also
 * the only control against somebody walking the slug space to find unpublished
 * invitations, which is why the 404 path is answered without a database round trip when
 * the slug cannot be valid.
 */
@Controller("public/i")
@UseGuards(rateLimit("general-public"))
export class PublicInvitationController {
  constructor(private readonly service: PublicInvitationService) {}

  /**
   * Everything a guest needs to render this invitation.
   *
   * No query parameters are read. `?to=Nama` personalization is handled on the frontend
   * (`docs/API/08` § Caching) and reading it here would make the response vary per
   * visitor, which is the one thing that would stop it being cacheable at the edge.
   */
  @Get(":slug")
  async bySlug(@Param("slug") slug: string) {
    return ok(await this.service.bySlug(slug));
  }
}
