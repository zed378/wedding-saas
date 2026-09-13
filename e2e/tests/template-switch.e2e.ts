import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import {
  API_ORIGIN,
  MINIMAL_TEMPLATE,
  WEB_APP_ORIGIN,
  fullStackConfigured,
  startFullStack,
  type FullStack,
} from "../fixtures/full-stack";

/**
 * `P2-14` step 2 — `docs/TESTING/03` § 2, "Changing templates mid-flow": fill in data with
 * Template A → switch to Template B → verify relevant data remains, unsupported sections are
 * hidden. And, per the card, switching back restores them.
 *
 * Against the real application (`fixtures/full-stack.ts`): the API, Postgres and the
 * production web-app build. The data is entered through the API — entering it is not what is
 * under test — and everything after that happens in the browser, through the editor's own
 * "Ganti template" control, reading what the live preview draws.
 */

const ACCOUNT_NUMBER = "8801 2345 6789";
const QUOTE =
  "Dan di antara tanda-tanda kekuasaan-Nya ialah Dia menciptakan pasangan.";

let stack: FullStack;

test.describe.configure({ mode: "serial" });

test.skip(
  !fullStackConfigured(),
  "Set E2E_FULL_STACK=1 and MIGRATION_DATABASE_URL — see fixtures/full-stack.ts.",
);

test.beforeAll(async () => {
  stack = await startFullStack();
});

test.afterAll(async () => {
  await stack?.stop();
});

async function apiAs(request: APIRequestContext, token: string) {
  const call = async (
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
    const body = (await response.json()) as { success: boolean; data: never };
    expect(
      body.success,
      `${method} ${path} → ${String(response.status())}`,
    ).toBe(true);
    return body.data as Record<string, unknown>;
  };
  return call;
}

/** The live preview's rendered invitation, by the renderer's own section markers. */
const preview = (page: Page) => page.locator("[data-device]");

test("a template switch hides what the new design lacks, loses nothing, and switching back restores it", async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);

  // ---- A user with an invitation on the reference template, with a gift account in it.
  const email = `switch-${Date.now()}@e2e.test`;
  const password = "Kata-Sandi-Uji-2026!";
  await request.post(`${API_ORIGIN}/api/v1/auth/register`, {
    data: { email, password, full_name: "Pengantin Uji" },
  });
  const login = await request.post(`${API_ORIGIN}/api/v1/auth/login`, {
    data: { email, password },
  });
  const token = ((await login.json()) as { data: { access_token: string } })
    .data.access_token;
  const api = await apiAs(request, token);

  const invitation = await api("POST", "/invitations", {
    template_id: stack.referenceTemplateId,
    internal_name: "Uji ganti template",
  });
  const id = invitation["id"] as string;

  await api("PATCH", `/invitations/${id}/quote`, { text: QUOTE });
  await api("POST", `/invitations/${id}/bank-accounts`, {
    type: "bank",
    provider_name: "BCA",
    account_number: ACCOUNT_NUMBER,
    account_holder: "Pengantin Uji",
  });
  // The reference template ships `gift` off by default (`enabled_by_default: false`).
  const settings = await api("GET", `/invitations/${id}/settings`);
  await api("PATCH", `/invitations/${id}/settings`, {
    enabled_sections: [...(settings["enabled_sections"] as string[]), "gift"],
  });

  // ---- In the browser: log in and open the editor.
  await page.goto(`${WEB_APP_ORIGIN}/login`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Kata sandi").fill(password);
  await page.getByRole("button", { name: "Masuk" }).click();
  await page.waitForURL(/\/dashboard/);

  await page.goto(`${WEB_APP_ORIGIN}/editor/${id}`);
  await expect(preview(page).locator('[data-section="gift"]')).toContainText(
    ACCOUNT_NUMBER,
    {
      timeout: 30_000,
    },
  );
  await expect(preview(page).locator('[data-section="quote"]')).toContainText(
    "tanda-tanda",
  );

  // ---- Switch to the design with no gift section.
  await page.getByRole("button", { name: "Ganti template" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Ganti template" });
  await dialog.getByRole("button", { name: MINIMAL_TEMPLATE.name }).click();

  const hidden = dialog.getByRole("list", {
    name: "Bagian yang tidak ditampilkan",
  });
  await expect(hidden).toBeVisible();
  // The confirmation names what stops showing before anything changes.
  await expect(hidden.getByRole("listitem")).not.toHaveCount(0);
  await expect(dialog.getByText(/tetap tersimpan/i)).toBeVisible();

  await dialog.getByRole("button", { name: "Ganti template" }).click();

  // The editor reloads on the new template: gift is gone from the preview, the quote is not.
  await expect(preview(page).locator('[data-section="gift"]')).toHaveCount(0, {
    timeout: 30_000,
  });
  await expect(preview(page)).not.toContainText(ACCOUNT_NUMBER);
  await expect(preview(page).locator('[data-section="quote"]')).toContainText(
    "tanda-tanda",
  );

  // Nothing was deleted: the account is still on the invitation.
  const afterSwitch = await api("GET", `/invitations/${id}`);
  expect(JSON.stringify(afterSwitch)).toContain(ACCOUNT_NUMBER);
  expect((afterSwitch["template"] as { slug: string }).slug).toBe(
    MINIMAL_TEMPLATE.slug,
  );

  // ---- And back: the gift section returns with its data.
  await page.getByRole("button", { name: "Ganti template" }).first().click();
  const back = page.getByRole("dialog", { name: "Ganti template" });
  await back.getByRole("button", { name: /elegant rose/i }).click();
  await back.getByRole("button", { name: "Ganti template" }).click();

  await expect(preview(page).locator('[data-section="gift"]')).toContainText(
    ACCOUNT_NUMBER,
    {
      timeout: 30_000,
    },
  );
  await expect(preview(page).locator('[data-section="quote"]')).toContainText(
    "tanda-tanda",
  );
});
