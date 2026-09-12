import { expect } from "vitest";
import type { Pool } from "pg";

import { createTwoTenants, type TwoTenants } from "./factories";

/**
 * P1-06 — the reusable IDOR assertion. `docs/SECURITY/05` § Testing Checklist.
 *
 * `docs/SECURITY/04` § Mandatory Testing makes "User B cannot access User A's resource" a
 * definition-of-done item for **every** `:id` endpoint, and
 * `scripts/check-id-endpoint-tests.mjs` fails the build without one. A mandatory test
 * that is tedious to write is a mandatory test somebody eventually writes badly, so the
 * point of this file is that the honest version costs one line.
 *
 * Two entry points, because there are two layers to get wrong:
 *
 *   `expectServiceIdorSafe` — the service, called directly, with no HTTP anywhere. This
 *     is the one `docs/SECURITY/04` § Implementation Principle 2 is about: a job or
 *     another module calling the service must not be able to reach another tenant's row.
 *
 *   `expectHttpIdorSafe` — the endpoint, over supertest, asserting **404 and an empty
 *     body**. Both halves matter: a 404 whose body contains the resource is a leak with a
 *     misleading status code.
 */

/** Re-exported so a test needs one import to get both the fixture and the assertion. */
export { createTwoTenants, type TwoTenants };

export interface IdorService {
  /**
   * How the non-owner would try to reach it.
   *
   * Given Mallory's scope and the id of Alice's resource, call the service exactly as a
   * legitimate request would. Anything but a rejection is a finding.
   */
  (): Promise<unknown>;
}

/**
 * Assert that a service call made by a non-owner does not return the owner's resource.
 *
 * Accepts either shape a `P0-11`-based service can take: throwing `NotFoundError`, or
 * returning `null`. Both are correct — what is not correct is returning the row.
 *
 * ```ts
 * await expectServiceIdorSafe(() =>
 *   service.get(alice.invitation.id, mallory.user.scope),
 * );
 * ```
 */
export async function expectServiceIdorSafe(
  attempt: IdorService,
  options: { readonly mustNotContain?: readonly string[] } = {},
): Promise<void> {
  let result: unknown;
  let thrown: unknown;

  try {
    result = await attempt();
  } catch (error) {
    thrown = error;
  }

  if (thrown !== undefined) {
    const status = (thrown as { status?: number }).status;
    // A 403 here would be a finding, not a pass: `docs/SECURITY/04`'s note is explicit
    // that 403 confirms the resource exists. 404 or a plain null are the only answers.
    expect(
      status,
      "a non-owner must get 404, never 403 — a 403 confirms the resource exists " +
        "(docs/SECURITY/04 § Note)",
    ).toBe(404);
    return;
  }

  expect(
    result ?? null,
    "the service returned data for a resource the caller does not own",
  ).toBeNull();

  for (const secret of options.mustNotContain ?? []) {
    expect(JSON.stringify(result ?? null)).not.toContain(secret);
  }
}

export interface HttpResponseLike {
  readonly status: number;
  readonly body: unknown;
}

/**
 * Assert that an HTTP request from a non-owner answers 404 with nothing in it.
 *
 * `perform` is given nothing and is expected to close over the request: it exists so the
 * caller can build the supertest chain, including whichever authentication the endpoint
 * needs.
 *
 * ```ts
 * await expectHttpIdorSafe(
 *   () => request(app.getHttpServer())
 *           .get(`/api/v1/invitations/${alice.invitation.id}`)
 *           .set("Authorization", `Bearer ${malloryToken}`),
 *   { mustNotContain: ["Alice's wedding"] },
 * );
 * ```
 */
export async function expectHttpIdorSafe(
  perform: () => PromiseLike<HttpResponseLike>,
  options: { readonly mustNotContain?: readonly string[] } = {},
): Promise<void> {
  const response = await perform();

  expect(
    response.status,
    "a non-owner must get 404 — 403 confirms the resource exists, and 200 is a leak",
  ).toBe(404);

  const serialised = JSON.stringify(response.body ?? null);

  // The envelope's error object is expected; a `data` key is not. A 404 that still
  // carries the resource is the failure mode a status-code-only assertion misses.
  expect(
    (response.body as { data?: unknown } | null)?.data,
    "a 404 response must carry no resource data",
  ).toBeUndefined();

  for (const secret of options.mustNotContain ?? []) {
    expect(
      serialised,
      `the 404 body leaked ${JSON.stringify(secret)}`,
    ).not.toContain(secret);
  }
}

/**
 * The whole standard IDOR case for a service, in one call.
 *
 * Builds the two tenants, then asserts that Mallory cannot reach Alice's invitation
 * through `attempt`, and — just as importantly — that Alice **can**. A check that refuses
 * everybody passes an IDOR test and breaks the product; without the positive half, a
 * service that always returned null would look perfectly secure.
 */
export async function expectIdorSafe(
  pool: Pool,
  attempt: (
    invitationId: string,
    scope: TwoTenants["alice"]["user"]["scope"],
  ) => Promise<unknown>,
  options: { readonly mustNotContain?: readonly string[] } = {},
): Promise<TwoTenants> {
  const tenants = await createTwoTenants(pool);

  await expectServiceIdorSafe(
    () => attempt(tenants.alice.invitation.id, tenants.mallory.user.scope),
    options,
  );

  const ownersView = await attempt(
    tenants.alice.invitation.id,
    tenants.alice.user.scope,
  );
  expect(
    ownersView ?? null,
    "the owner must still be able to reach their own resource — a check that refuses " +
      "everybody passes every IDOR test and ships a broken product",
  ).not.toBeNull();

  return tenants;
}
