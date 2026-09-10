import { test, expect } from "@playwright/test";

/**
 * The one thing E2E can genuinely exercise today: the API over real HTTP.
 *
 * `P0-22` builds the frontends. Until they exist, an E2E test against a page would be a
 * test against nothing — so this drives the API through the network stack instead, which
 * is a real end-to-end path even if it is a short one.
 *
 * It would fail if the runner were misconfigured, the API were not running, or the
 * response shape changed. That is the bar for "a real passing test" in the P0-19 DoD.
 *
 *   docker compose -f deploy/docker-compose.yml up -d
 *   pnpm --filter @wi/e2e test:e2e
 */

const API = process.env["E2E_API_URL"] ?? "http://localhost:3000";

test.describe("API over HTTP", () => {
  test("liveness answers ok and discloses nothing else", async ({
    request,
  }) => {
    const response = await request.get(`${API}/health`);

    expect(response.status()).toBe(200);
    // Exactly one key. An unauthenticated probe naming a version or a host is free
    // reconnaissance (docs/DEVOPS/05 § Health Check).
    expect(await response.json()).toEqual({ status: "ok" });
  });

  test("every response carries a request id for correlation", async ({
    request,
  }) => {
    // docs/DEVOPS/06 § Request Correlation. The header is how a user's report of "it
    // failed at 3pm" becomes a specific line in the log.
    const response = await request.get(`${API}/health`);
    expect(response.headers()["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("security headers are actually delivered, not merely configured", async ({
    request,
  }) => {
    // The gap the P0-13 record named: "they are configured; that is not the same as
    // delivered". A header set in code and stripped by a proxy is a common and silent
    // failure, and only a request over the wire can tell the difference.
    const headers = (await request.get(`${API}/health`)).headers();

    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]?.toLowerCase()).toBe("deny");
    expect(headers["referrer-policy"]).toBe("no-referrer");
    expect(headers["content-security-policy"]).toContain("default-src 'none'");
  });

  test("an unknown route returns the documented error envelope", async ({
    request,
  }) => {
    // docs/API/00. Asserted over the wire because the envelope is a contract with
    // clients, and a client sees what the network delivers rather than what a unit test
    // constructed.
    const response = await request.get(`${API}/does-not-exist`);

    expect(response.status()).toBe(404);
    const body = await response.json();
    expect(body).toEqual({
      success: false,
      error: {
        code: "NOT_FOUND",
        message: "The requested resource was not found.",
      },
    });
  });

  test("readiness reports its dependencies", async ({ request }) => {
    const response = await request.get(`${API}/readyz`);
    const body = await response.json();

    // 200 with a live database, 503 without. Either is a valid answer; what must hold is
    // that it names WHICH dependency and never why (docs/DEVOPS/05).
    expect([200, 503]).toContain(response.status());
    expect(body.checks).toHaveProperty("database");
    expect(JSON.stringify(body)).not.toContain("ECONNREFUSED");
  });
});
