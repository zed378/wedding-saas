import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  UsersPage,
  type AdminUserSummaryItem,
  type AdminUserDetailItem,
} from "./UsersPage.js";
import { accessTokenStore } from "@wi/api-client";

const INITIAL_MOCK_USERS: AdminUserSummaryItem[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    email: "budi.santoso@example.com",
    fullName: "Budi Santoso",
    phone: "08123456789",
    role: "user",
    status: "active",
    emailVerified: true,
    createdAt: "2026-01-10T08:00:00.000Z",
    updatedAt: "2026-01-10T08:00:00.000Z",
    invitationCount: 2,
    orderCount: 1,
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    email: "siti.nurhaliza@example.com",
    fullName: "Siti Nurhaliza",
    phone: "08987654321",
    role: "user",
    status: "suspended",
    emailVerified: true,
    createdAt: "2026-01-15T10:30:00.000Z",
    updatedAt: "2026-02-01T14:20:00.000Z",
    invitationCount: 1,
    orderCount: 1,
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    email: "andi.pratama@example.com",
    fullName: "Andi Pratama",
    phone: "08567890123",
    role: "user",
    status: "active",
    emailVerified: false,
    createdAt: "2026-02-05T09:15:00.000Z",
    updatedAt: "2026-02-05T09:15:00.000Z",
    invitationCount: 0,
    orderCount: 0,
  },
];

const INITIAL_MOCK_DETAILS: Record<string, AdminUserDetailItem> = {
  "11111111-1111-4111-8111-111111111111": {
    ...INITIAL_MOCK_USERS[0]!,
    invitations: [
      {
        id: "inv-budi-1",
        slug: "budi-and-ratna",
        internalName: "Pernikahan Budi & Ratna (Resepsi)",
        status: "published",
        templateId: "tpl-javanese-classic",
        templateVersionId: "ver-100",
        publishedAt: "2026-01-12T10:00:00.000Z",
        createdAt: "2026-01-10T09:00:00.000Z",
      },
      {
        id: "inv-budi-2",
        slug: "budi-ratna-unduh-mantu",
        internalName: "Unduh Mantu Solo",
        status: "draft",
        templateId: "tpl-modern-minimalist",
        templateVersionId: "ver-100",
        publishedAt: null,
        createdAt: "2026-01-14T11:00:00.000Z",
      },
    ],
    orders: [
      {
        id: "ord-budi-1",
        packageId: "standard",
        amountTotal: "149000",
        status: "paid",
        createdAt: "2026-01-11T14:30:00.000Z",
      },
    ],
  },
  "22222222-2222-4222-8222-222222222222": {
    ...INITIAL_MOCK_USERS[1]!,
    invitations: [
      {
        id: "inv-siti-1",
        slug: "siti-dan-fajar",
        internalName: "Walimatul Ursy Siti & Fajar",
        status: "published",
        templateId: "tpl-sundanese-romantic",
        templateVersionId: "ver-100",
        publishedAt: "2026-01-20T08:00:00.000Z",
        createdAt: "2026-01-15T11:00:00.000Z",
      },
    ],
    orders: [
      {
        id: "ord-siti-1",
        packageId: "premium",
        amountTotal: "249000",
        status: "paid",
        createdAt: "2026-01-16T15:00:00.000Z",
      },
    ],
  },
  "33333333-3333-4333-8333-333333333333": {
    ...INITIAL_MOCK_USERS[2]!,
    invitations: [],
    orders: [],
  },
};

function usersResponse(url: unknown) {
  const target = new URL(String(url), "http://localhost");
  const item = INITIAL_MOCK_DETAILS[target.pathname.split("/").at(-1) ?? ""];
  const search = target.searchParams.get("search")?.toLowerCase() ?? "";
  const status = target.searchParams.get("status");
  const data =
    item ??
    INITIAL_MOCK_USERS.filter(
      (u) =>
        (!search ||
          `${u.fullName} ${u.email}`.toLowerCase().includes(search)) &&
        (!status || u.status === status),
    );
  return new Response(JSON.stringify({ success: true, data }), { status: 200 });
}

