import {
  Controller,
  Get,
  Header,
  Param,
  Query,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";

import { ok } from "../../http/envelope";
import { ValidationError } from "../../http/errors";
import { rateLimit } from "../../shared/rate-limit/rate-limit.guard";
import { REGION_CODE } from "./region-geometry";
import { RegionsService } from "./regions.service";

/**
 * `P2-17` — `GET /api/v1/regions`. `MEMORY/specs/P2-17-regions.md` § API Contract.
 *
 * Public reference data: no session, no tenant, the same answer for everyone — so a shared cache
 * may hold it for a day. Every code is checked for shape before it reaches a query.
 *
 * `locate` is declared before `:code`: Nest matches in declaration order, and a literal under a
 * parameter would otherwise be read as a code (`P1-21`).
 */

const codeSchema = z.string().regex(REGION_CODE, "Kode wilayah tidak valid.");

const listQuerySchema = z.object({ parent: codeSchema.optional() }).strict();

const locateQuerySchema = z
  .object({
    latitude: z.coerce.number().min(-90).max(90),
    longitude: z.coerce.number().min(-180).max(180),
  })
  .strict();

@Controller("api/v1/regions")
@UseGuards(rateLimit("general-public"))
export class RegionsController {
  constructor(private readonly regions: RegionsService) {}

  @Get()
  @Header("Cache-Control", "public, max-age=86400")
  async list(@Query() query: Record<string, unknown>) {
    const { parent } = parse(listQuerySchema, query);
    return ok(await this.regions.list(parent));
  }

  @Get("locate")
  @Header("Cache-Control", "public, max-age=86400")
  async locate(@Query() query: Record<string, unknown>) {
    const { latitude, longitude } = parse(locateQuerySchema, query);
    return ok(await this.regions.locate(latitude, longitude));
  }

  @Get(":code")
  @Header("Cache-Control", "public, max-age=86400")
  async detail(@Param("code") code: string) {
    return ok(await this.regions.detail(parse(codeSchema, code)));
  }
}

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;

  throw new ValidationError(
    result.error.issues.map((issue) => ({
      field: issue.path.join(".") || "query",
      message: issue.message,
    })),
  );
}
