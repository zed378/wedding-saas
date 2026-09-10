import { Controller, Get } from "@nestjs/common";
import { SURFACE } from "../../http/surfaces";
import { ReferenceService } from "./reference.service";

/** Authenticated surface. From P1-06 this carries the auth guard. */
@Controller(`${SURFACE.AUTHENTICATED}/_reference`)
export class ReferenceController {
  constructor(private readonly service: ReferenceService) {}

  @Get()
  get() {
    return { surface: SURFACE.AUTHENTICATED, ...this.service.describe() };
  }
}

/** Anonymous surface. Aggressively rate limited and cached (P1-07, P3-12). */
@Controller(`${SURFACE.PUBLIC}/_reference`)
export class ReferencePublicController {
  constructor(private readonly service: ReferenceService) {}

  @Get()
  get() {
    return { surface: SURFACE.PUBLIC, ...this.service.describe() };
  }
}

/** Provider-to-server. Signature-verified, no user session (P3-05). */
@Controller(`${SURFACE.WEBHOOK}/_reference`)
export class ReferenceWebhookController {
  constructor(private readonly service: ReferenceService) {}

  @Get()
  get() {
    return { surface: SURFACE.WEBHOOK, ...this.service.describe() };
  }
}
