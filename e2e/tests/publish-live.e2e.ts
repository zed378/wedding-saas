import { test, expect, type APIRequestContext } from "@playwright/test";

import {
  API_ORIGIN,
  PUBLIC_INVITE_ORIGIN,
  fullStackConfigured,
  startFullStack,
  type FullStack,
} from "../fixtures/full-stack";

/**
 * `P3-09` DoD — "the public page is live within five seconds, measured in an E2E test"
 * (`docs/PLAN/17`). Against the real API, Postgres and the production public-invite build.
 *
 * The invitation is filled in through the API — entering data is not under test — then published, and
 * the clock runs from the publish response to the first 200 from the public address. It is published as
 * a BR-2.8 trial (the account never paid), so the page must also carry the trial notice.
 */

let stack: FullStack;

test.describe.configure({ mode: "serial" });

test.skip(
  !fullStackConfigured(),
  "Set E2E_FULL_STACK=1 and MIGRATION_DATABASE_URL — see fixtures/full-stack.ts.",
);

test.beforeAll(async () => {
  stack = await startFullStack({ publicInvite: true });
});

test.afterAll(async () => {
  await stack?.stop();
});

async function apiAs(request: APIRequestContext, token: string) {
  return async (
    method: "GET" | "POST" | "PATCH",
    path: string,
    data?: unknown,
  ) => {
    const response = await request.fetch(`${API_ORIGIN}/api/v1${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      ...(data === undefined ? {} : { data }),
    });
    const body = (await response.json()) as {
      success: boolean;
      data: Record<string, unknown>;
      error?: unknown;
    };
    expect(
      body.success,
      `${method} ${path} → ${String(response.status())} ${JSON.stringify(body.error)}`,
    ).toBe(true);
    return body.data;
  };
}

test("a published invitation is reachable at its public address within five seconds", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);

  const email = `publish-${Date.now()}@e2e.test`;
  const password = "Kata-Sandi-Uji-2026!";
  await request.post(`${API_ORIGIN}/api/v1/auth/register`, {
    data: { email, password, full_name: "Pengantin Uji" },
  });
  await stack.verifyEmail(email);
  const login = await request.post(`${API_ORIGIN}/api/v1/auth/login`, {
    data: { email, password },
  });
  const token = ((await login.json()) as { data: { access_token: string } })
    .data.access_token;
  const api = await apiAs(request, token);

  const slug = `terbit-${Date.now()}`;
  const invitation = await api("POST", "/invitations", {
    template_id: stack.referenceTemplateId,
    internal_name: "Uji terbit",
    slug,
  });
  const id = invitation["id"] as string;

  await api("PATCH", `/invitations/${id}/couple/groom`, {
    full_name: "Budi Santoso",
    nickname: "Budi",
  });
  await api("PATCH", `/invitations/${id}/couple/bride`, {
    full_name: "Siti Aminah",
    nickname: "Siti",
  });
  await api("PATCH", `/invitations/${id}/quote`, {
    text: "Dan di antara tanda-tanda kekuasaan-Nya.",
  });
  await api("POST", `/invitations/${id}/events`, {
    type: "akad",
    title: "Akad Nikah",
    event_date: "2027-05-15",
    start_time: "08:00",
    venue_name: "Masjid Agung",
    address: "Jalan Merdeka 1",
  });
  // No photos in this run: the gallery section is switched off rather than filled.
  const settings = await api("GET", `/invitations/${id}/settings`);
  await api("PATCH", `/invitations/${id}/settings`, {
    enabled_sections: (settings["enabled_sections"] as string[]).filter(
      (key) => key !== "gallery",
    ),
  });

  const check = await api("GET", `/invitations/${id}/publish-check`);
  expect(check["details"], "the fixture invitation must be complete").toEqual(
    [],
  );

  const published = await api("POST", `/invitations/${id}/publish`);
  const clock = Date.now();
  expect(published).toMatchObject({ status: "published", slug, trial: true });

  // ---- The clock: the first 200 from the public address.
  let live = false;
  while (Date.now() - clock < 5_000) {
    const response = await request.get(`${PUBLIC_INVITE_ORIGIN}/${slug}`);
    if (response.status() === 200) {
      live = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const elapsed = Date.now() - clock;
  expect(live, `not live after ${String(elapsed)} ms`).toBe(true);
  expect(elapsed).toBeLessThan(5_000);

  // ---- And it is the invitation, in a browser, marked as a trial.
  await page.goto(`${PUBLIC_INVITE_ORIGIN}/${slug}`);
  await expect(page.locator("body")).toContainText("Budi");
  await expect(page.locator('[data-trial-watermark="true"]')).toBeVisible();
});
