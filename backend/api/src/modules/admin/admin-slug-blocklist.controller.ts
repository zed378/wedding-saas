import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { ok } from "../../http/envelope";
import { ValidationError } from "../../http/errors";
import { currentUser } from "../../shared/auth-middleware/current-user";
import { requireAuth, requireRole } from "../../shared/auth-middleware/guards";
import { rateLimit } from "../../shared/rate-limit/rate-limit.guard";
import { AdminSlugBlocklistService } from "./admin-slug-blocklist.service";
import {
  slugBlocklistDeleteSchema,
  slugBlocklistQuerySchema,
  slugBlocklistTestSchema,
  slugBlocklistWriteSchema,
} from "./schemas/admin-slug-blocklist.schema";

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new ValidationError(
    result.error.issues.map((issue) => ({
      field: issue.path.join(".") || "body",
      message: issue.message,
    })),
  );
}

@Controller("api/v1/admin/slug-blocklist")
@UseGuards(
  requireAuth(),
  requireRole("admin", "super_admin"),
  rateLimit("general-authenticated"),
)
export class AdminSlugBlocklistController {
  constructor(private readonly blocklist: AdminSlugBlocklistService) {}
  @Get()
  async list(@Query() query: unknown) {
    const { page, per_page } = parse(slugBlocklistQuerySchema, query);
    const result = await this.blocklist.list(page, per_page);
    return ok(result.data, result.meta);
  }
  @Post("test")
  @HttpCode(200)
  async test(@Body() body: unknown) {
    return ok(
      await this.blocklist.test(parse(slugBlocklistTestSchema, body).slug),
    );
  }
  @Post()
  @HttpCode(201)
  async create(@Req() req: Request, @Body() body: unknown) {
    return ok(
      await this.blocklist.save(
        currentUser(req).id,
        parse(slugBlocklistWriteSchema, body),
      ),
    );
  }
  @Patch(":id")
  async update(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return ok(
      await this.blocklist.save(
        currentUser(req).id,
        parse(slugBlocklistWriteSchema, body),
        parse(z.uuid(), id),
      ),
    );
  }
  @Delete(":id")
  async remove(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return ok(
      await this.blocklist.remove(
        currentUser(req).id,
        parse(z.uuid(), id),
        parse(slugBlocklistDeleteSchema, body).reason,
      ),
    );
  }
}
