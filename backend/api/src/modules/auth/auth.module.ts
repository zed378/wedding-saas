import { Module } from "@nestjs/common";

import { AuthController } from "./auth.controller";
import { RegistrationService } from "./registration.service";
import { LoginService } from "./login.service";
import { SessionService } from "./session.service";
import { GoogleOAuthService } from "./oauth/google-oauth.service";
import {
  createGoogleTokenVerifier,
  GOOGLE_TOKEN_VERIFIER,
} from "./oauth/google-verifier";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env.schema";

/**
 * P1-02, P1-03 and P1-04. `P1-05` adds password reset.
 *
 * `SessionService` is exported because it is how every other module will answer "who is
 * this request from" once `P1-06` turns it into middleware.
 */
@Module({
  controllers: [AuthController],
  providers: [
    RegistrationService,
    LoginService,
    SessionService,
    GoogleOAuthService,
    {
      // A factory, so a test can replace the verifier with one that never reaches the
      // network -- and so the client id is read from validated configuration rather than
      // from `process.env` inside the service.
      provide: GOOGLE_TOKEN_VERIFIER,
      inject: [ENV],
      useFactory: (env: Env) =>
        createGoogleTokenVerifier(env.GOOGLE_OAUTH_CLIENT_ID),
    },
  ],
  exports: [
    RegistrationService,
    LoginService,
    SessionService,
    GoogleOAuthService,
  ],
})
export class AuthModule {}
