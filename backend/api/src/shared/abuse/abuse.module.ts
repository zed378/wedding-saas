import { Global, Module } from "@nestjs/common";

import { DatabaseModule } from "../../infra/db/client";
import { RateLimitModule } from "../rate-limit/rate-limit.module";
import { TurnstileService } from "./turnstile.service";
import { ProfanityService } from "./profanity.service";
import { AbuseProtectionService } from "./abuse-protection.service";

@Global()
@Module({
  imports: [DatabaseModule, RateLimitModule],
  providers: [TurnstileService, ProfanityService, AbuseProtectionService],
  exports: [TurnstileService, ProfanityService, AbuseProtectionService],
})
export class AbuseModule {}
