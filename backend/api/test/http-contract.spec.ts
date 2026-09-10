import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test } from "@nestjs/testing";
import {
  Controller,
  Get,
  Module,
  INestApplication,
  NotFoundException,
} from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import request from "supertest";

import { AppExceptionFilter } from "../src/http/exception.filter";
import { ok, failure } from "../src/http/envelope";
import {
  ValidationError,
  UnauthenticatedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  BusinessRuleError,
  RateLimitedError,
} from "../src/http/errors";
import {
  parsePagination,
  pageMeta,
  DEFAULT_PER_PAGE,
  MAX_PER_PAGE,
} from "../src/http/pagination";
import {
  expectSuccess,
  expectPaginated,
  expectError,
  expectNoInternalLeak,
} from "./support/envelope-assertions";

/**
 * P0-13 — the response contract, and the promise that errors leak nothing.
 *
 * The error tests are the important half. `docs/SECURITY/08` § Error Handling forbids a
 * stack trace, SQL, a server path or a library version reaching a client, and the way
 * that requirement is normally broken is not carelessness — it is a framework helpfully
 * forwarding an exception message that happened to contain a failing query.
 *
 * So the tests throw the errors that actually leak: a Postgres-shaped error, a TypeError
 * with a file path in it, a raw string.
 */

/** A controller that throws, on demand, whatever a test asks for. */
@Controller("probe")
class ProbeController {
  @Get("success")
  success(): unknown {
    return ok({ id: "abc" });
  }

  @Get("paginated")
  paginated(): unknown {
    const pagination = parsePagination({ page: "2", per_page: "5" });
    return ok([{ id: "a" }, { id: "b" }], pageMeta(pagination, 57));
  }

  @Get("validation")
  validation(): never {
    throw new ValidationError([{ field: "email", message: "Invalid email" }]);
  }

  @Get("unauthenticated")
  unauthenticated(): never {
    throw new UnauthenticatedError();
  }

  @Get("forbidden")
  forbidden(): never {
    throw new ForbiddenError("EMAIL_NOT_VERIFIED");
  }

  @Get("notfound")
  notfound(): never {
    throw new NotFoundError();
  }

  @Get("conflict")
  conflict(): never {
    throw new ConflictError("SLUG_TAKEN", "That address is already in use.");
  }

  @Get("business")
  business(): never {
    throw new BusinessRuleError(
      "INCOMPLETE_INVITATION",
      "Some required details are missing.",
    );
  }

  @Get("ratelimited")
  ratelimited(): never {
    throw new RateLimitedError();
  }

  /** A driver error, shaped like the ones pg actually throws. */
  @Get("pg-error")
  pgError(): never {
    const error = Object.assign(
      new Error(
        'insert or update on table "invitations" violates foreign key constraint ' +
          '"invitations_owner_id_users_id_fk"',
      ),
      {
        code: "23503",
        table: "invitations",
        severity: "ERROR",
        file: "ri_triggers.c",
      },
    );
    throw error;
  }

  /** A programming error, whose stack carries file paths. */
  @Get("type-error")
  typeError(): never {
    const nothing = undefined as unknown as { field: string };
    return nothing.field as never;
  }

  /** Something that is not an Error at all. Libraries do this. */
  @Get("thrown-string")
  thrownString(): never {
    throw "connection to postgres://user:hunter2@10.0.0.5:5432/wedding failed";
  }

  /** A framework exception, to check its message is replaced rather than forwarded. */
  @Get("nest-404")
  nest404(): never {
    throw new NotFoundException(
      "No invitation with id 7f3a9c21 exists in table invitations",
    );
  }
}

@Module({
  controllers: [ProbeController],
  providers: [{ provide: APP_FILTER, useClass: AppExceptionFilter }],
})
class ProbeModule {}

describe("envelope helpers", () => {
  it("omits meta rather than setting it to undefined", () => {
    // `{ meta: undefined }` serialises identically but is a different object, and under
    // exactOptionalPropertyTypes a different type. Keeping it absent avoids both.
    expect(Object.keys(ok({ a: 1 }))).toEqual(["success", "data"]);
    expect(
      Object.keys(ok({ a: 1 }, { page: 1, per_page: 20, total: 0 })),
    ).toEqual(["success", "data", "meta"]);
  });

  it("omits details when there are none", () => {
    expect(Object.keys(failure("X", "y").error)).toEqual(["code", "message"]);
    expect(
      Object.keys(failure("X", "y", [{ field: "a", message: "b" }]).error),
    ).toEqual(["code", "message", "details"]);
  });
});

describe("pagination (docs/API/00 § Pagination)", () => {
  it("defaults to page 1 and per_page 20", () => {
    expect(parsePagination({})).toEqual({
      page: 1,
      perPage: DEFAULT_PER_PAGE,
      offset: 0,
      limit: DEFAULT_PER_PAGE,
    });
  });

  it("computes the offset so no handler has to", () => {
    expect(parsePagination({ page: "3", per_page: "20" }).offset).toBe(40);
  });

  it("rejects per_page above the maximum rather than clamping it", () => {
    // Silently clamping means a client paginating through results gets a different page
    // size than it asked for and quietly skips records. The bug then surfaces as
    // missing data, much later, in someone else's code.
    expect(() =>
      parsePagination({ per_page: String(MAX_PER_PAGE + 1) }),
    ).toThrow(ValidationError);
    expect(() =>
      parsePagination({ per_page: String(MAX_PER_PAGE) }),
    ).not.toThrow();
  });

  it.each([
    "0",
    "-1",
    "1.5",
    "abc",
    "1e3",
    "0x10",
    "+1",
    " 1 ",
    "99999999999999999999",
  ])("rejects a page of %s", (page) => {
    // 1e3 and 0x10 are the interesting ones: Number() reads them as 1000 and 16, so a
    // plain Number.isInteger check accepts both. Requiring decimal digits removes a
    // class of validation bypass rather than reasoning about it case by case. The
    // last is beyond Number.MAX_SAFE_INTEGER.
    expect(() => parsePagination({ page })).toThrow(ValidationError);
  });

  it("accepts a numeric page as well as a string one", () => {
    expect(parsePagination({ page: 3 }).page).toBe(3);
    expect(() => parsePagination({ page: 1.5 })).toThrow(ValidationError);
  });

  it("names the offending field in the error", () => {
    try {
      parsePagination({ per_page: "500" });
      expect.unreachable();
    } catch (error) {
      expect((error as ValidationError).details?.[0]?.field).toBe("per_page");
    }
  });
});

