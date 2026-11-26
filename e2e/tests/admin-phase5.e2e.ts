import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { createHmac } from "node:crypto";
import {
  API_ORIGIN,
  PUBLIC_INVITE_ORIGIN,
  fullStackConfigured,
  startFullStack,
  type FullStack,
} from "../fixtures/full-stack";
import { startAdminServer } from "../fixtures/admin-server";

const ADMIN = "http://localhost:3300";
const password = "Kata-Sandi-Uji-2026!";
const reason = "Pemeriksaan penerimaan fase lima";
const fromApi = createRequire(
  resolve(__dirname, "../../backend/api/package.json"),
);
let stack: FullStack;
let stopAdmin: (() => Promise<void>) | undefined;
let pool: {
  query: (
    sql: string,
    values?: unknown[],
  ) => Promise<{ rows: Record<string, any>[] }>;
  end: () => Promise<void>;
};
let admin: { email: string; secret: string };

function totp(secret: string): string {
  const bits = [...secret]
    .map((char) =>
      "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
        .indexOf(char)
        .toString(2)
        .padStart(5, "0"),
    )
    .join("");
  const key = Buffer.from(
    bits.match(/.{8}/g)!.map((byte) => Number.parseInt(byte, 2)),
  );
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const hash = createHmac("sha1", key).update(counter).digest();
  const offset = hash[19]! & 15;
  return ((hash.readUInt32BE(offset) & 0x7fffffff) % 1_000_000)
    .toString()
    .padStart(6, "0");
}
async function api(
  request: APIRequestContext,
  method: string,
  path: string,
  data?: unknown,
  token?: string,
) {
  const response = await request.fetch(`${API_ORIGIN}/api/v1${path}`, {
    method,
    ...(data === undefined ? {} : { data }),
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  const body = await response.json();
  expect(
    body.success,
    `${method} ${path}: ${response.status()} ${JSON.stringify(body)}`,
  ).toBe(true);
  return body.data;
}
async function register(request: APIRequestContext, prefix: string) {
  const email = `${prefix}-${Date.now()}@e2e.test`;
  await api(request, "POST", "/auth/register", {
    email,
    password,
    full_name: "Penerimaan Lima",
  });
  await stack.verifyEmail(email);
  return email;
}
async function loginAdmin(page: Page) {
  await page.goto(ADMIN);
  await page.getByLabel("Email Administrator").fill(admin.email);
  await page.getByLabel(/Kata Sandi/).fill(password);
  await page.getByRole("button", { name: "Masuk ke Panel Admin" }).click();
  await expect(
    page.getByRole("heading", { name: "Verifikasi 2 Langkah" }),
  ).toBeVisible();
  await page.locator('input[inputmode="numeric"]').fill(totp(admin.secret));
  await page.getByRole("button", { name: /Verifikasi/ }).click();
  await expect(page.getByRole("navigation")).toBeVisible();
}

test.describe.configure({ mode: "serial" });
test.skip(
  !fullStackConfigured(),
  "Requires E2E_FULL_STACK and a dedicated migrated test database.",
);
test.beforeAll(async ({ request }) => {
  test.setTimeout(180_000);
  stack = await startFullStack({ publicInvite: true });
  stopAdmin = await startAdminServer();
  const { Pool } = fromApi("pg");
  pool = new Pool({ connectionString: process.env["MIGRATION_DATABASE_URL"] });
  const email = await register(request, "phase5-admin");
  await pool.query("UPDATE users SET role='admin' WHERE email=$1", [email]);
  const challenge = await api(request, "POST", "/auth/login", {
    email,
    password,
  });
  const setup = await api(request, "POST", "/auth/mfa/setup", {
    setup_ticket: challenge.setup_ticket,
  });
  await api(request, "POST", "/auth/mfa/confirm", {
    setup_ticket: challenge.setup_ticket,
    code: totp(setup.secret),
    recovery_codes: setup.recovery_codes,
  });
  admin = { email, secret: setup.secret };
});
test.afterAll(async () => {
  await stopAdmin?.();
  await pool?.end();
  await stack?.stop();
});

test("admin approves a pending guestbook message and the public page immediately displays it", async ({
  page,
  request,
}, info) => {
  test.setTimeout(120_000);
  const email = await register(request, "phase5-owner");
  const session = await api(request, "POST", "/auth/login", {
    email,
    password,
  });
  const token = session.access_token;
  const slug = `moderasi-${Date.now()}`;
  const invitation = await api(
    request,
    "POST",
    "/invitations",
    {
      template_id: stack.referenceTemplateId,
      internal_name: "Penerimaan moderasi",
      slug,
    },
    token,
  );
  await api(
    request,
    "PATCH",
    `/invitations/${invitation.id}/couple/groom`,
    { full_name: "Budi Santoso", nickname: "Budi" },
    token,
  );
  await api(
    request,
    "PATCH",
    `/invitations/${invitation.id}/couple/bride`,
    { full_name: "Siti Aminah", nickname: "Siti" },
    token,
  );
  await api(
    request,
    "PATCH",
    `/invitations/${invitation.id}/quote`,
    { text: "Bersama dalam kebahagiaan." },
    token,
  );
  await api(
    request,
    "POST",
    `/invitations/${invitation.id}/events`,
    {
      type: "akad",
      title: "Akad Nikah",
      event_date: "2027-05-15",
      start_time: "08:00",
      venue_name: "Masjid Agung",
      address: "Jalan Merdeka 1",
    },
    token,
  );
  const settings = await api(
    request,
    "GET",
    `/invitations/${invitation.id}/settings`,
    undefined,
    token,
  );
  await api(
    request,
    "PATCH",
    `/invitations/${invitation.id}/settings`,
    {
      enabled_sections: settings.enabled_sections.filter(
        (section: string) => section !== "gallery",
      ),
      guestbook_moderation: true,
    },
    token,
  );
  await api(
    request,
    "POST",
    `/invitations/${invitation.id}/publish`,
    undefined,
    token,
  );
  const message = `Selamat berbahagia dari penerimaan ${Date.now()}`;
  const submitted = await request.post(
    `${API_ORIGIN}/public/i/${slug}/guestbook`,
    { data: { guest_name: "Tamu Penerimaan", message } },
  );
  expect(submitted.ok(), await submitted.text()).toBe(true);
  const submittedEntry = (await submitted.json()).data;
  await page.goto(`${PUBLIC_INVITE_ORIGIN}/${slug}`);
  await expect(page.getByText(message)).toHaveCount(0);
  await loginAdmin(page);
  const sidebar = page.getByRole("complementary", { name: "Navigasi Admin" });
  const sidebarWidth = (await sidebar.boundingBox())!.width;
  await page.getByRole("link", { name: /Moderasi/ }).click();
  const row = page.getByRole("row").filter({ hasText: message });
  await expect(row).toBeVisible();
  expect((await sidebar.boundingBox())!.width).toBe(sidebarWidth);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("moderation-pending.png"),
    fullPage: true,
  });
  await row.getByRole("button", { name: /Setujui pesan/ }).click();
  await page.getByLabel(/Alasan Moderasi/).fill(reason);
  await page.getByRole("button", { name: "Konfirmasi Setujui" }).click();
  await expect(row).toHaveCount(0);
  await page.goto(`${PUBLIC_INVITE_ORIGIN}/${slug}`);
  await page
    .getByRole("button", { name: "Buka Undangan", exact: true })
    .click();
  await page.getByText(message).scrollIntoViewIfNeeded();
  await expect(page.getByText(message)).toBeVisible();
  await expect(page.getByText(message)).toBeInViewport();
  await page.screenshot({
    path: info.outputPath("approved-public.png"),
    fullPage: false,
  });
  const audit = await pool.query(
    "SELECT action, reason FROM audit_logs WHERE reason=$1 AND resource_id=$2 AND action='guestbook.moderate'",
    [reason, submittedEntry.id],
  );
  expect(audit.rows).toHaveLength(1);
});

