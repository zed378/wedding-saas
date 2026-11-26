import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { accessTokenStore } from "@wi/api-client";
import { AdminAuthProvider, useAdminAuth } from "../auth/admin-auth";
import { RouterProvider } from "../router";
import { LoginPage } from "./LoginPage";
import { MfaVerifyPage } from "./MfaVerifyPage";
import { MfaEnrollPage } from "./MfaEnrollPage";
import { AppRoutes } from "../App";

beforeEach(() => {
  window.history.replaceState(null, "", "/login");
  accessTokenStore.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  accessTokenStore.clear();
});
function mount(page: React.ReactNode) {
  return render(
    <AdminAuthProvider>
      <RouterProvider>{page}</RouterProvider>
    </AdminAuthProvider>,
  );
}
function credentials() {
  fireEvent.change(screen.getByLabelText(/Email Administrator/), {
    target: { value: "admin@example.test" },
  });
  fireEvent.change(screen.getByLabelText(/Kata Sandi/), {
    target: { value: "wrong-password" },
  });
  fireEvent.submit(
    screen
      .getByRole("button", { name: /Masuk ke Panel Admin/ })
      .closest("form")!,
  );
}
describe("P5-14 administrative authentication fails closed", () => {
  it.each(["network", "credentials"])(
    "does not invent an MFA ticket after %s failure",
    async (failure) => {
      vi.stubGlobal(
        "fetch",
        failure === "network"
          ? vi.fn().mockRejectedValue(new Error("offline"))
          : vi
              .fn()
              .mockResolvedValue(
                new Response(
                  JSON.stringify({ error: { message: "Kredensial salah" } }),
                  { status: 401 },
                ),
              ),
      );
      mount(<LoginPage />);
      credentials();
      await screen.findByRole("alert");
      expect(window.location.pathname).toBe("/login");
      expect(window.location.search).toBe("");
      expect(accessTokenStore.get()).toBeUndefined();
    },
  );
  it("uses only the server-issued MFA challenge ticket", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: { requires_mfa: true, mfa_ticket: "signed-server-ticket" },
          }),
          { status: 200 },
        ),
      ),
    );
    mount(<LoginPage />);
    credentials();
    await waitFor(() => expect(window.location.pathname).toBe("/mfa/verify"));
    expect(new URLSearchParams(window.location.search).get("ticket")).toBe(
      "signed-server-ticket",
    );
    expect(accessTokenStore.get()).toBeUndefined();
  });
  it("renders the MFA route after password login while preserving its challenge query", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: { requires_mfa: true, mfa_ticket: "server-issued-challenge" },
          }),
          { status: 200 },
        ),
      ),
    );
    mount(<AppRoutes />);
    credentials();
    expect(
      await screen.findByRole("heading", { name: "Verifikasi 2 Langkah" }),
    ).toBeDefined();
    expect(new URLSearchParams(window.location.search).get("ticket")).toBe(
      "server-issued-challenge",
    );
    expect(accessTokenStore.get()).toBeUndefined();
  });
  it("cannot mint an administrative session when verification has no ticket", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    mount(<MfaVerifyPage />);
    fireEvent.change(screen.getByLabelText(/Kode 6-Digit/), {
      target: { value: "123456" },
    });
    fireEvent.submit(
      screen
        .getByRole("button", { name: /Verifikasi & Lanjutkan/ })
        .closest("form")!,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Masuk kembali");
    expect(fetch).not.toHaveBeenCalled();
    expect(accessTokenStore.get()).toBeUndefined();
  });
  it("does not show fabricated secrets or enable enrollment when setup fails", async () => {
    window.history.replaceState(null, "", "/mfa/enroll?ticket=expired-ticket");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ error: { message: "Tiket kedaluwarsa" } }),
            { status: 401 },
          ),
        ),
    );
    mount(<MfaEnrollPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Tiket kedaluwarsa",
    );
    expect(screen.queryByText("JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP")).toBeNull();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(
      screen.getByRole("button", { name: /Aktivasi & Masuk/ }),
    ).toBeDisabled();
    expect(accessTokenStore.get()).toBeUndefined();
  });
  it("reads the real auth/me nested user envelope on the same origin", async () => {
    const user = { id: "admin-id", email: "admin@example.test", role: "admin" };
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { user } }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetch);
    accessTokenStore.set("verified-access");
    function Status() {
      const auth = useAdminAuth();
      return <span>{auth.user?.email ?? "pending"}</span>;
    }
    mount(<Status />);
    expect(await screen.findByText(user.email)).toBeDefined();
    expect(String(fetch.mock.calls[0]![0])).toContain(window.location.origin);
  });
});
