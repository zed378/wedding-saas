import { Module } from "@nestjs/common";

import { AuthController } from "./auth.controller";
import { RegistrationService } from "./registration.service";
import { LoginService } from "./login.service";
import { SessionService } from "./session.service";

/**
 * P1-02 and P1-03. `P1-04` adds Google, `P1-05` password reset.
 *
 * `SessionService` is exported because it is how every other module will answer "who is
 * this request from" once `P1-06` turns it into middleware.
 */
@Module({
  controllers: [AuthController],
  providers: [RegistrationService, LoginService, SessionService],
  exports: [RegistrationService, LoginService, SessionService],
})
export class AuthModule {}
