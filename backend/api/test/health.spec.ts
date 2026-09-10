import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module";

describe("health", () => {
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

  // The container HEALTHCHECK calls this endpoint, and compose gates the API on it, so a
  // regression here stops the whole local stack rather than failing quietly.
  it("answers liveness without touching a dependency", async () => {
    const response = await request(app.getHttpServer())
      .get("/health")
      .expect(200);
    expect(response.body).toEqual({ status: "ok" });
  });

  it("discloses nothing about the infrastructure", async () => {
    // An unauthenticated probe that names versions or hosts is free reconnaissance
    // (docs/DEVOPS/05 § Health Check).
    const response = await request(app.getHttpServer())
      .get("/health")
      .expect(200);
    expect(Object.keys(response.body)).toEqual(["status"]);
  });
});
