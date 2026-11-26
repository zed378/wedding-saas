import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { accessTokenStore } from "@wi/api-client";
import { StepUpModal } from "./StepUpModal.js";

afterEach(() => {
  cleanup();
  accessTokenStore.clear();
  vi.unstubAllGlobals();
});

function submit(onSuccess: (token: string) => void) {
  render(<StepUpModal open onClose={vi.fn()} onSuccess={onSuccess} />);
  fireEvent.change(screen.getByLabelText(/Kode Verifikasi 6-Digit/), {
    target: { value: "123456" },
  });
  fireEvent.submit(
    screen.getByLabelText(/Kode Verifikasi 6-Digit/).closest("form")!,
  );
}

describe("Step-up verification fails closed", () => {
  it("does not fabricate a token or transmit a factor when the admin session is absent", async () => {
    accessTokenStore.clear();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const success = vi.fn();
    submit(success);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Sesi admin tidak tersedia",
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(success).not.toHaveBeenCalled();
  });
  it("does not authorize a sensitive action after failed verification", async () => {
    accessTokenStore.set("admin-token");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const success = vi.fn();
    submit(success);
    expect(await screen.findByRole("alert")).toHaveTextContent("offline");
    expect(success).not.toHaveBeenCalled();
  });
  it("passes only the token returned by authenticated verification", async () => {
    accessTokenStore.set("admin-token");
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ data: { step_up_token: "server-verified-token" } }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetch);
    const success = vi.fn();
    submit(success);
    await screen.findByRole("button", { name: "Konfirmasi & Lanjutkan" });
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/auth/mfa/step-up",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer admin-token",
        }),
        body: JSON.stringify({ code: "123456" }),
      }),
    );
    // Wait for the verified response rather than treating the request as success.
    await waitFor(() =>
      expect(success).toHaveBeenCalledWith("server-verified-token"),
    );
  });
});
