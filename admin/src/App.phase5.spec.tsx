import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { accessTokenStore } from "@wi/api-client";
import { AdminAuthProvider } from "./auth/admin-auth.js";
import { RouterProvider } from "./router.js";
import { AppRoutes } from "./App.js";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@wi/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@wi/api-client")>()),
  ApiClient: class {
    get = get;
  },
}));

function mount(path: string, role = "admin") {
  window.history.replaceState(null, "", path);
  return render(
    <AdminAuthProvider
      initialUser={{ id: "actor", email: "operator@example.test", role }}
      initialSessionExpiresAt={Date.now() + 60_000}
    >
      <RouterProvider>
        <AppRoutes />
      </RouterProvider>
    </AdminAuthProvider>,
  );
}

describe("Phase 5 invitation and slug blocklist routes", () => {
  beforeEach(() => {
    accessTokenStore.clear();
    get.mockReset();
    get.mockResolvedValue({ data: [], meta: { total: 0 } });
  });
  afterEach(() => {
    cleanup();
    accessTokenStore.clear();
  });

  it("opens the invitation overview from its URL with the sidebar item active", async () => {
    mount("/invitations");
    expect(
      await screen.findByRole("heading", { name: "Ringkasan undangan" }),
    ).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Undangan" });
    expect(link).toHaveAttribute("href", "/invitations");
    expect(link).toHaveAttribute("aria-current", "page");
    expect(get).toHaveBeenCalledWith(
      "/api/v1/admin/invitations",
      expect.objectContaining({ query: expect.objectContaining({ page: 1 }) }),
    );
  });

  it("navigates between both real pages and updates active navigation", async () => {
    mount("/invitations");
    const blocklist = screen.getByRole("link", { name: "Blocklist Slug" });
    expect(blocklist).toHaveAttribute("href", "/slug-blocklist");
    fireEvent.click(blocklist);
    expect(
      await screen.findByRole("heading", { name: "Blocklist slug" }),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe("/slug-blocklist");
    expect(
      screen.getByRole("link", { name: "Blocklist Slug" }),
    ).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Undangan" })).not.toHaveAttribute(
      "aria-current",
    );
    expect(get).toHaveBeenCalledWith(
      "/api/v1/admin/slug-blocklist",
      expect.objectContaining({ query: { page: 1, per_page: 20 } }),
    );
    fireEvent.click(screen.getByRole("link", { name: "Undangan" }));
    expect(
      await screen.findByRole("heading", { name: "Ringkasan undangan" }),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe("/invitations");
  });

  it("opens the blocklist directly for super_admin", async () => {
    mount("/slug-blocklist", "super_admin");
    expect(
      await screen.findByRole("heading", { name: "Blocklist slug" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: /Calon slug/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Blocklist Slug" }),
    ).toHaveAttribute("aria-current", "page");
  });

  it.each(["/invitations", "/slug-blocklist"])(
    "denies non-admin access at %s before fetching data",
    (path) => {
      mount(path, "user");
      expect(
        screen.getByRole("heading", { name: /Akses Ditolak/ }),
      ).toBeInTheDocument();
      expect(get).not.toHaveBeenCalled();
      expect(
        screen.queryByRole("navigation", { name: "Navigasi Admin" }),
      ).not.toBeInTheDocument();
    },
  );
});
