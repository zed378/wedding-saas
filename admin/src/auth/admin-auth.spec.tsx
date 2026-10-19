import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { accessTokenStore } from "@wi/api-client";
import {
  AdminAuthProvider,
  useAdminAuth,
  MAX_ADMIN_SESSION_MS,
  type AdminUser,
} from "./admin-auth.js";

describe("AdminAuthProvider and useAdminAuth", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    accessTokenStore.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    accessTokenStore.clear();
  });

  it("initializes with unauthenticated state when no initial user is provided", () => {
    const { result } = renderHook(() => useAdminAuth(), {
      wrapper: ({ children }) => <AdminAuthProvider>{children}</AdminAuthProvider>,
    });

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.isAdmin).toBe(false);
    expect(result.current.isUnauthorized).toBe(false);
    expect(result.current.user).toBeNull();
  });

  it("identifies admin role as authorized admin", () => {
    const adminUser: AdminUser = {
      id: "u-admin",
      email: "admin@vizunicum.my.id",
      role: "admin",
    };

    const { result } = renderHook(() => useAdminAuth(), {
      wrapper: ({ children }) => (
        <AdminAuthProvider initialUser={adminUser} initialSessionExpiresAt={Date.now() + 10000}>
          {children}
        </AdminAuthProvider>
      ),
    });

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.isAdmin).toBe(true);
    expect(result.current.isUnauthorized).toBe(false);
  });

  it("identifies super_admin role as authorized admin", () => {
    const superAdmin: AdminUser = {
      id: "u-super",
      email: "superadmin@vizunicum.my.id",
      role: "super_admin",
    };

    const { result } = renderHook(() => useAdminAuth(), {
      wrapper: ({ children }) => (
        <AdminAuthProvider initialUser={superAdmin} initialSessionExpiresAt={Date.now() + 10000}>
          {children}
        </AdminAuthProvider>
      ),
    });

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.isAdmin).toBe(true);
    expect(result.current.isUnauthorized).toBe(false);
  });

  it("identifies standard user role as isUnauthorized and not isAdmin (BR-Admin.1)", () => {
    const regularUser: AdminUser = {
      id: "u-regular",
      email: "user@example.com",
      role: "user",
    };

    const { result } = renderHook(() => useAdminAuth(), {
      wrapper: ({ children }) => (
        <AdminAuthProvider initialUser={regularUser} initialSessionExpiresAt={Date.now() + 10000}>
          {children}
        </AdminAuthProvider>
      ),
    });

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.isAdmin).toBe(false);
    expect(result.current.isUnauthorized).toBe(true);
  });

  it("enforces 4-hour max session lifetime on login (docs/SECURITY/03)", () => {
    const { result } = renderHook(() => useAdminAuth(), {
      wrapper: ({ children }) => <AdminAuthProvider>{children}</AdminAuthProvider>,
    });

    const now = Date.now();
    const adminUser: AdminUser = {
      id: "u-admin",
      email: "admin@vizunicum.my.id",
      role: "admin",
    };

    act(() => {
      result.current.login("test-token-123", adminUser);
    });

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.sessionExpiresAt).toBe(now + MAX_ADMIN_SESSION_MS);
    expect(accessTokenStore.get()).toBe("test-token-123");

    // Advance time past 4 hours
    act(() => {
      vi.advanceTimersByTime(MAX_ADMIN_SESSION_MS + 35000);
    });

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
    expect(accessTokenStore.get()).toBeUndefined();
  });

  it("clears in-memory token store upon logout", () => {
    const adminUser: AdminUser = {
      id: "u-admin",
      email: "admin@vizunicum.my.id",
      role: "admin",
    };

    const { result } = renderHook(() => useAdminAuth(), {
      wrapper: ({ children }) => <AdminAuthProvider>{children}</AdminAuthProvider>,
    });

    act(() => {
      result.current.login("active-token", adminUser);
    });

    expect(accessTokenStore.get()).toBe("active-token");

    act(() => {
      result.current.logout();
    });

    expect(result.current.isAuthenticated).toBe(false);
    expect(accessTokenStore.get()).toBeUndefined();
  });
});
