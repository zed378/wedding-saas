import { Body, Controller, HttpCode, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";

import { ok } from "../../http/envelope";
import { ValidationError } from "../../http/errors";
import {
  CurrentUserParam,
  requireAuth,
  type CurrentUser,
} from "../../shared/auth-middleware";
import { rateLimit } from "../../shared/rate-limit";
import { requireVerifiedEmail } from "../auth/require-verified-email";
import { InvitationCreateService } from "./invitation-create.service";
import { SLUG_MAX_LENGTH, SLUG_MIN_LENGTH } from "./slug.service";

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

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (result.success) return result.data;

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
  constructor(private readonly create: InvitationCreateService) {}

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
}
