import { Module } from "@nestjs/common";
import {
  ReferenceController,
  ReferencePublicController,
  ReferenceWebhookController,
} from "./reference.controller";
import { ReferenceRepository } from "./reference.repository";
import { ReferenceService } from "./reference.service";

/**
 * Registered only outside production (see AppModule). A reference endpoint on a live
 * public host is an unnecessary surface, however harmless its payload.
 */
@Module({
  controllers: [
    ReferenceController,
    ReferencePublicController,
    ReferenceWebhookController,
  ],
  providers: [ReferenceService, ReferenceRepository],
})
export class ReferenceModule {}