describe("Admin User Management UI (P5-06)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    accessTokenStore.set("admin-access-token");
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) =>
      usersResponse(url),
    );
  });

  it("loads the authenticated user list without production demo data", async () => {
    render(<UsersPage />);
    expect(screen.getByText("Manajemen Pengguna")).toBeDefined();
    expect(await screen.findByText("Budi Santoso")).toBeDefined();
    expect(screen.getByText("Siti Nurhaliza")).toBeDefined();
    expect(screen.getByText("Andi Pratama")).toBeDefined();
  });

  it("displays a failed list request instead of fabricated accounts", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("{}", { status: 503 }));
    render(<UsersPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("HTTP 503");
    expect(screen.queryByText("Budi Santoso")).toBeNull();
  });

  it("does not replace failed detail requests with fabricated invitations", async () => {
    const spy = vi.mocked(fetch);
    spy.mockImplementation(async (url) =>
      String(url).includes("/users/")
        ? new Response("{}", { status: 500 })
        : usersResponse(url),
    );
    render(<UsersPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Lihat detail Budi Santoso/ }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("HTTP 500");
    expect(screen.queryByText("Pernikahan Budi & Ratna (Resepsi)")).toBeNull();
  });

  it("filters users by search query (name or email)", async () => {
    render(<UsersPage />);
    const searchInput = screen.getByLabelText(/Cari Pengguna/i);

    fireEvent.change(searchInput, { target: { value: "budi" } });

    await waitFor(() => {
      expect(screen.getByText("Budi Santoso")).toBeDefined();
      expect(screen.queryByText("Siti Nurhaliza")).toBeNull();
      expect(screen.queryByText("Andi Pratama")).toBeNull();
    });
  });

  it("filters users by status (active / suspended)", async () => {
    render(<UsersPage />);
    const statusSelect = screen.getByLabelText(/Status Akun/i);

    fireEvent.change(statusSelect, { target: { value: "suspended" } });

    await waitFor(() => {
      expect(screen.getByText("Siti Nurhaliza")).toBeDefined();
      expect(screen.queryByText("Budi Santoso")).toBeNull();
      expect(screen.queryByText("Andi Pratama")).toBeNull();
    });
  });

  it("opens user detail modal showing account info, invitations, and orders", async () => {
    render(<UsersPage />);

    // Click "Detail" on Budi Santoso
    const detailBtn = await screen.findByRole("button", {
      name: /Lihat detail Budi Santoso/i,
    });
    fireEvent.click(detailBtn);

    await waitFor(() => {
      expect(screen.getByText("Detail Pengguna & Aktivitas")).toBeDefined();
      expect(screen.getByText("Daftar Undangan Pernikahan")).toBeDefined();
      expect(screen.getByText("Riwayat Transaksi Pesanan")).toBeDefined();
      expect(
        screen.getByText("Pernikahan Budi & Ratna (Resepsi)"),
      ).toBeDefined();
      expect(screen.getByText("Paket STANDARD")).toBeDefined();
    });
  });

  it("enforces minimum 5 characters reason for suspension and displays BR-Admin.6 note", async () => {
    render(<UsersPage />);

    // Click "Tangguhkan" on Budi Santoso
    const suspendBtn = await screen.findByRole("button", {
      name: /Tangguhkan Budi Santoso/i,
    });
    fireEvent.click(suspendBtn);

    // Verify modal is open and has BR-Admin.6 explanation note
    expect(screen.getByText(/Tangguhkan Akun Pengguna/i)).toBeDefined();
    expect(
      screen.getByText(
        /Menangguhkan akun akan menghentikan akses login pengguna. Undangan yang sudah terbit tetap aktif dan dapat diakses tamu \(BR-Admin.6\)\./i,
      ),
    ).toBeDefined();

    const confirmBtn = screen.getByRole("button", {
      name: /Konfirmasi Penangguhan/i,
    });
    // Disabled initially because reason is empty
    expect((confirmBtn as HTMLButtonElement).disabled).toBe(true);

    const reasonInput = screen.getByLabelText(/Alasan Penangguhan/i);
    fireEvent.change(reasonInput, { target: { value: "abc" } }); // 3 chars
    expect((confirmBtn as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(reasonInput, {
      target: { value: "Spam bot behavior detected" },
    }); // > 5 chars
    expect((confirmBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it("requires fresh MFA before sending authenticated suspension with its audit reason", async () => {
    accessTokenStore.set("admin-access-token");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (url, _init) => {
        if (url === "/api/v1/auth/mfa/step-up") {
          return new Response(
            JSON.stringify({
              success: true,
              data: { step_up_token: "fresh-step-up-proof" },
            }),
            { status: 200 },
          );
        }
        if (typeof url === "string" && url.includes("/suspend")) {
          return new Response(
            JSON.stringify({
              success: true,
              data: {
                id: "11111111-1111-4111-8111-111111111111",
                status: "suspended",
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return usersResponse(url);
      });

    render(<UsersPage />);

    const suspendBtn = await screen.findByRole("button", {
      name: /Tangguhkan Budi Santoso/i,
    });
    fireEvent.click(suspendBtn);

    const reasonInput = screen.getByLabelText(/Alasan Penangguhan/i);
    fireEvent.change(reasonInput, {
      target: { value: "Penyalahgunaan fasilitas broadcast tamu" },
    });

    const confirmBtn = screen.getByRole("button", {
      name: /Konfirmasi Penangguhan/i,
    });
    fireEvent.click(confirmBtn);

    expect(
      fetchSpy.mock.calls.some(
        ([url]) => typeof url === "string" && url.endsWith("/suspend"),
      ),
    ).toBe(false);
    fireEvent.change(screen.getByLabelText(/Kode Verifikasi 6-Digit/), {
      target: { value: "123456" },
    });
    fireEvent.submit(
      screen.getByLabelText(/Kode Verifikasi 6-Digit/).closest("form")!,
    );

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/v1/admin/users/11111111-1111-4111-8111-111111111111/suspend",
        expect.objectContaining({
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer admin-access-token",
            "X-MFA-Step-Up": "fresh-step-up-proof",
          },
          body: JSON.stringify({
            reason: "Penyalahgunaan fasilitas broadcast tamu",
          }),
        }),
      );
    });
  });

  it("keeps suspension uncommitted and displays an API rejection after verified MFA", async () => {
    accessTokenStore.set("admin-access-token");
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (url === "/api/v1/auth/mfa/step-up") {
        return new Response(
          JSON.stringify({
            success: true,
            data: { step_up_token: "fresh-proof" },
          }),
          { status: 200 },
        );
      }
      if (typeof url === "string" && url.endsWith("/suspend")) {
        return new Response(
          JSON.stringify({
            error: {
              code: "MFA_STEP_UP_REQUIRED",
              message: "Bukti verifikasi kedaluwarsa",
            },
          }),
          { status: 403 },
        );
      }
      return usersResponse(url);
    });
    render(<UsersPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Tangguhkan Budi Santoso/i }),
    );
    fireEvent.change(screen.getByLabelText(/Alasan Penangguhan/i), {
      target: { value: "Alasan administratif yang sah" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /Konfirmasi Penangguhan/i }),
    );
    fireEvent.change(screen.getByLabelText(/Kode Verifikasi 6-Digit/), {
      target: { value: "123456" },
    });
    fireEvent.submit(
      screen.getByLabelText(/Kode Verifikasi 6-Digit/).closest("form")!,
    );
    expect(
      (await screen.findAllByText("Bukti verifikasi kedaluwarsa")).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: /Konfirmasi Penangguhan/i }),
    ).toBeDefined();
  });

  it("sends PATCH request with audit reason on user unsuspension", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (url, _init) => {
        if (typeof url === "string" && url.includes("/unsuspend")) {
          return new Response(
            JSON.stringify({
              success: true,
              data: {
                id: "22222222-2222-4222-8222-222222222222",
                status: "active",
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return usersResponse(url);
      });

    render(<UsersPage />);

    // Siti Nurhaliza is suspended in initial mock
    const unsuspendBtn = await screen.findByRole("button", {
      name: /Aktifkan kembali Siti Nurhaliza/i,
    });
    fireEvent.click(unsuspendBtn);

    expect(screen.getByText(/Aktifkan Kembali Akun Pengguna/i)).toBeDefined();

    const reasonInput = screen.getByLabelText(/Alasan Pengaktifan Kembali/i);
    fireEvent.change(reasonInput, {
      target: { value: "Tiket verifikasi ID #8843 telah disetujui" },
    });

    const confirmBtn = screen.getByRole("button", {
      name: /Konfirmasi Aktifkan Kembali/i,
    });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/v1/admin/users/22222222-2222-4222-8222-222222222222/unsuspend",
        expect.objectContaining({
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer admin-access-token",
          },
          body: JSON.stringify({
            reason: "Tiket verifikasi ID #8843 telah disetujui",
          }),
        }),
      );
    });
  });
});
