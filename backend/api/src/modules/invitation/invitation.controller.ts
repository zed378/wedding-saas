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
import { EventsService } from "./events.service";
import { GiftService, QuoteService } from "./gift.service";
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

/**
 * `docs/BACKEND/03` § Example Structural Schema, transcribed — it is the one place in the
 * documents that writes a request schema out in full, so this follows it field for field
 * rather than paraphrasing.
 *
 * Two additions it does not name, both bounded by `docs/DATABASE/05`'s column widths:
 * `maps_url` (so a user can supply their own link instead of the generated one) and
 * `display_order`.
 *
 * The coordinate range checks are the card's third DoD item. A latitude of 200 is not a
 * place, and it would render as a map pin somewhere undefined rather than as an error.
 */
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const eventBase = {
  type: z.enum(["akad", "reception", "custom"]),
  title: z.string().trim().min(1).max(150),
  event_date: z.string().date(),
  start_time: z.string().regex(TIME, "Gunakan format HH:MM."),
  end_time: z
    .union([z.string().regex(TIME, "Gunakan format HH:MM."), z.null()])
    .optional(),
  venue_name: z.string().trim().min(1).max(200),
  address: z.string().trim().min(1).max(2000),
  latitude: z.union([z.coerce.number().min(-90).max(90), z.null()]).optional(),
  longitude: z
    .union([z.coerce.number().min(-180).max(180), z.null()])
    .optional(),
  // `z.url()` is NOT enough here, and this is measured rather than assumed: it accepts
  // `javascript:alert(1)`, `JaVaScRiPt:...` and `data:text/html,...` -- all of which parse
  // as valid URLs. `maps_url` becomes an `href` on the public page, so accepting any of
  // them would be stored XSS with a link the guest chooses to click.
  //
  // A scheme allowlist, applied before `z.url()` so a malformed https URL still fails the
  // parser. `docs/SECURITY/08` requires allowlist over blacklist, and "http or https" is
  // the whole allowlist a maps link needs.
  maps_url: z
    .union([
      z
        .string()
        .trim()
        .regex(
          /^https?:\/\//i,
          "Tautan peta harus dimulai dengan http:// atau https://",
        )
        .url()
        .max(500),
      z.null(),
    ])
    .optional(),
  description: z.union([z.string().trim().max(2000), z.null()]).optional(),
  display_order: z.coerce.number().int().min(0).max(9999).optional(),
};

const createEventSchema = z.object(eventBase).strict();

/** Every field optional, and `.strict()` still refuses anything not listed. */
const updateEventSchema = z
  .object({
    type: eventBase.type.optional(),
    title: eventBase.title.optional(),
    event_date: eventBase.event_date.optional(),
    start_time: eventBase.start_time.optional(),
    end_time: eventBase.end_time,
    venue_name: eventBase.venue_name.optional(),
    address: eventBase.address.optional(),
    latitude: eventBase.latitude,
    longitude: eventBase.longitude,
    maps_url: eventBase.maps_url,
    description: eventBase.description,
    display_order: eventBase.display_order,
  })
  .strict();

/**
 * Gift accounts. `docs/DATABASE/06` column widths, `docs/API/04` § Bank Accounts.
 *
 * `account_number` is validated by **format**, not sanitized as prose — digits, spaces and
 * hyphens only. `P1-16`'s registry exempts it with that reason, and this is the check that
 * exemption promised: tag stripping would silently alter a value whose exact characters
 * matter, while a character allowlist makes markup impossible in the first place.
 */
const ACCOUNT_NUMBER = /^[0-9][0-9 -]{3,58}[0-9]$/;

const bankAccountBase = {
  type: z.enum(["bank", "ewallet"]),
  provider_name: z.string().trim().min(1).max(60),
  account_number: z
    .string()
    .trim()
    .regex(
      ACCOUNT_NUMBER,
      "Nomor rekening hanya boleh berisi angka, spasi dan tanda hubung.",
    )
    .max(60),
  account_holder: z.string().trim().min(1).max(150),
  display_order: z.coerce.number().int().min(0).max(9999).optional(),
};

const createBankAccountSchema = z.object(bankAccountBase).strict();

const updateBankAccountSchema = z
  .object({
    type: bankAccountBase.type.optional(),
    provider_name: bankAccountBase.provider_name.optional(),
    account_number: bankAccountBase.account_number.optional(),
    account_holder: bankAccountBase.account_holder.optional(),
    display_order: bankAccountBase.display_order,
  })
  .strict();

