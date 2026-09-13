import { Controller, Get, Header, Param, UseGuards } from "@nestjs/common";

import { ok } from "../../http/envelope";
import { rateLimit } from "../../shared/rate-limit/rate-limit.guard";
import { PublicInvitationService } from "./public-invitation.service";

/**
 * `P2-12` — `GET /public/preview/:token`. `docs/API/08`, `docs/DATABASE/04`.
 *
 * Its own controller on its own prefix, as `docs/API/08` lists it, rather than a route under
 * `public/i`: a preview is addressed by a secret, not by a public name, and a cache or WAF
 * rule written for `/public/i/*` must never apply to it by accident.
 *
 * ## Never cached, anywhere
 *
 * `Cache-Control: private, no-store`. The response is an unpublished invitation keyed by a
 * credential in the URL. A shared cache holding it would serve somebody's draft to anyone who
 * reached the same edge node with the same path, and would keep serving it after the owner
 * revoked the link — revocation has to take effect on the next request.
 *
 * ## `noindex` in the header as well as the page
 *
 * `X-Robots-Tag` covers the API response itself, which a crawler could reach if a preview URL
 * leaked into a public page. The page carries the meta tag; this carries the header.
 *
 * ## Rate limited on the public policy
 *
 * A 256-bit token cannot be guessed, so the limit is not what protects the token — it is what
 * stops the resolve route being used to generate load.
 */
@Controller("public/preview")
@UseGuards(rateLimit("general-public"))
export class PublicPreviewController {
  constructor(private readonly service: PublicInvitationService) {}

  @Get(":token")
  @Header("Cache-Control", "private, no-store")
  @Header("X-Robots-Tag", "noindex, nofollow")
  async byToken(@Param("token") token: string) {
    return ok(await this.service.byPreviewToken(token));
  }
}
