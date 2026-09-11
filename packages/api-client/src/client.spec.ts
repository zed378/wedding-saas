import { describe, it, expect, vi } from "vitest";

import { ApiClient, type TransportProblem } from "./client.js";
import { ApiError, NetworkError, UnauthenticatedError } from "./errors.js";
import { createTokenStore } from "./token-store.js";

/**
 * P0-22 — the interceptor, `docs/FRONTEND/08` § Global Fetch Error Handling.
 *
 * Every test injects its own `fetch`, so nothing here touches a network.
 */

const BASE = "https://app.zedth.my.id/api/v1";

function jsonResponse(
  body: unknown,
  init: { status?: number; requestId?: string } = {},
): Response {
  const headers = new Headers({ "content-type": "application/json" });
  if (init.requestId !== undefined) headers.set("x-request-id", init.requestId);

  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers,
  });
}

const ok = (data: unknown, meta?: unknown) =>
  jsonResponse(
    meta === undefined
      ? { success: true, data }
      : { success: true, data, meta },
  );

const fail = (
  status: number,
  code: string,
  message: string,
  details?: unknown,
) =>
  jsonResponse(
    {
      success: false,
      error: { code, message, ...(details === undefined ? {} : { details }) },
    },
    { status },
  );

describe("the request envelope", () => {
  it("unwraps a success envelope", async () => {
    const client = new ApiClient({
      baseUrl: BASE,
      fetch: async () => ok({ id: "inv-1" }),
    });

    const result = await client.get<{ id: string }>("/invitations/inv-1");
    expect(result.data).toEqual({ id: "inv-1" });
  });

  it("carries pagination meta through", async () => {
    const client = new ApiClient({
      baseUrl: BASE,
      fetch: async () => ok([], { page: 2, per_page: 20, total: 57 }),
    });

    const result = await client.get("/invitations");
    expect(result.meta).toEqual({ page: 2, per_page: 20, total: 57 });
  });

  it("turns an error envelope into an ApiError with its code and details", async () => {
    const client = new ApiClient({
      baseUrl: BASE,
      fetch: async () =>
        fail(400, "VALIDATION_ERROR", "Data tidak valid", [
          { field: "slug", message: "Sudah dipakai" },
        ]),
    });

    const error = await client
      .post("/invitations", {})
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    const api = error as ApiError;
    expect(api.status).toBe(400);
    expect(api.code).toBe("VALIDATION_ERROR");
    expect(api.message).toBe("Data tidak valid");
    expect(api.details).toEqual([{ field: "slug", message: "Sudah dipakai" }]);
    expect(api.isClientError).toBe(true);
  });

  it("keeps the request id so a user's report maps to a log line", async () => {
    const client = new ApiClient({
      baseUrl: BASE,
      fetch: async () =>
        jsonResponse(
          {
            success: false,
            error: { code: "NOT_FOUND", message: "Tidak ditemukan" },
          },
          { status: 404, requestId: "req-abc" },
        ),
    });

    const error = (await client.get("/x").catch((e: unknown) => e)) as ApiError;
    expect(error.requestId).toBe("req-abc");
  });

  it("handles a 204 with no body", async () => {
    const client = new ApiClient({
      baseUrl: BASE,
      fetch: async () => new Response(null, { status: 204 }),
    });

    await expect(client.delete("/invitations/inv-1")).resolves.toMatchObject({
      data: undefined,
    });
  });

  it("treats a non-envelope response as a server problem rather than parsing it hopefully", async () => {
    // An HTML error page from a proxy. Guessing at an unknown shape is how a login page
    // ends up rendered inside a data table.
    const problems: TransportProblem[] = [];
    const client = new ApiClient({
      baseUrl: BASE,
      fetch: async () =>
        new Response("<html>502 Bad Gateway</html>", {
          status: 502,
          headers: { "content-type": "text/html" },
        }),
      onTransportProblem: (p) => problems.push(p),
    });

    const error = (await client.get("/x").catch((e: unknown) => e)) as ApiError;
    expect(error.code).toBe("MALFORMED_RESPONSE");
    expect(problems).toHaveLength(0); // the parse failed before the envelope check
  });
});

