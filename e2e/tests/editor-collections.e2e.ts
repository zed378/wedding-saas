import { test, expect, type APIRequestContext } from "@playwright/test";

import {
  API_ORIGIN,
  WEB_APP_ORIGIN,
  fullStackConfigured,
  startFullStack,
  type FullStack,
} from "../fixtures/full-stack";

/**
 * `P2-15` — editing events and gift accounts in the running editor, against the real API.
 *
 * Before `P2-15` this exact flow failed silently: the event panel showed empty fields for an
 * event that existed, typing sent no request at all, and the preview drew no date. Every unit
 * test passed, because every unit test fed the editor a canonical fixture the API never sends.
 * This one reads what the database holds after the browser is done.
 */

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

async function signUp(request: APIRequestContext) {
  const email = `collections-${Date.now()}@e2e.test`;
  const password = "Kata-Sandi-Uji-2026!";
  await request.post(`${API_ORIGIN}/api/v1/auth/register`, {
    data: { email, password, full_name: "Pengantin Uji" },
  });
  const login = await request.post(`${API_ORIGIN}/api/v1/auth/login`, {
    data: { email, password },
  });
  const token = ((await login.json()) as { data: { access_token: string } })
    .data.access_token;
  const headers = { authorization: `Bearer ${token}` };
  return { email, password, headers };
}

test("an event edited and a gift account added in the editor are stored, survive a reload, and show in the preview", async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const { email, password, headers } = await signUp(request);

  const created = await request.post(`${API_ORIGIN}/api/v1/invitations`, {
    headers,
    data: {
      template_id: stack.referenceTemplateId,
      internal_name: "Uji koleksi",
    },
  });
  const id = ((await created.json()) as { data: { id: string } }).data.id;
  const event = await request.post(
    `${API_ORIGIN}/api/v1/invitations/${id}/events`,
    {
      headers,
      data: {
        type: "akad",
        title: "Akad Nikah",
        event_date: "2027-05-15",
        start_time: "08:00",
        venue_name: "Masjid Agung",
        address: "Jl. Asia Afrika 1",
      },
    },
  );
  expect(event.status()).toBe(201);
  // The gift section ships off; turn it on so the preview draws it.
  const settings = await request.get(
    `${API_ORIGIN}/api/v1/invitations/${id}/settings`,
    { headers },
  );
  const enabled = (
    (await settings.json()) as { data: { enabled_sections: string[] } }
  ).data.enabled_sections;
  await request.patch(`${API_ORIGIN}/api/v1/invitations/${id}/settings`, {
    headers,
    data: { enabled_sections: [...enabled, "gift"] },
  });

  await page.goto(`${WEB_APP_ORIGIN}/login`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Kata sandi").fill(password);
  await page.getByRole("button", { name: "Masuk" }).click();
  await page.waitForURL(/\/dashboard/);

  // ---- The event panel shows the stored event, and the preview draws its date and time.
  await page.goto(`${WEB_APP_ORIGIN}/editor/${id}`);
  await page
    .getByRole("button", { name: /^Acara/ })
    .first()
    .click();
  const panel = page.locator("#editor-properties");
  const row = panel.getByRole("group", { name: "Acara 1" });
  await expect(row.getByLabel(/judul acara/i)).toHaveValue("Akad Nikah", {
    timeout: 30_000,
  });
  await expect(row.getByLabel(/waktu mulai/i)).toHaveValue("08:00");

  // The toggles show the invitation's own selection: gift was turned on above.
  await expect(
    page.getByRole("checkbox", { name: /tampilkan hadiah/i }),
  ).toBeChecked();

  const preview = page.locator("[data-device]");
  await expect(preview.locator('[data-section="event"]')).toContainText(
    "15 Mei 2027",
  );

  // ---- Edit the title; autosave must PATCH that event and succeed.
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      /\/events\/[0-9a-f-]{36}$/.test(response.url()),
  );
  await row.getByLabel(/judul acara/i).fill("Akad Nikah Keluarga");
  expect((await saved).status()).toBe(200);
  await expect(preview.locator('[data-section="event"]')).toContainText(
    "Akad Nikah Keluarga",
  );

  // ---- P2-17: choose the event's region; its province decides the zone.
  const province = row.getByRole("combobox", { name: "Provinsi" });
  await expect(province.getByRole("option", { name: "Bali" })).toBeAttached({
    timeout: 30_000,
  });
  const regionSaved = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      /\/events\/[0-9a-f-]{36}$/.test(response.url()) &&
      (response.request().postData() ?? "").includes("region_code"),
  );
  await province.selectOption("51");
  await expect(row.getByRole("combobox", { name: /zona waktu/i })).toHaveValue(
    "Asia/Makassar",
  );
  expect((await regionSaved).status()).toBe(200);
  await expect(preview.locator('[data-section="event"]')).toContainText("WITA");

  // ---- Add a gift account from the panel.
  await page
    .getByRole("button", { name: /^Hadiah/ })
    .first()
    .click();
  await panel.getByRole("button", { name: "Tambah rekening" }).click();
  const form = panel.getByRole("group", { name: "Rekening baru" });
  await form.getByLabel(/nama bank/i).fill("BCA");
  await form.getByLabel(/nomor rekening/i).fill("8801 2345 6789");
  await form.getByLabel(/atas nama/i).fill("Pengantin Uji");
  await form.getByRole("button", { name: "Simpan rekening" }).click();
  await expect(panel.getByRole("group", { name: "Rekening 1" })).toBeVisible();
  await expect(preview.locator('[data-section="gift"]')).toContainText(
    "8801 2345 6789",
  );

  // ---- What the database holds.
  const detail = await request.get(`${API_ORIGIN}/api/v1/invitations/${id}`, {
    headers,
  });
  const body = (await detail.json()) as {
    data: {
      events: { title: string; start_time: string }[];
      bank_accounts: { account_number: string }[];
    };
  };
  expect(body.data.events[0]?.title).toBe("Akad Nikah Keluarga");
  expect(body.data.events[0]?.start_time).toBe("08:00");
  expect(
    (body.data.events[0] as unknown as { region_code: string }).region_code,
  ).toBe("51");
  expect(
    (body.data.events[0] as unknown as { timezone: string }).timezone,
  ).toBe("Asia/Makassar");
  expect(body.data.bank_accounts.map((a) => a.account_number)).toEqual([
    "8801 2345 6789",
  ]);

  // ---- And after a reload, the editor shows what was stored.
  await page.reload();
  await page
    .getByRole("button", { name: /^Acara/ })
    .first()
    .click();
  await expect(
    panel.getByRole("group", { name: "Acara 1" }).getByLabel(/judul acara/i),
  ).toHaveValue("Akad Nikah Keluarga", { timeout: 30_000 });
  await expect(page.getByText(/gagal|belum tersimpan/i)).toHaveCount(0);
});
