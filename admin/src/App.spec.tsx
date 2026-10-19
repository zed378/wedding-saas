import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { accessTokenStore } from "@wi/api-client";
import { AdminAuthProvider, type AdminUser } from "./auth/admin-auth.js";
import { RouterProvider } from "./router.js";
import { AppRoutes } from "./App.js";

describe("Admin Shell Application & Routing (P5-01)", () => {
  beforeEach(() => {
    window.history.pushState(null, "", "/");
    accessTokenStore.clear();
  });

  afterEach(() => {
    accessTokenStore.clear();
  });

  it("renders login form when unauthenticated visitor arrives", () => {
    render(
      <AdminAuthProvider initialUser={null}>
        <RouterProvider>
          <AppRoutes />
        </RouterProvider>
      </AdminAuthProvider>,
    );

    expect(screen.getByRole("heading", { name: /Masuk Administrator/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/Email Administrator/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Kata Sandi/i)).toBeInTheDocument();
  });

  it("renders explicit UnauthorizedPage (403) when authenticated non-admin user arrives", () => {
    const regularUser: AdminUser = {
      id: "u-regular",
      email: "tamu@example.com",
      role: "user",
      name: "Tamu Biasa",
    };

    render(
      <AdminAuthProvider initialUser={regularUser} initialSessionExpiresAt={Date.now() + 100000}>
        <RouterProvider>
          <AppRoutes />
        </RouterProvider>
      </AdminAuthProvider>,
    );

    expect(screen.getByRole("heading", { name: /Akses Ditolak \(403\)/i })).toBeInTheDocument();
    expect(screen.getByText(/tamu@example\.com/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Kembali ke Aplikasi Utama/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Keluar \(Logout\)/i })).toBeInTheDocument();
  });

  it("renders desktop admin shell with all 6 navigation modules for admin user", () => {
    const adminUser: AdminUser = {
      id: "u-admin",
      email: "staff@vizunicum.my.id",
      role: "admin",
      name: "Staff Admin",
    };

    render(
      <AdminAuthProvider initialUser={adminUser} initialSessionExpiresAt={Date.now() + 14400000}>
        <RouterProvider>
          <AppRoutes />
        </RouterProvider>
      </AdminAuthProvider>,
    );

    // Desktop sidebar navigation items
    const nav = screen.getByRole("navigation", { name: /Navigasi Admin/i });
    expect(nav).toBeInTheDocument();

    expect(screen.getByRole("link", { name: /Dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Pengguna/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Templat/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Pesanan/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Moderasi/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Log Audit/i })).toBeInTheDocument();

    // Default route renders Dashboard
    expect(screen.getByRole("heading", { name: /Ringkasan Sistem/i })).toBeInTheDocument();

    // Session lifespan indicator
    expect(screen.getByText(/Batas Sesi \(Maks 4 Jam\)/i)).toBeInTheDocument();

    // Skip link for accessibility
    expect(screen.getByRole("link", { name: /Lewati ke konten utama/i })).toBeInTheDocument();
  });

  it("navigates across admin modules via router links", () => {
    const adminUser: AdminUser = {
      id: "u-admin",
      email: "staff@vizunicum.my.id",
      role: "admin",
      name: "Staff Admin",
    };

    render(
      <AdminAuthProvider initialUser={adminUser} initialSessionExpiresAt={Date.now() + 14400000}>
        <RouterProvider>
          <AppRoutes />
        </RouterProvider>
      </AdminAuthProvider>,
    );

    // Navigate to Users
    fireEvent.click(screen.getByRole("link", { name: /Pengguna/i }));
    expect(screen.getByRole("heading", { name: /Manajemen Pengguna/i })).toBeInTheDocument();

    // Navigate to Templates
    fireEvent.click(screen.getByRole("link", { name: /Templat/i }));
    expect(screen.getByRole("heading", { name: /Katalog Templat/i })).toBeInTheDocument();

    // Navigate to Orders
    fireEvent.click(screen.getByRole("link", { name: /Pesanan/i }));
    expect(screen.getByRole("heading", { name: /Pesanan & Pembayaran/i })).toBeInTheDocument();

    // Navigate to Moderation
    fireEvent.click(screen.getByRole("link", { name: /Moderasi/i }));
    expect(screen.getByRole("heading", { name: /Antrean Moderasi/i })).toBeInTheDocument();

    // Navigate to Audit Logs
    fireEvent.click(screen.getByRole("link", { name: /Log Audit/i }));
    expect(screen.getByRole("heading", { name: /Log Audit Sistem/i })).toBeInTheDocument();
  });
});
