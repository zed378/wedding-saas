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
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";

import { ok } from "../../http/envelope";
import { pageMeta, parsePagination } from "../../http/pagination";
import { NotFoundError, ValidationError } from "../../http/errors";
import {
  CurrentUserParam,
  requireAuth,
  type CurrentUser,
} from "../../shared/auth-middleware";
import { rateLimit } from "../../shared/rate-limit";
import { requireVerifiedEmail } from "../auth/require-verified-email";
import { InvitationCreateService } from "./invitation-create.service";
import { InvitationService } from "./invitation.service";
import { CoupleService, type PersonRole } from "./couple.service";
import { SLUG_MAX_LENGTH, SLUG_MIN_LENGTH } from "./slug.service";
import { sanitizeFields } from "../../shared/sanitizer/sanitize";
import { TEXT_FIELDS } from "../../shared/sanitizer/registry";

/**
 * P1-09 — `POST /invitations`. `docs/API/04`.
 *
 * ## `owner_id` is not a field
 *
 * `docs/SECURITY/05` § 3 lists "owner_id supplied in the body" as an abuse case. The schema
 * is `.strict()` and has three fields; an `owner_id` sent alongside does not survive
 * parsing, and the service takes the owner from `CurrentUser.scope`. There is nothing to
 * ignore because there is nothing to read.
 *
 * ## An unverified user may create a draft
 *
 * `docs/API/01` § Registration Flow step 2 is explicit that verification gates **publish
 * and checkout**, not drafting. So no `requireVerifiedEmail` here -- it belongs on `P3-01`
 * and `P3-06`, where `P1-02` recorded the obligation.
 */

/**
 * `PATCH /invitations/:id`. ONE field.
 *
 * `status`, `owner_id`, `published_at`, `expiry_date` and `template_version_id` are absent
 * on purpose and `.strict()` turns each of them into a 400 rather than a silent drop:
 *
 *   `status` moves only through `InvitationStatusService`, and
 *     `scripts/check-status-writes.mjs` fails the build on any other writer;
 *   `template_version_id` is locked at creation by BR-3.1, and a client that could set it
 *     could pin an invitation to a draft version and bypass BR-3.3;
 *   `published_at` and `expiry_date` are consequences of publishing and paying, not
 *     inputs.
 */
const updateSchema = z
  .object({ internal_name: z.string().trim().min(1).max(150) })
  .strict();

/**
 * `PATCH /invitations/:id/couple/{groom,bride}`. `docs/PLAN/08` § Person, field for field.
 *
 * `role` is NOT a body field -- it comes from the path, so a client cannot rename the
 * groom into the bride by sending one. Every optional field accepts `null` to clear it,
 * except the two the document marks required, which can be emptied to `""` but not
 * removed: `P1-09` created them as `""` and the column is `NOT NULL`.
 *
 * Lengths are `docs/DATABASE/05`'s column widths.
 */
const personSchema = z
  .object({
    full_name: z.string().trim().max(150).optional(),
    nickname: z.string().trim().max(60).optional(),
    photo_media_id: z.union([z.uuid(), z.null()]).optional(),
    instagram: z.union([z.string().trim().max(60), z.null()]).optional(),
    father_name: z.union([z.string().trim().max(150), z.null()]).optional(),
    mother_name: z.union([z.string().trim().max(150), z.null()]).optional(),
    child_order: z.union([z.string().trim().max(60), z.null()]).optional(),
  })
  .strict();

const listQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).optional(),
    per_page: z.coerce.number().int().min(1).max(100).optional(),
    status: z
      .enum(["draft", "pending_payment", "paid", "published", "expired"])
      .optional(),
  })
  .strict();

const createSchema = z
  .object({
    template_id: z.uuid(),
    internal_name: z.string().trim().min(1).max(150),
    // Optional. A draft has no address until the user picks one.
    slug: z
      .string()
      .trim()
      .min(SLUG_MIN_LENGTH)
      .max(SLUG_MAX_LENGTH)
      .optional(),
  })
  .strict();

/**
 * Validate, then sanitize. `docs/BACKEND/03` puts them in that order, and it matters:
 * sanitizing first would let a payload change a value's LENGTH after the length check.
 */
function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (result.success) {
    return typeof result.data === "object" && result.data !== null
      ? (sanitizeFields(
          result.data as Record<string, unknown>,
          TEXT_FIELDS,
        ) as T)
      : result.data;
  }

  throw new ValidationError(
    result.error.issues.map((issue) => ({
      field: issue.path.join(".") || "body",
      message: issue.message,
    })),
  );
}

@Controller("api/v1/invitations")
@UseGuards(requireAuth())
export class InvitationController {
  constructor(
    private readonly create: InvitationCreateService,
    private readonly invitations: InvitationService,
    private readonly couple: CoupleService,
  ) {}

