import { Module } from "@nestjs/common";

import { TemplateController } from "./template.controller";
import { TemplateRepository } from "./template.repository";
import { TemplateService } from "./template.service";

/**
 * P2-01 — the catalog module.
 *
 * `TemplateService` is exported because `P5-02`'s admin publish endpoint needs
 * `invalidate()`. A caller wanting a catalog read should not reach for the repository
 * directly: the cache-then-database order is the service's business, and a caller
 * bypassing it would serve data the catalog thinks it has invalidated.
 *
 * **`P2-07` does not use it**, against the expectation recorded here when this module was
 * written. The public invitation joins `template_versions` on the invitation's own
 * `template_version_id` in the same query that finds the invitation. Two reasons: the
 * cache is keyed by slug and semver, neither of which the public endpoint holds without a
 * further join; and BR-3.1 locks an invitation to a version that may since have been
 * deprecated, so the catalog's visibility rules are the wrong question to ask about it.
 */
@Module({
  controllers: [TemplateController],
  providers: [TemplateService, TemplateRepository],
  exports: [TemplateService],
})
export class TemplateModule {}
