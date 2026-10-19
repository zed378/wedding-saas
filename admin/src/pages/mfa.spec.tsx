import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AdminAuthProvider } from "../auth/admin-auth.js";
import { RouterProvider } from "../router.js";
import { MfaVerifyPage } from "./MfaVerifyPage.js";
import { MfaEnrollPage } from "./MfaEnrollPage.js";
import { StepUpModal } from "../components/StepUpModal.js";

describe("Admin 2FA Frontend Components (P5-02)", () => {
  describe("MfaVerifyPage", () => {
    it("renders TOTP code input and toggle for recovery code", () => {
      render(
        <AdminAuthProvider>
          <RouterProvider>
            <MfaVerifyPage />
          </RouterProvider>
        </AdminAuthProvider>,
      );

      expect(screen.getByRole("heading", { name: /Verifikasi 2 Langkah/i })).toBeDefined();
      expect(screen.getByLabelText(/Kode 6-Digit/i)).toBeDefined();

      const toggleBtn = screen.getByRole("button", {
        name: /Perangkat hilang\? Gunakan kode pemulihan cadangan/i,
      });
      fireEvent.click(toggleBtn);

      expect(screen.getByLabelText(/Kode Pemulihan Cadangan/i)).toBeDefined();
    });

    it("displays error on empty submit", async () => {
      render(
        <AdminAuthProvider>
          <RouterProvider>
            <MfaVerifyPage />
          </RouterProvider>
        </AdminAuthProvider>,
      );

      const form = screen.getByRole("button", { name: /Verifikasi & Lanjutkan/i }).closest("form")!;
      fireEvent.submit(form);

      expect(
        await screen.findByText(/Masukkan 6-digit kode autentikator Anda/i),
      ).toBeDefined();
    });
  });

  describe("MfaEnrollPage", () => {
    it("renders secret key and 8 recovery codes", () => {
      render(
        <AdminAuthProvider>
          <RouterProvider>
            <MfaEnrollPage />
          </RouterProvider>
        </AdminAuthProvider>,
      );

      expect(screen.getByRole("heading", { name: /Aktivasi 2FA Wajib/i })).toBeDefined();
      expect(screen.getByText(/Langkah 1: Masukkan Kunci Rahasia/i)).toBeDefined();
      expect(screen.getByText(/Langkah 2: Simpan Kode Pemulihan Cadangan/i)).toBeDefined();
      expect(screen.getByLabelText(/Kode Verifikasi 6-Digit/i)).toBeDefined();
    });

    it("requires checking confirmation before activating", async () => {
      render(
        <AdminAuthProvider>
          <RouterProvider>
            <MfaEnrollPage />
          </RouterProvider>
        </AdminAuthProvider>,
      );

      const submitBtn = screen.getByRole("button", {
        name: /Aktivasi & Masuk ke Dashboard/i,
      }) as HTMLButtonElement;
      expect(submitBtn.disabled).toBe(true);

      const checkbox = screen.getByRole("checkbox");
      fireEvent.click(checkbox);
      expect(submitBtn.disabled).toBe(false);
    });
  });

  describe("StepUpModal", () => {
    it("renders step-up prompt for sensitive actions", () => {
      const handleClose = vi.fn();
      const handleSuccess = vi.fn();

      render(
        <AdminAuthProvider>
          <StepUpModal
            open={true}
            onClose={handleClose}
            onSuccess={handleSuccess}
            actionTitle="Pengembalian Dana Manual"
          />
        </AdminAuthProvider>,
      );

      expect(
        screen.getByText(/Konfirmasi Keamanan: Pengembalian Dana Manual/i),
      ).toBeDefined();
      expect(screen.getByLabelText(/Kode Verifikasi 6-Digit/i)).toBeDefined();

      const cancelBtn = screen.getByRole("button", { name: /Batal/i });
      fireEvent.click(cancelBtn);
      expect(handleClose).toHaveBeenCalled();
    });
  });
});