  /**
   * Create an invitation and its whole aggregate.
   *
   * Rate limited at 10/day per user (`docs/SECURITY/10`), which `docs/PLAN/18` R7 asks for
   * as a slug-squatting backstop. BR-1.4's free-draft quota makes it hard to reach; it
   * stays because the quota is a product rule and this is an abuse control, and the two
   * would not necessarily move together.
   */
  @Post()
  @HttpCode(201)
  @UseGuards(rateLimit("invitation-create"))
  async createInvitation(
    @CurrentUserParam() user: CurrentUser,
    @Body() body: unknown,
  ) {
    const input = parse(createSchema, body);

    const invitation = await this.create.create(user.scope, {
      templateId: input.template_id,
      internalName: input.internal_name,
      slug: input.slug,
    });

    return ok({
      id: invitation.id,
      slug: invitation.slug,
      status: invitation.status,
      template_id: invitation.templateId,
      template_version_id: invitation.templateVersionId,
    });
  }

  /**
   * The caller's invitations, paginated.
   *
   * The owner filter is in the SQL (`InvitationRepository.findOwnedList`).
   * `docs/SECURITY/05` § 5 names response-level filtering as the wrong implementation: it
   * works until a `.filter()` is dropped in a refactor, and then it leaks every tenant at
   * once through an endpoint that still looks correct.
   */
  @Get()
  async listInvitations(
    @CurrentUserParam() user: CurrentUser,
    @Query() query: Record<string, unknown>,
  ) {
    const parsed = parse(listQuerySchema, query);
    const pagination = parsePagination({
      ...(parsed.page !== undefined ? { page: parsed.page } : {}),
      ...(parsed.per_page !== undefined ? { per_page: parsed.per_page } : {}),
    });

    const { items, total } = await this.invitations.list(user.scope, {
      limit: pagination.perPage,
      offset: pagination.offset,
      status: parsed.status,
    });

    return ok(items, pageMeta(pagination, total));
  }

  /** The full aggregate. `docs/API/04` § Example Response. */
  @Get(":id")
  async getInvitation(
    @CurrentUserParam() user: CurrentUser,
    @Param("id") id: string,
  ) {
    return ok(await this.invitations.detail(user.scope, id));
  }

  /** Partial update. `internal_name` is the only writable field — see `updateSchema`. */
  @Patch(":id")
  async updateInvitation(
    @CurrentUserParam() user: CurrentUser,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const input = parse(updateSchema, body);

    return ok(
      await this.invitations.update(user.scope, id, {
        internalName: input.internal_name,
      }),
    );
  }

  /**
   * Soft delete.
   *
   * 200 with a body rather than 204, because the response says the slug is released —
   * which is the part a user is most likely to be surprised by, in either direction.
   */
  @Delete(":id")
  @HttpCode(200)
  async deleteInvitation(
    @CurrentUserParam() user: CurrentUser,
    @Param("id") id: string,
  ) {
    await this.invitations.softDelete(user.scope, id);

    return ok({
      status: "deleted",
      message:
        "Undangan telah dihapus. Alamat undangannya kini dapat digunakan kembali.",
    });
  }

  /**
   * `docs/API/04` § Couple/Person.
   *
   * Two routes rather than one with a `role` body field, exactly as the document writes
   * them. The role is in the path, so it cannot be tampered with independently of the
   * resource being addressed.
   */
  @Patch(":id/couple/:role")
  async updateCouple(
    @CurrentUserParam() user: CurrentUser,
    @Param("id") id: string,
    @Param("role") role: string,
    @Body() body: unknown,
  ) {
    if (role !== "groom" && role !== "bride") {
      // A 404 rather than a 400: `/couple/spouse` is not a route that exists, and saying
      // so as a validation error would imply it might.
      throw new NotFoundError();
    }

    const input = parse(personSchema, body);

    const person = await this.couple.update(
      user.scope,
      id,
      role as PersonRole,
      {
        ...(input.full_name !== undefined ? { fullName: input.full_name } : {}),
        ...(input.nickname !== undefined ? { nickname: input.nickname } : {}),
        ...(input.photo_media_id !== undefined
          ? { photoMediaId: input.photo_media_id }
          : {}),
        ...(input.instagram !== undefined
          ? { instagram: input.instagram }
          : {}),
        ...(input.father_name !== undefined
          ? { fatherName: input.father_name }
          : {}),
        ...(input.mother_name !== undefined
          ? { motherName: input.mother_name }
          : {}),
        ...(input.child_order !== undefined
          ? { childOrder: input.child_order }
          : {}),
      },
    );

    return ok(person);
  }
}
