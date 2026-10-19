import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ModerationPage } from "./ModerationPage.js";

describe("Admin Moderation Queue UI (P5-09)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders moderation queue with initial mock entries and indicators", () => {
    render(<ModerationPage />);

    expect(screen.getByText("Antrean Moderasi Platform")).toBeDefined();
    expect(screen.getByText("Spammer Promosi")).toBeDefined();
    expect(screen.getByText("Tamu Anonim")).toBeDefined();
    expect(screen.getByText("Dilaporkan Tamu (2x)")).toBeDefined();
    expect(screen.getByText("Filter Otomatis (Kata Kasar)")).toBeDefined();
  });

  it("filters queue by flag source (reported vs auto_flagged)", async () => {
    render(<ModerationPage />);

    const flagSelect = screen.getByLabelText(/Sumber Indikasi/i);
    fireEvent.change(flagSelect, { target: { value: "reported" } });

    await waitFor(() => {
      expect(screen.getByText("Spammer Promosi")).toBeDefined();
      expect(screen.queryByText("Tamu Anonim")).toBeNull();
    });

    fireEvent.change(flagSelect, { target: { value: "auto_flagged" } });

    await waitFor(() => {
      expect(screen.getByText("Tamu Anonim")).toBeDefined();
      expect(screen.queryByText("Spammer Promosi")).toBeNull();
    });
  });

  it("opens visitor reports modal displaying specific user report reasons", async () => {
    render(<ModerationPage />);

    const viewReportsBtn = screen.getByRole("button", {
      name: /Lihat 2 Laporan Tamu/i,
    });
    fireEvent.click(viewReportsBtn);

    await waitFor(() => {
      expect(
        screen.getByText("Laporan Pengunjung atas Pesan Buku Tamu"),
      ).toBeDefined();
      expect(screen.getByText("Tautan penipuan dan phising")).toBeDefined();
      expect(screen.getByText("Spam promosi berulang")).toBeDefined();
    });
  });

  it("submits moderation approve action and reflects status change", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "success",
        data: {
          id: "22222222-2222-4222-8222-222222222221",
          status: "approved",
          message: "Pesan buku tamu berhasil di-setujui.",
        },
      }),
    });
    global.fetch = mockFetch as any;

    render(<ModerationPage />);

    const approveBtn = screen.getByRole("button", {
      name: /Setujui pesan dari Spammer Promosi/i,
    });
    fireEvent.click(approveBtn);

    await waitFor(() => {
      expect(screen.getByText("Setujui Pesan Buku Tamu")).toBeDefined();
    });

    const reasonInput = screen.getByLabelText(/Alasan Moderasi/i);
    fireEvent.change(reasonInput, { target: { value: "Konten telah diverifikasi aman" } });

    const confirmBtn = screen.getByRole("button", { name: "Konfirmasi Setujui" });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/v1/admin/moderation/guestbook/22222222-2222-4222-8222-222222222221",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            status: "approved",
            reason: "Konten telah diverifikasi aman",
          }),
        }),
      );
    });
  });

  it("submits moderation delete action permanently", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "success",
        data: {
          id: "22222222-2222-4222-8222-222222222222",
          deleted: true,
        },
      }),
    });
    global.fetch = mockFetch as any;

    render(<ModerationPage />);

    const deleteBtn = screen.getByRole("button", {
      name: /Hapus pesan dari Tamu Anonim/i,
    });
    fireEvent.click(deleteBtn);

    await waitFor(() => {
      expect(screen.getByText("Hapus Permanen Pesan Buku Tamu")).toBeDefined();
      expect(
        screen.getByText(/Pesan ini akan dihapus permanen dari basis data/i),
      ).toBeDefined();
    });

    const confirmBtn = screen.getByRole("button", { name: "Konfirmasi Hapus" });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/v1/admin/moderation/guestbook/22222222-2222-4222-8222-222222222222",
        expect.objectContaining({
          method: "DELETE",
        }),
      );
    });
  });
});
