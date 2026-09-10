import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SCHEMA_CONTRACT_VERSION, INVITATION_FIELD_PATHS } from "@wi/schema";

import { AppModule } from "../src/app.module";
import { REQUEST_ID_HEADER } from "../src/http/request-id.middleware";
import { SURFACE } from "../src/http/surfaces";

describe("HTTP surfaces", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  // docs/ARCHITECTURE/01 separates the three surfaces at the routing layer because they
  // differ in authentication, rate limiting and caching. Each is asserted reachable and
  // distinct, so a later task cannot quietly collapse them.
  it.each([
    [
      "authenticated",
      `/${SURFACE.AUTHENTICATED}/_reference`,
      SURFACE.AUTHENTICATED,
    ],
    ["public", `/${SURFACE.PUBLIC}/_reference`, SURFACE.PUBLIC],
    ["webhook", `/${SURFACE.WEBHOOK}/_reference`, SURFACE.WEBHOOK],
  ])("mounts the %s surface", async (_name, path, expected) => {
    const response = await request(app.getHttpServer()).get(path).expect(200);
    expect(response.body.surface).toBe(expected);
  });

  it("the three surfaces are mounted at distinct paths", () => {
    const paths = new Set(Object.values(SURFACE));
    expect(paths.size).toBe(3);
  });

  it("reaches the shared @wi/schema package across the workspace boundary", async () => {
    // ADR-004 chose one language so the field-path registry is a shared package rather
    // than two implementations. If this import ever stops resolving, that argument is
    // broken.
    //
    // Asserted against the imported constant rather than a literal. The literal was `0`
    // and P0-20 bumped it to `1`, which failed a test that was not about the number --
    // and a literal makes every future bump an edit here for no signal.
    //
    // The version alone would be a weak claim, though: two zeros agreeing across a wire
    // proves nothing. The second assertion is the one with content -- the package now
    // carries the canonical field vocabulary (P0-20), and this process can see it.
    const response = await request(app.getHttpServer())
      .get(`/${SURFACE.AUTHENTICATED}/_reference`)
      .expect(200);

    expect(response.body.schemaContractVersion).toBe(SCHEMA_CONTRACT_VERSION);
    expect(INVITATION_FIELD_PATHS).toContain("couple.groom.nickname");
  });

  it("assigns a request id to every response", async () => {
    const response = await request(app.getHttpServer())
      .get(`/${SURFACE.PUBLIC}/_reference`)
      .expect(200);
    expect(response.headers[REQUEST_ID_HEADER]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("gives each request its own id", async () => {
    const server = app.getHttpServer();
    const [a, b] = await Promise.all([
      request(server).get(`/${SURFACE.PUBLIC}/_reference`),
      request(server).get(`/${SURFACE.PUBLIC}/_reference`),
    ]);
    expect(a.headers[REQUEST_ID_HEADER]).not.toBe(b.headers[REQUEST_ID_HEADER]);
  });

  it("returns 404 for an unmounted path", async () => {
    await request(app.getHttpServer())
      .get("/not-a-surface/_reference")
      .expect(404);
  });
});
