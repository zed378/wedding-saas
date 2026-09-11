import { Module } from "@nestjs/common";

import { AuthController } from "./auth.controller";
import { RegistrationService } from "./registration.service";

/**
 * P1-02. `P1-03` adds login and refresh, `P1-04` Google, `P1-05` password reset.
 */
@Module({
  controllers: [AuthController],
  providers: [RegistrationService],
  exports: [RegistrationService],
})
export class AuthModule {}