describe("5xx (docs/FRONTEND/08: a generic toast)", () => {
  it("reports a transport problem so the shell can show a toast", async () => {
    const problems: TransportProblem[] = [];
    const client = new ApiClient({
      baseUrl: BASE,
      fetch: async () =>
        fail(500, "INTERNAL_ERROR", "Database connection lost"),
      onTransportProblem: (p) => problems.push(p),
    });

    await client.get("/x").catch(() => {});
    expect(problems).toEqual([
      { kind: "server", status: 500, requestId: undefined },
    ]);
  });

  it("replaces the server's 5xx message with a generic one", async () => {
    // The server's 500 message is generic too (docs/API/00), but the client is the last
    // place that can decide not to render whatever a proxy put there.
    const client = new ApiClient({
      baseUrl: BASE,
      fetch: async () =>
        fail(
          500,
          "INTERNAL_ERROR",
          "connection to postgres://user:hunter2@db failed",
        ),
    });

    const error = (await client.get("/x").catch((e: unknown) => e)) as ApiError;
    expect(error.message).not.toContain("hunter2");
    expect(error.message).toBe("Terjadi kesalahan. Silakan coba lagi.");
    expect(error.isServerError).toBe(true);
  });
});

describe("network failure (docs/FRONTEND/08: an offline indicator)", () => {
  it("reports offline and throws a NetworkError", async () => {
    const problems: TransportProblem[] = [];
    const client = new ApiClient({
      baseUrl: BASE,
      fetch: async () => {
        throw new TypeError("Failed to fetch");
      },
      onTransportProblem: (p) => problems.push(p),
    });

    await expect(client.get("/x")).rejects.toBeInstanceOf(NetworkError);
    expect(problems[0]?.kind).toBe("offline");
  });

  it("does not report an aborted request as offline", async () => {
    // A cancelled search or an unmounted component. Reporting it would show the user an
    // offline banner every time they type quickly.
    const problems: TransportProblem[] = [];
    const abort = new DOMException("The operation was aborted.", "AbortError");

    const client = new ApiClient({
      baseUrl: BASE,
      fetch: async () => {
        throw abort;
      },
      onTransportProblem: (p) => problems.push(p),
    });

    await expect(client.get("/x")).rejects.toBe(abort);
    expect(problems).toEqual([]);
  });
});