describe("the HTTP contract", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ProbeModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it("returns the success envelope", async () => {
    const data = expectSuccess<{ id: string }>(
      await request(app.getHttpServer()).get("/probe/success"),
    );
    expect(data).toEqual({ id: "abc" });
  });

  it("returns meta on a paginated response", async () => {
    const rows = expectPaginated(
      await request(app.getHttpServer()).get("/probe/paginated"),
      {
        page: 2,
        per_page: 5,
        total: 57,
      },
    );
    expect(rows).toHaveLength(2);
  });

  it.each([
    ["validation", 400, "VALIDATION_ERROR"],
    ["unauthenticated", 401, "UNAUTHENTICATED"],
    ["forbidden", 403, "EMAIL_NOT_VERIFIED"],
    ["notfound", 404, "NOT_FOUND"],
    ["conflict", 409, "SLUG_TAKEN"],
    ["business", 422, "INCOMPLETE_INVITATION"],
    ["ratelimited", 429, "TOO_MANY_ATTEMPTS"],
  ])("maps /%s to %i %s", async (route, status, code) => {
    expectError(
      await request(app.getHttpServer()).get(`/probe/${route}`),
      status,
      code,
    );
  });

  it("carries validation details in the documented shape", async () => {
    const error = expectError(
      await request(app.getHttpServer()).get("/probe/validation"),
      400,
      "VALIDATION_ERROR",
    );
    expect(error.details).toEqual([
      { field: "email", message: "Invalid email" },
    ]);
  });
});

describe("errors leak nothing internal (docs/SECURITY/08)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ProbeModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it("turns a database error into a generic 500 with no SQL and no constraint name", async () => {
    // The realistic leak. pg's message names the table and the constraint; forwarding
    // it hands over the schema one failed request at a time.
    const res = await request(app.getHttpServer()).get("/probe/pg-error");

    expectError(res, 500, "INTERNAL_ERROR");
    expect(JSON.stringify(res.body)).not.toContain("invitations");
    expect(JSON.stringify(res.body)).not.toContain("23503");
    expect(JSON.stringify(res.body)).not.toContain("foreign key");
  });

  it("turns a TypeError into a generic 500 with no stack or file path", async () => {
    const res = await request(app.getHttpServer()).get("/probe/type-error");

    expectError(res, 500, "INTERNAL_ERROR");
    expect(JSON.stringify(res.body)).not.toContain("Cannot read");
    expectNoInternalLeak(res);
  });

  it("does not forward a thrown string, even one containing a connection URL", async () => {
    // Not everything thrown is an Error. A filter that reads `.message` and falls back
    // to `String(exception)` would put a password in the response body here.
    const res = await request(app.getHttpServer()).get("/probe/thrown-string");

    expectError(res, 500, "INTERNAL_ERROR");
    expect(JSON.stringify(res.body)).not.toContain("hunter2");
    expect(JSON.stringify(res.body)).not.toContain("10.0.0.5");
  });

  it("replaces a framework exception's message rather than forwarding it", async () => {
    // Nest's NotFoundException carries whatever message the thrower passed. Here that
    // message names a real id and a table -- which is exactly the enumeration signal
    // ADR-018 chose 404 to remove, arriving through a helpful error string instead.
    const res = await request(app.getHttpServer()).get("/probe/nest-404");

    expectError(res, 404, "NOT_FOUND");
    expect(res.body.error.message).toBe(
      "The requested resource was not found.",
    );
    expect(JSON.stringify(res.body)).not.toContain("7f3a9c21");
  });

  it("gives an unknown route the same 404 body as a resource that is not yours", async () => {
    // ADR-018: if "no such route" and "not yours" read differently, the difference is
    // an oracle. Both must be byte-identical.
    const unknownRoute = await request(app.getHttpServer()).get(
      "/probe/does-not-exist",
    );
    const notYours = await request(app.getHttpServer()).get("/probe/notfound");

    expect(unknownRoute.status).toBe(404);
    expect(unknownRoute.body).toEqual(notYours.body);
  });
});

describe("there is no ForbiddenError for someone else's resource", () => {
  it("ForbiddenError only accepts the two codes that reveal no resource identity", () => {
    // The rule is kept by the type system: ADR-018 says 403 is for a missing role or an
    // unverified email, never for another user's row. A class that cannot express the
    // third case cannot be misused to produce it.
    expect(new ForbiddenError().code).toBe("FORBIDDEN");
    expect(new ForbiddenError("EMAIL_NOT_VERIFIED").code).toBe(
      "EMAIL_NOT_VERIFIED",
    );
    expect(new NotFoundError().status).toBe(404);
  });
});
