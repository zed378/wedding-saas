import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { TenancyModule } from "../../shared/tenancy/tenancy.module";
import { UserController } from "./user.controller";
import { UserService } from "./user.service";

/**
 * P1-08. `AuthModule` is imported for `SessionService`, which `requireAuth()` injects.
 */
@Module({
  imports: [AuthModule, TenancyModule],
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
