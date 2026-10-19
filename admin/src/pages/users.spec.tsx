import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { UsersPage } from "./UsersPage.js";

describe("Admin User Management UI (P5-06)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders user list with initial users", () => {
    render(<UsersPage />);
    expect(screen.getByText("Manajemen Pengguna")).toBeDefined();
    expect(screen.getByText("Budi Santoso")).toBeDefined();
    expect(screen.getByText("Siti Nurhaliza")).toBeDefined();
    expect(screen.getByText("Andi Pratama")).toBeDefined();
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
    const detailBtn = screen.getByRole("button", {
      name: /Lihat detail Budi Santoso/i,
    });
    fireEvent.click(detailBtn);

    await waitFor(() => {
      expect(screen.getByText("Detail Pengguna & Aktivitas")).toBeDefined();
      expect(screen.getByText("Daftar Undangan Pernikahan")).toBeDefined();
      expect(screen.getByText("Riwayat Transaksi Pesanan")).toBeDefined();
      expect(screen.getByText("Pernikahan Budi & Ratna (Resepsi)")).toBeDefined();
      expect(screen.getByText("Paket STANDARD")).toBeDefined();
    });
  });

  it("enforces minimum 5 characters reason for suspension and displays BR-Admin.6 note", async () => {
    render(<UsersPage />);

    // Click "Tangguhkan" on Budi Santoso
    const suspendBtn = screen.getByRole("button", {
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

  it("sends PATCH request with audit reason on user suspension", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      if (typeof url === "string" && url.includes("/suspend")) {
        return new Response(
          JSON.stringify({
            data: {
              id: "11111111-1111-4111-8111-111111111111",
              status: "suspended",
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });

    render(<UsersPage />);

    const suspendBtn = screen.getByRole("button", {
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

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/v1/admin/users/11111111-1111-4111-8111-111111111111/suspend",
        expect.objectContaining({
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reason: "Penyalahgunaan fasilitas broadcast tamu",
          }),
        }),
      );
    });
  });

  it("sends PATCH request with audit reason on user unsuspension", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      if (typeof url === "string" && url.includes("/unsuspend")) {
        return new Response(
          JSON.stringify({
            data: {
              id: "22222222-2222-4222-8222-222222222222",
              status: "active",
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });

    render(<UsersPage />);

    // Siti Nurhaliza is suspended in initial mock
    const unsuspendBtn = screen.getByRole("button", {
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
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reason: "Tiket verifikasi ID #8843 telah disetujui",
          }),
        }),
      );
    });
  });
});
