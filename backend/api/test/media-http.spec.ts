import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import request from "supertest";

import { AppExceptionFilter } from "../src/http/exception.filter";
import { MediaController } from "../src/modules/media/media.controller";
import {
  MAX_FILE_BYTES,
  MediaService,
} from "../src/modules/media/media.service";
import { NotFoundError, UnauthenticatedError } from "../src/http/errors";
import { SessionService } from "../src/modules/auth/session.service";
import {
  POLICY_REGISTRY,
  RATE_LIMITER,
} from "../src/shared/rate-limit/rate-limit.guard";
import { PolicyRegistry } from "../src/shared/rate-limit/config";

/**
 * P1-17 at the HTTP layer. `docs/API/05-MEDIA-API.md`.
 *
 * What only this layer can test:
 *
 *   **the multipart parser's limits** — `limits.fileSize` is the framework half of
 *     `docs/SECURITY/06` layer 4, and a service test cannot exercise it because the service
 *     is handed an already-parsed part;
 *   **the translation of multer's own errors** into the codes `docs/API/05` names — multer
 *     throws before the handler runs, so nothing inside the service ever sees them;
 *   **`purpose` arriving as a form field** rather than as a JSON property.
 */

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const INVITATION_ID = "33333333-3333-4333-8333-333333333333";
const OTHERS_INVITATION = "99999999-9999-4999-8999-999999999999";
const MEDIA_ID = "55555555-5555-4555-8555-555555555555";
const OTHERS_MEDIA = "66666666-6666-4666-8666-666666666666";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

const seen: {
  purpose?: string;
  filename?: string;
  mimetype?: string;
  size?: number;
  mediaId?: string;
} = {};

const mediaStub = {
  upload: async (
    _scope: unknown,
    invitationId: string,
    purpose: string,
    file: { originalname: string; mimetype: string; size: number },
  ) => {
    if (invitationId !== INVITATION_ID) throw new NotFoundError();
    seen.purpose = purpose;
    seen.filename = file.originalname;
    seen.mimetype = file.mimetype;
    seen.size = file.size;
    return { id: MEDIA_ID, status: "processing", purpose };
  },
  get: async (_scope: unknown, mediaId: string) => {
    if (mediaId !== MEDIA_ID) throw new NotFoundError();
    seen.mediaId = mediaId;
    return {
      id: MEDIA_ID,
      status: "ready",
      purpose: "gallery",
      url: "https://cdn.test/large.webp",
      thumbnail_url: "https://cdn.test/thumbnail.webp",
      width: 1600,
      height: 1200,
    };
  },
};

const sessionStub = {
  authenticate: async (header: string | undefined) => {
    if (header !== "Bearer good") throw new UnauthenticatedError();
    return {
      id: OWNER_ID,
      email: "budi@example.test",
      fullName: "Budi",
      role: "user",
      emailVerified: false,
    };
  },
};

const ALLOW = {
  allowed: true as boolean,
  limit: 60,
  remaining: 59,
  resetAt: 1789200000,
};

const limiterStub = {
  check: async () =>
    ALLOW as {
      allowed: boolean;
      limit: number;
      remaining: number;
      resetAt: number;
      retryAfterSeconds?: number;
    },
  recordFailure: async () => {},
  block: async () => 900,
};

const AUTH = ["Authorization", "Bearer good"] as const;

