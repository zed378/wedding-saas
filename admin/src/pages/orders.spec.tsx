import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { OrdersPage } from "./OrdersPage.js";

describe("Admin Order and Payment Management UI (P5-07)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders orders list with initial mock orders", () => {
    render(<OrdersPage />);
    expect(screen.getByText("Pesanan & Pembayaran")).toBeDefined();
    expect(screen.getByText("Budi Santoso")).toBeDefined();
    expect(screen.getByText("Siti Nurhaliza")).toBeDefined();
    expect(screen.getByText("Andi Pratama")).toBeDefined();
  });

  it("filters orders by search query (user email, name, or slug)", async () => {
    render(<OrdersPage />);
    const searchInput = screen.getByLabelText(/Cari Pesanan/i);

    fireEvent.change(searchInput, { target: { value: "siti" } });

    await waitFor(() => {
      expect(screen.getByText("Siti Nurhaliza")).toBeDefined();
      expect(screen.queryByText("Budi Santoso")).toBeNull();
      expect(screen.queryByText("Andi Pratama")).toBeNull();
    });
  });

  it("filters orders by payment status", async () => {
    render(<OrdersPage />);
    const statusSelect = screen.getByLabelText(/Status Pembayaran/i);

    fireEvent.change(statusSelect, { target: { value: "failed" } });

    await waitFor(() => {
      expect(screen.getByText("Andi Pratama")).toBeDefined();
      expect(screen.queryByText("Budi Santoso")).toBeNull();
      expect(screen.queryByText("Siti Nurhaliza")).toBeNull();
    });
  });

  it("opens order detail modal showing customer, payment attempts, and timeline", async () => {
    render(<OrdersPage />);

    // Click "Detail" on Budi's order
    const detailBtn = screen.getByRole("button", {
      name: /Lihat detail pesanan 33333333-3333-4333-8333-333333333331/i,
    });
    fireEvent.click(detailBtn);

    await waitFor(() => {
      expect(screen.getByText("Detail Transaksi Pesanan & Pembayaran")).toBeDefined();
      expect(screen.getByText("Upaya Pembayaran (Gateway Attempts)")).toBeDefined();
      expect(screen.getByText("Linimasa Notifikasi Webhook & Query")).toBeDefined();
      expect(screen.getByText("Faktur Pembayaran (Invoice)")).toBeDefined();
      expect(screen.getByText("INV-20260110-33333333")).toBeDefined();
    });
  });

  it("surfaces prominent fraud alert banner when signature mismatch is present in timeline", async () => {
    render(<OrdersPage />);

    const detailBtn = screen.getByRole("button", {
      name: /Lihat detail pesanan 33333333-3333-4333-8333-333333333331/i,
    });
    fireEvent.click(detailBtn);

    await waitFor(() => {
      const banner = screen.getByTestId("fraud-alert-banner");
      expect(banner).toBeDefined();
      expect(
        screen.getByText(/Peringatan Keamanan: Percobaan Manipulasi Callback Terdeteksi/i),
      ).toBeDefined();
      expect(
        screen.getByText(/Terdeteksi ketidakcocokan tanda tangan \(Signature Mismatch\)/i),
      ).toBeDefined();
    });
  });

  describe("Manual Refund UI Flow (P5-08)", () => {
    it("opens refund modal displaying ADR-019 entitlement revocation and manual money movement warnings", async () => {
      render(<OrdersPage />);

      // Paid order (Budi Santoso) has a Refund button
      const refundBtn = screen.getByRole("button", {
        name: /Refund pesanan 33333333-3333-4333-8333-333333333331/i,
      });
      fireEvent.click(refundBtn);

      await waitFor(() => {
        expect(screen.getByText("Proses Refund Pesanan (Manual)")).toBeDefined();
        expect(screen.getByText(/Perhatian \(ADR-019 & Kebijakan Entitlement\):/i)).toBeDefined();
        expect(screen.getByText(/Peringatan Aliran Dana \(Manual\):/i)).toBeDefined();
      });
    });

    it("keeps confirmation button disabled until reason is at least 5 characters", async () => {
      render(<OrdersPage />);

      const refundBtn = screen.getByRole("button", {
        name: /Refund pesanan 33333333-3333-4333-8333-333333333331/i,
      });
      fireEvent.click(refundBtn);

      await waitFor(() => {
        expect(screen.getByText("Proses Refund Pesanan (Manual)")).toBeDefined();
      });

      const confirmBtn = screen.getByRole("button", { name: "Konfirmasi Refund" }) as HTMLButtonElement;
      expect(confirmBtn.disabled).toBe(true);

      const reasonInput = screen.getByLabelText(/Alasan Refund/i);
      fireEvent.change(reasonInput, { target: { value: "test" } });
      expect(confirmBtn.disabled).toBe(true);

      fireEvent.change(reasonInput, { target: { value: "Permintaan resmi pembatalan" } });
      expect(confirmBtn.disabled).toBe(false);
    });

    it("submits refund request with reason and TOTP code and displays success", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: "success",
          data: {
            orderId: "33333333-3333-4333-8333-333333333331",
            status: "refunded",
            invitationStatus: "draft",
            moneyMovement: "manual",
            message: "Pesanan berhasil direfund di sistem dan status undangan dikembalikan ke draft.",
          },
        }),
      });
      global.fetch = mockFetch as any;

      render(<OrdersPage />);

      const refundBtn = screen.getByRole("button", {
        name: /Refund pesanan 33333333-3333-4333-8333-333333333331/i,
      });
      fireEvent.click(refundBtn);

      const reasonInput = screen.getByLabelText(/Alasan Refund/i);
      const codeInput = screen.getByLabelText(/Kode 2FA \/ TOTP Authenticator/i);

      fireEvent.change(reasonInput, { target: { value: "Pembatalan acara pernikahan" } });
      fireEvent.change(codeInput, { target: { value: "123456" } });

      const confirmBtn = screen.getByRole("button", { name: "Konfirmasi Refund" });
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          "/api/v1/admin/orders/33333333-3333-4333-8333-333333333331/refund",
          expect.objectContaining({
            method: "POST",
            body: JSON.stringify({
              reason: "Pembatalan acara pernikahan",
              step_up_code: "123456",
            }),
          }),
        );
        expect(
          screen.getByText(/Pesanan berhasil direfund di sistem dan status undangan dikembalikan ke draft/i),
        ).toBeDefined();
      });
    });
  });
});
