import { Module } from "@nestjs/common";

import { TemplateController } from "./template.controller";
import { TemplateRepository } from "./template.repository";
import { TemplateService } from "./template.service";

/**
 * P2-01 — the catalog module.
 *
 * `TemplateService` is exported because `P5-02`'s admin publish endpoint needs
 * `invalidate()`, and because `P2-07`'s public invitation API resolves a locked
 * `template_version_id` through the same cached reads. Neither should reach for the
 * repository directly: the cache-then-database order is the service's business, and a
 * caller bypassing it would serve data the catalog thinks it has invalidated.
 */
@Module({
  controllers: [TemplateController],
  providers: [TemplateService, TemplateRepository],
  exports: [TemplateService],
})
export class TemplateModule {}