describe("media endpoints over HTTP", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [MediaController],
      providers: [
        { provide: APP_FILTER, useClass: AppExceptionFilter },
        { provide: MediaService, useValue: mediaStub },
        { provide: SessionService, useValue: sessionStub },
        { provide: RATE_LIMITER, useValue: limiterStub },
        {
          provide: POLICY_REGISTRY,
          useValue: new PolicyRegistry(undefined, undefined),
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    // The limiter stub is shared. P1-14 learned what a leaked refusal costs: thirteen tests
    // failed for a reason that had nothing to do with them.
    limiterStub.check = async () => ALLOW;
    ALLOW.allowed = true;
  });

  describe("POST /invitations/:id/media", () => {
    it("accepts a multipart upload and answers 201", async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/invitations/${INVITATION_ID}/media`)
        .set(...AUTH)
        .field("purpose", "gallery")
        .attach("file", JPEG, {
          filename: "prewedding.jpg",
          contentType: "image/jpeg",
        })
        .expect(201);

      expect(res.body).toEqual({
        success: true,
        data: { id: MEDIA_ID, status: "processing", purpose: "gallery" },
      });
      expect(seen.purpose).toBe("gallery");
      expect(seen.filename).toBe("prewedding.jpg");
      expect(seen.size).toBe(JPEG.length);
    });

    it.each(["cover", "gallery", "profile"])(
      "accepts purpose=%s",
      async (purpose) => {
        await request(app.getHttpServer())
          .post(`/api/v1/invitations/${INVITATION_ID}/media`)
          .set(...AUTH)
          .field("purpose", purpose)
          .attach("file", JPEG, { filename: "p.jpg" })
          .expect(201);

        expect(seen.purpose).toBe(purpose);
      },
    );

    it.each([
      ["an unknown purpose", "banner"],
      ["an empty purpose", ""],
      ["a purpose with different casing", "Gallery"],
    ])("rejects %s", async (_name, purpose) => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/invitations/${INVITATION_ID}/media`)
        .set(...AUTH)
        .field("purpose", purpose)
        .attach("file", JPEG, { filename: "p.jpg" })
        .expect(400);

      expect(res.body.error.details[0].field).toBe("purpose");
    });

    it("rejects a request with no purpose at all", async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/invitations/${INVITATION_ID}/media`)
        .set(...AUTH)
        .attach("file", JPEG, { filename: "p.jpg" })
        .expect(400);
    });

    it("rejects a request with no file part", async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/invitations/${INVITATION_ID}/media`)
        .set(...AUTH)
        .field("purpose", "gallery")
        .expect(400);

      expect(res.body.error.details[0].field).toBe("file");
    });

    it("an oversized upload is rejected as 400 FILE_TOO_LARGE", async () => {
      // `docs/SECURITY/06` layer 4 at the framework level, and `docs/API/05` § Error Cases
      // naming the code. `@nestjs/platform-express` turns multer's LIMIT_FILE_SIZE into a
      // 413 PayloadTooLargeException; `UploadErrorInterceptor` rewrites it to the documented
      // 400 so a client is not told two different things about the same rule.
      const oversized = Buffer.alloc(MAX_FILE_BYTES + 1024, 0x41);
      oversized.set(JPEG, 0);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/invitations/${INVITATION_ID}/media`)
        .set(...AUTH)
        .field("purpose", "gallery")
        .attach("file", oversized, { filename: "huge.jpg" })
        .expect(400);

      expect(res.body.error.code).toBe("FILE_TOO_LARGE");
      // The service never saw it: the parser stopped at the limit rather than buffering
      // 11 MB and asking afterwards.
      expect(seen.size).not.toBe(oversized.length);
    });

    it("rejects a second file in the same request", async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/invitations/${INVITATION_ID}/media`)
        .set(...AUTH)
        .field("purpose", "gallery")
        .attach("file", JPEG, { filename: "one.jpg" })
        .attach("file", JPEG, { filename: "two.jpg" })
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    it("another user's invitation is 404 with an empty body", async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/invitations/${OTHERS_INVITATION}/media`)
        .set(...AUTH)
        .field("purpose", "gallery")
        .attach("file", JPEG, { filename: "p.jpg" })
        .expect(404);

      expect(res.body.data).toBeUndefined();
      expect(res.body.error.code).toBe("NOT_FOUND");
    });

    it("is 401 without a token, before the body is parsed", async () => {
      // Guards run before interceptors in Nest, so an unauthenticated 10 MB upload costs
      // nothing. Asserted here because that ordering is a property of the framework rather
      // than of this code, and a future change to it would be silent.
      await request(app.getHttpServer())
        .post(`/api/v1/invitations/${INVITATION_ID}/media`)
        .field("purpose", "gallery")
        .attach("file", JPEG, { filename: "p.jpg" })
        .expect(401);
    });

    it("is rate limited on the media-upload policy", async () => {
      limiterStub.check = async () => ({
        allowed: false,
        limit: 60,
        remaining: 0,
        resetAt: 1789200000,
      });

      const res = await request(app.getHttpServer())
        .post(`/api/v1/invitations/${INVITATION_ID}/media`)
        .set(...AUTH)
        .field("purpose", "gallery")
        .attach("file", JPEG, { filename: "p.jpg" })
        .expect(429);

      expect(res.body.error.code).toBe("TOO_MANY_ATTEMPTS");
    });
  });

  describe("GET /media/:media_id", () => {
    it("returns the ready shape", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/media/${MEDIA_ID}`)
        .set(...AUTH)
        .expect(200);

      expect(res.body.data).toEqual({
        id: MEDIA_ID,
        status: "ready",
        purpose: "gallery",
        url: "https://cdn.test/large.webp",
        thumbnail_url: "https://cdn.test/thumbnail.webp",
        width: 1600,
        height: 1200,
      });
    });

    it("another user's media is 404, never 403", async () => {
      // ADR-018 and `docs/API/05` § Error Cases: a 403 would confirm the id exists.
      const res = await request(app.getHttpServer())
        .get(`/api/v1/media/${OTHERS_MEDIA}`)
        .set(...AUTH)
        .expect(404);

      expect(res.body.error.code).toBe("NOT_FOUND");
      expect(res.body.data).toBeUndefined();
    });

    it("is 401 without a token", async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/media/${MEDIA_ID}`)
        .expect(401);
    });
  });
});
