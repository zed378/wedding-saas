import {
  BadRequestException,
  Body,
  type CallHandler,
  Controller,
  type ExecutionContext,
  Get,
  HttpCode,
  Injectable,
  type NestInterceptor,
  Param,
  PayloadTooLargeException,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { catchError, throwError, type Observable } from "rxjs";
import { z } from "zod";

import { ok } from "../../http/envelope";
import { ValidationError } from "../../http/errors";
import {
  CurrentUserParam,
  requireAuth,
  type CurrentUser,
} from "../../shared/auth-middleware";
import { rateLimit } from "../../shared/rate-limit";
import {
  MAX_FILE_BYTES,
  MediaService,
  type MediaPurpose,
  type UploadedFilePart,
} from "./media.service";

/**
 * P1-17 — `docs/API/05-MEDIA-API.md`.
 *
 * ## The size limit is a parser option, not a check
 *
 * `docs/SECURITY/06` layer 4 asks for an oversized upload to be "rejected at the request
 * level BEFORE the file is fully received". `limits.fileSize` is passed to busboy through
 * multer, which stops reading at the limit and raises `LIMIT_FILE_SIZE` — so a 500 MB body
 * costs 10 MB of memory and not 500. A check after parsing would have already paid the cost
 * the limit exists to avoid.
 *
 * `limits.files: 1` and `limits.fields: 1` matter for the same reason: without them, one
 * request may carry a hundred parts, each under the size limit.
 *
 * **The web-server half of layer 4 does not exist yet.** There is no Caddy in this repository
 * until `P3-11`, so today the limit is enforced at the framework only — one layer thinner
 * than the document asks for. Recorded on `P3-11`'s card rather than quietly considered done.
 *
 * ## `purpose` is a body field and `:id` is not
 *
 * The invitation comes from the path, so a client cannot upload into an invitation other than
 * the one they addressed, and `purpose` is a three-value enum rather than free text.
 */

const purposeSchema = z.enum(["cover", "gallery", "profile"]);

/**
 * The multipart file, as `multer` produces it.
 *
 * Declared structurally rather than imported: `@types/multer` is not a dependency, and
 * `@nestjs/platform-express` bundles the interceptor's types but not the file's. Naming only
 * what is read is also a small piece of documentation — `originalname` is consulted for the
 * extension check and reaches no path.
 */
interface MulterFile extends UploadedFilePart {
  readonly fieldname: string;
}

/**
 * Translate multer's own rejections into the codes `docs/API/05` names.
 *
 * `FileInterceptor` throws **before** the handler runs, so a `try` inside the method cannot
 * see it — and `@nestjs/platform-express` has already turned `LIMIT_FILE_SIZE` into a
 * `PayloadTooLargeException` (413) and the rest into `BadRequestException` (400). The
 * document asks for **400 `FILE_TOO_LARGE`**, so the 413 is rewritten here.
 *
 * Listed BEFORE `FileInterceptor` in `@UseInterceptors`, which is what puts it outside: Nest
 * composes interceptors so the first one wraps the rest, and only a wrapper sees the inner
 * one's error.
 */
@Injectable()
export class UploadErrorInterceptor implements NestInterceptor {
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    return next.handle().pipe(
      catchError((error: unknown) => {
        if (error instanceof PayloadTooLargeException) {
          return throwError(
            () =>
              new ValidationError(
                [{ field: "file", message: "Ukuran file melebihi 10 MB." }],
                "Ukuran file melebihi 10 MB.",
                "FILE_TOO_LARGE",
              ),
          );
        }

        // A malformed multipart body, more than one file, more than one field. multer's own
        // message names the limit it hit, which is useful to an integrator and harmless to
        // an attacker -- it says nothing about the file or the system. It is still replaced,
        // because `docs/SECURITY/08` § Error Handling says client messages are ours to write.
        if (error instanceof BadRequestException) {
          return throwError(
            () =>
              new ValidationError([
                {
                  field: "file",
                  message: "Unggah satu berkas gambar per permintaan.",
                },
              ]),
          );
        }

        return throwError(() => error);
      }),
    );
  }
}

@Controller("api/v1")
@UseGuards(requireAuth())
export class MediaController {
  constructor(private readonly media: MediaService) {}

  /**
   * `POST /invitations/:id/media`.
   *
   * Rate limited on `media-upload` — 60 an hour per user, from `docs/SECURITY/10`'s table.
   * The quota (200 per invitation) is a resource control and this is an abuse control; they
   * are different rules and would not necessarily move together.
   */
  @Post("invitations/:id/media")
  @HttpCode(201)
  @UseGuards(rateLimit("media-upload"))
  @UseInterceptors(
    UploadErrorInterceptor,
    FileInterceptor("file", {
      limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 1 },
    }),
  )
  async upload(
    @CurrentUserParam() user: CurrentUser,
    @Param("id") id: string,
    @UploadedFile() file: MulterFile | undefined,
    @Body() body: unknown,
  ) {
    if (file === undefined) {
      throw new ValidationError([
        { field: "file", message: "Sertakan berkas gambar." },
      ]);
    }

    const parsed = purposeSchema.safeParse(
      (body as Record<string, unknown> | undefined)?.["purpose"],
    );
    if (!parsed.success) {
      throw new ValidationError([
        {
          field: "purpose",
          message: "Pilih salah satu: cover, gallery, atau profile.",
        },
      ]);
    }

    return ok(
      await this.media.upload(
        user.scope,
        id,
        parsed.data as MediaPurpose,
        file,
      ),
    );
  }

  /**
   * `GET /media/:media_id` — what the upload flow polls between `processing` and `ready`
   * (`docs/FRONTEND/05` § Upload Flow; ADR-021 added the endpoint).
   *
   * Not nested under the invitation, matching `docs/API/05`: the client holds a media id from
   * the 201 and nothing else. Ownership is still enforced through the invitation, in the
   * repository's join — `docs/SECURITY/05` § 6's two-step rule.
   */
  @Get("media/:mediaId")
  async getMedia(
    @CurrentUserParam() user: CurrentUser,
    @Param("mediaId") mediaId: string,
  ) {
    return ok(await this.media.get(user.scope, mediaId));
  }
}