/** `docs/PLAN/08`: "Quote is a simple entity: `{ text, source|null }`." */
const quoteSchema = z
  .object({
    text: z.union([z.string().trim().max(2000), z.null()]).optional(),
    source: z.union([z.string().trim().max(200), z.null()]).optional(),
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

/**
 * A coordinate for storage.
 *
 * The schema coerces to a number so the range check is arithmetic rather than lexical
 * (`"200"` must fail, and `"200" > "90"` is false as a string). `DECIMAL(9,6)` comes back
 * from Drizzle as a string, so it goes in as one — and `String(number)` is exact here
 * because six decimal places is well inside a double's precision.
 */
function coordinate(
  value: number | null | undefined,
): string | null | undefined {
  if (value === undefined) return undefined;
  return value === null ? null : String(value);
}

@Controller("api/v1/invitations")
@UseGuards(requireAuth())
export class InvitationController {
  constructor(
    private readonly create: InvitationCreateService,
    private readonly invitations: InvitationService,
    private readonly couple: CoupleService,
    private readonly events: EventsService,
    private readonly gift: GiftService,
    private readonly quote: QuoteService,
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

  /** `docs/API/04` § Events. */
  @Get(":id/events")
  async listEvents(
    @CurrentUserParam() user: CurrentUser,
    @Param("id") id: string,
  ) {
    return ok(await this.events.list(user.scope, id));
  }

  @Post(":id/events")
  @HttpCode(201)
  async createEvent(
    @CurrentUserParam() user: CurrentUser,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const input = parse(createEventSchema, body);

    return ok(
      await this.events.create(user.scope, id, {
        type: input.type,
        title: input.title,
        eventDate: input.event_date,
        startTime: input.start_time,
        ...(input.end_time !== undefined ? { endTime: input.end_time } : {}),
        venueName: input.venue_name,
        address: input.address,
        ...(input.latitude !== undefined
          ? { latitude: coordinate(input.latitude) }
          : {}),
        ...(input.longitude !== undefined
          ? { longitude: coordinate(input.longitude) }
          : {}),
        ...(input.maps_url !== undefined ? { mapsUrl: input.maps_url } : {}),
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
        ...(input.display_order !== undefined
          ? { displayOrder: input.display_order }
          : {}),
      }),
    );
  }

  /**
   * `:event_id` is scoped by `:id` in the query, not checked afterwards.
   * `docs/SECURITY/05` § 7 — see `EventsService`.
   */
  @Patch(":id/events/:eventId")
  async updateEvent(
    @CurrentUserParam() user: CurrentUser,
    @Param("id") id: string,
    @Param("eventId") eventId: string,
    @Body() body: unknown,
  ) {
    const input = parse(updateEventSchema, body);

    return ok(
      await this.events.update(user.scope, id, eventId, {
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.event_date !== undefined
          ? { eventDate: input.event_date }
          : {}),
        ...(input.start_time !== undefined
          ? { startTime: input.start_time }
          : {}),
        ...(input.end_time !== undefined ? { endTime: input.end_time } : {}),
        ...(input.venue_name !== undefined
          ? { venueName: input.venue_name }
          : {}),
        ...(input.address !== undefined ? { address: input.address } : {}),
        ...(input.latitude !== undefined
          ? { latitude: coordinate(input.latitude) }
          : {}),
        ...(input.longitude !== undefined
          ? { longitude: coordinate(input.longitude) }
          : {}),
        ...(input.maps_url !== undefined ? { mapsUrl: input.maps_url } : {}),
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
        ...(input.display_order !== undefined
          ? { displayOrder: input.display_order }
          : {}),
      }),
    );
  }

  @Delete(":id/events/:eventId")
  @HttpCode(200)
  async deleteEvent(
    @CurrentUserParam() user: CurrentUser,
    @Param("id") id: string,
    @Param("eventId") eventId: string,
  ) {
    await this.events.remove(user.scope, id, eventId);

    return ok({ status: "deleted" });
  }

  // ------------------------------------------------------------ gift accounts

  @Get(":id/bank-accounts")
  async listBankAccounts(
    @CurrentUserParam() user: CurrentUser,
    @Param("id") id: string,
  ) {
    return ok(await this.gift.list(user.scope, id));
  }

  @Post(":id/bank-accounts")
  @HttpCode(201)
  async createBankAccount(
    @CurrentUserParam() user: CurrentUser,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const input = parse(createBankAccountSchema, body);

    return ok(
      await this.gift.create(user.scope, id, {
        type: input.type,
        providerName: input.provider_name,
        accountNumber: input.account_number,
        accountHolder: input.account_holder,
        ...(input.display_order !== undefined
          ? { displayOrder: input.display_order }
          : {}),
      }),
    );
  }

  @Patch(":id/bank-accounts/:bankAccountId")
  async updateBankAccount(
    @CurrentUserParam() user: CurrentUser,
    @Param("id") id: string,
    @Param("bankAccountId") bankAccountId: string,
    @Body() body: unknown,
  ) {
    const input = parse(updateBankAccountSchema, body);

    return ok(
      await this.gift.update(user.scope, id, bankAccountId, {
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.provider_name !== undefined
          ? { providerName: input.provider_name }
          : {}),
        ...(input.account_number !== undefined
          ? { accountNumber: input.account_number }
          : {}),
        ...(input.account_holder !== undefined
          ? { accountHolder: input.account_holder }
          : {}),
        ...(input.display_order !== undefined
          ? { displayOrder: input.display_order }
          : {}),
      }),
    );
  }

  @Delete(":id/bank-accounts/:bankAccountId")
  @HttpCode(200)
  async deleteBankAccount(
    @CurrentUserParam() user: CurrentUser,
    @Param("id") id: string,
    @Param("bankAccountId") bankAccountId: string,
  ) {
    await this.gift.remove(user.scope, id, bankAccountId);

    return ok({ status: "deleted" });
  }

  // ------------------------------------------------------------------- quote

  @Get(":id/quote")
  async getQuote(
    @CurrentUserParam() user: CurrentUser,
    @Param("id") id: string,
  ) {
    return ok(await this.quote.get(user.scope, id));
  }

  @Patch(":id/quote")
  async updateQuote(
    @CurrentUserParam() user: CurrentUser,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const input = parse(quoteSchema, body);

    return ok(
      await this.quote.update(user.scope, id, {
        ...(input.text !== undefined ? { text: input.text } : {}),
        ...(input.source !== undefined ? { source: input.source } : {}),
      }),
    );
  }
}