describe("401 (docs/FRONTEND/08: refresh or redirect)", () => {
  it("refreshes once and replays the request", async () => {
    const tokens = createTokenStore();
    tokens.set("stale");

    const calls: (string | undefined)[] = [];
    const client = new ApiClient({
      baseUrl: BASE,
      tokenStore: tokens,
      fetch: async (_url, init) => {
        const auth =
          new Headers(init?.headers).get("Authorization") ?? undefined;
        calls.push(auth);
        return auth === "Bearer fresh"
          ? ok({ id: "inv-1" })
          : fail(401, "UNAUTHENTICATED", "x");
      },
      refreshAccessToken: async () => "fresh",
    });

    const result = await client.get<{ id: string }>("/invitations/inv-1");

    expect(result.data).toEqual({ id: "inv-1" });
    expect(calls).toEqual(["Bearer stale", "Bearer fresh"]);
    expect(tokens.get()).toBe("fresh");
  });

  it("runs exactly one refresh for many concurrent 401s", async () => {
    // The reason `#refreshing` exists. With a ROTATING refresh token (docs/SECURITY/03)
    // the second refresh presents a token the first already consumed, which the server
    // must treat as reuse -- i.e. as theft -- and which revokes the whole family. The
    // user is logged out for loading their own dashboard.
    const tokens = createTokenStore();
    tokens.set("stale");

    const refresh = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return "fresh";
    });

    const client = new ApiClient({
      baseUrl: BASE,
      tokenStore: tokens,
      fetch: async (_url, init) => {
        const auth = new Headers(init?.headers).get("Authorization");
        return auth === "Bearer fresh"
          ? ok({})
          : fail(401, "UNAUTHENTICATED", "x");
      },
      refreshAccessToken: refresh,
    });

    await Promise.all([
      client.get("/a"),
      client.get("/b"),
      client.get("/c"),
      client.get("/d"),
      client.get("/e"),
      client.get("/f"),
    ]);

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("ends the session when the refresh returns nothing", async () => {
    const tokens = createTokenStore();
    tokens.set("stale");
    const onUnauthenticated = vi.fn();

    const client = new ApiClient({
      baseUrl: BASE,
      tokenStore: tokens,
      fetch: async () => fail(401, "UNAUTHENTICATED", "x"),
      refreshAccessToken: async () => undefined,
      onUnauthenticated,
    });

    await expect(client.get("/x")).rejects.toBeInstanceOf(UnauthenticatedError);
    expect(onUnauthenticated).toHaveBeenCalledTimes(1);
    expect(tokens.get()).toBeUndefined();
  });

  it("ends the session when the refresh throws", async () => {
    const onUnauthenticated = vi.fn();
    const client = new ApiClient({
      baseUrl: BASE,
      fetch: async () => fail(401, "UNAUTHENTICATED", "x"),
      refreshAccessToken: async () => {
        throw new Error("refresh endpoint is down");
      },
      onUnauthenticated,
    });

    await expect(client.get("/x")).rejects.toBeInstanceOf(UnauthenticatedError);
    expect(onUnauthenticated).toHaveBeenCalledTimes(1);
  });

  it("does not loop when the fresh token is rejected too", async () => {
    // Refreshing again here would be an infinite request loop against a server that
    // has already said no twice.
    const refresh = vi.fn(async () => "fresh-but-still-rejected");
    const fetchMock = vi.fn(async () => fail(401, "UNAUTHENTICATED", "x"));

    const client = new ApiClient({
      baseUrl: BASE,
      fetch: fetchMock,
      refreshAccessToken: refresh,
    });

    await expect(client.get("/x")).rejects.toBeInstanceOf(UnauthenticatedError);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2); // original + one replay
  });

  it("does not refresh an anonymous request", async () => {
    // The public API is unauthenticated by design (docs/API/08), and the refresh call
    // itself must not try to refresh -- that would recurse.
    const refresh = vi.fn(async () => "fresh");
    const client = new ApiClient({
      baseUrl: BASE,
      fetch: async () => fail(401, "UNAUTHENTICATED", "x"),
      refreshAccessToken: refresh,
    });

    await expect(
      client.get("/public/i/budi-siti", { anonymous: true }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("does nothing but fail when no refresh function is configured", async () => {
    const client = new ApiClient({
      baseUrl: BASE,
      fetch: async () => fail(401, "UNAUTHENTICATED", "x"),
    });

    await expect(client.get("/x")).rejects.toBeInstanceOf(UnauthenticatedError);
  });
});

describe("request construction", () => {
  it("sends the bearer token when there is one", async () => {
    const tokens = createTokenStore();
    tokens.set("abc");

    let seen: string | null = null;
    const client = new ApiClient({
      baseUrl: BASE,
      tokenStore: tokens,
      fetch: async (_url, init) => {
        seen = new Headers(init?.headers).get("Authorization");
        return ok({});
      },
    });

    await client.get("/me");
    expect(seen).toBe("Bearer abc");
  });

  it("sends no Authorization header when there is no token", async () => {
    let seen: string | null = "sentinel";
    const client = new ApiClient({
      baseUrl: BASE,
      tokenStore: createTokenStore(),
      fetch: async (_url, init) => {
        seen = new Headers(init?.headers).get("Authorization");
        return ok({});
      },
    });

    await client.get("/me");
    expect(seen).toBeNull();
  });

  it("includes credentials so the HTTP-only refresh cookie travels", async () => {
    // Without this the refresh flow cannot work at all, and it fails as a 401 loop
    // rather than as an obvious bug.
    let credentials: RequestCredentials | undefined;
    const client = new ApiClient({
      baseUrl: BASE,
      fetch: async (_url, init) => {
        credentials = init?.credentials;
        return ok({});
      },
    });

    await client.get("/me");
    expect(credentials).toBe("include");
  });

  it("builds the query string, skipping undefined values", async () => {
    let url = "";
    const client = new ApiClient({
      baseUrl: BASE,
      fetch: async (target) => {
        url = String(target);
        return ok([]);
      },
    });

    await client.get("/invitations", {
      query: { page: 2, per_page: 20, search: undefined },
    });

    expect(url).toBe(`${BASE}/invitations?page=2&per_page=20`);
  });

  it("sends no body on a GET", async () => {
    let body: unknown = "sentinel";
    const client = new ApiClient({
      baseUrl: BASE,
      fetch: async (_url, init) => {
        body = init?.body;
        return ok({});
      },
    });

    await client.get("/me");
    expect(body).toBeUndefined();
  });

  it("passes an idempotency key when given one", async () => {
    // docs/API/00 § Idempotency -- the order endpoint depends on it.
    let key: string | null = null;
    const client = new ApiClient({
      baseUrl: BASE,
      fetch: async (_url, init) => {
        key = new Headers(init?.headers).get("Idempotency-Key");
        return ok({});
      },
    });

    await client.post(
      "/orders",
      { invitation_id: "inv-1" },
      {
        idempotencyKey: "key-1",
      },
    );
    expect(key).toBe("key-1");
  });

  it("does not double a slash between the base url and the path", async () => {
    let url = "";
    const client = new ApiClient({
      baseUrl: `${BASE}/`,
      fetch: async (target) => {
        url = String(target);
        return ok({});
      },
    });

    await client.get("/me");
    expect(url).toBe(`${BASE}/me`);
  });
});
