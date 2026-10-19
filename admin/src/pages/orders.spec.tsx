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
});
