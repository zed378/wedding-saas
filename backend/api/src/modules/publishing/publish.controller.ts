import {
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";

import { ok } from "../../http/envelope";
import { ValidationError } from "../../http/errors";
import {
  CurrentUserParam,
  requireAuth,
  type CurrentUser,
} from "../../shared/auth-middleware";
import { rateLimit } from "../../shared/rate-limit";
import { PublishService } from "./publish.service";

/** `P3-09` — `POST /invitations/:id/publish`. The body is empty: nothing about publishing is the client's to choose. */
const emptyBody = z.object({}).strict();

@Controller("api/v1/invitations")
@UseGuards(requireAuth())
export class PublishController {
  constructor(private readonly publishing: PublishService) {}

  @Post(":id/publish")
  @HttpCode(200)
  @UseGuards(rateLimit("general-authenticated"))
  async publish(
    @CurrentUserParam() user: CurrentUser,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const parsed = emptyBody.safeParse(body ?? {});
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues.map((issue) => ({
          field: issue.path.join(".") || "body",
          message: issue.message,
        })),
      );
    }
    return ok(await this.publishing.publish(user, id));
  }
}