test("admin authors and publishes a template in the browser and a user creates an invitation without deployment", async ({
  page,
  request,
}, info) => {
  test.setTimeout(120_000);
  await loginAdmin(page);
  await page.getByRole("link", { name: /Templat/ }).click();
  await page.getByRole("button", { name: /Tambah Templat Baru/ }).click();
  const name = `Penerimaan Tanpa Deploy ${Date.now()}`;
  const slug = `penerimaan-${Date.now()}`;
  await page.getByLabel("Nama Templat *", { exact: true }).fill(name);
  await page.getByLabel("Slug *", { exact: true }).fill(slug);
  await page.getByLabel(/Alasan Pembuatan \(Audit/).fill(reason);
  const created = page.waitForResponse(
    (res) =>
      res.url().endsWith("/api/v1/admin/templates") &&
      res.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Buat Templat", exact: true }).click();
  const template = (await (await created).json()).data;
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Rilis Versi Baru/ }).click();
  await page.getByLabel(/Alasan Pembuatan Versi/).fill(reason);
  const versionResponse = page.waitForResponse(
    (res) =>
      res.url().endsWith(`/templates/${template.id}/versions`) &&
      res.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Buat Versi Draf" }).click();
  const versionBody = await (await versionResponse).json();
  expect(versionBody.success, JSON.stringify(versionBody)).toBe(true);
  const version = versionBody.data;
  await page.getByRole("button", { name: /Publikasikan Versi/ }).click();
  await page.getByLabel(/Alasan Publikasi/).fill(reason);
  await page.getByRole("button", { name: "Ya, Publikasikan Sekarang" }).click();
  await expect(page.getByRole("button", { name: /Depresiasi/ })).toBeVisible();
  await page.screenshot({
    path: info.outputPath("template-published.png"),
    fullPage: true,
  });
  const email = await register(request, "phase5-new-couple");
  const session = await api(request, "POST", "/auth/login", {
    email,
    password,
  });
  const catalog = await api(
    request,
    "GET",
    `/templates?search=${encodeURIComponent(name)}`,
  );
  expect(catalog).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: template.id })]),
  );
  const invitation = await api(
    request,
    "POST",
    "/invitations",
    {
      template_id: template.id,
      internal_name: "Templat baru langsung tersedia",
    },
    session.access_token,
  );
  const stored = await pool.query(
    "SELECT template_version_id FROM invitations WHERE id=$1",
    [invitation.id],
  );
  expect(stored.rows[0]!.template_version_id).toBe(version.id);
  const audit = await pool.query(
    "SELECT action,reason FROM audit_logs WHERE resource_id IN ($1,$2)",
    [template.id, version.id],
  );
  expect(audit.rows.map((row) => row.action).sort()).toEqual(
    [
      "template.create",
      "template_version.create",
      "template_version.publish",
    ].sort(),
  );
  expect(audit.rows.every((row) => row.reason === reason)).toBe(true);
});
