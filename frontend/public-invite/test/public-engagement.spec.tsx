import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { PublicRsvpForm } from "../src/components/PublicRsvpForm";
import { PublicGuestbookWall } from "../src/components/PublicGuestbookWall";

describe("P4-11 — Public RSVP Form Component", () => {
  beforeEach(() => {
    // Set up window.location
    delete (window as unknown as { location?: unknown }).location;
    window.location = new URL("https://invitation.test/budi-ani") as unknown as Location;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders an inert presentational form when mode is not public", () => {
    render(
      <PublicRsvpForm
        mode="live"
        data={{}}
        theme={{}}
        layoutVariant={undefined}
        maxItems={undefined}
      />,
    );

    expect(screen.getByText("Formulir ini dinonaktifkan dalam mode pratinjau.")).toBeDefined();
    const input = screen.getByRole("textbox");
    expect(input.hasAttribute("disabled")).toBe(true);
  });

  it("successfully submits RSVP and replaces form with thank-you status in public mode", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        success: true,
        data: { id: "rsvp-123", status: "attending" },
      }),
    } as Response);

    render(
      <PublicRsvpForm
        mode="public"
        data={{}}
        theme={{}}
        layoutVariant={undefined}
        maxItems={undefined}
      />,
    );

    const nameInput = screen.getByLabelText(/Nama Lengkap/);
    fireEvent.change(nameInput, { target: { value: "Ratna Sari" } });

    const submitBtn = screen.getByRole("button", { name: "Kirim Konfirmasi" });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/public/i/budi-ani/rsvp",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            guest_name: "Ratna Sari",
            attendance_status: "attending",
            guest_count: 1,
          }),
        }),
      );
    });

    expect(await screen.findByText("Terima Kasih!")).toBeDefined();
    expect(screen.getByText(/Ratna Sari/)).toBeDefined();
  });

  it("preserves guest input and displays announced error on submission failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({
        success: false,
        error: { code: "RATE_LIMITED", message: "Terlalu banyak permintaan." },
      }),
    } as Response);

    render(
      <PublicRsvpForm
        mode="public"
        data={{}}
        theme={{}}
        layoutVariant={undefined}
        maxItems={undefined}
      />,
    );

    const nameInput = screen.getByLabelText(/Nama Lengkap/) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "Budi Purnomo" } });

    const submitBtn = screen.getByRole("button", { name: "Kirim Konfirmasi" });
    fireEvent.click(submitBtn);

    const errorAlert = await screen.findByRole("alert");
    expect(errorAlert.textContent).toContain("Terlalu banyak permintaan.");

    // Critical DoD requirement: input must NOT be reset on failure!
    expect(nameInput.value).toBe("Budi Purnomo");
  });
});

describe("P4-11 — Public Guestbook Wall Component", () => {
  beforeEach(() => {
    delete (window as unknown as { location?: unknown }).location;
    window.location = new URL("https://invitation.test/budi-ani") as unknown as Location;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders an inert presentational form when mode is not public", () => {
    render(
      <PublicGuestbookWall
        mode="live"
        data={{}}
        theme={{}}
        layoutVariant={undefined}
        maxItems={undefined}
      />,
    );

    expect(screen.getByText("Buku tamu dinonaktifkan dalam mode pratinjau.")).toBeDefined();
    const input = screen.getByRole("textbox");
    expect(input.hasAttribute("disabled")).toBe(true);
  });

  it("optimistically appends message when submitted entry is approved", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("GET") || u.includes("guestbook?")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: [] }),
        } as Response;
      }
      return {
        ok: true,
        status: 201,
        json: async () => ({
          success: true,
          data: {
            id: "gb-new",
            guest_name: "Dimas Anggara",
            message: "Selamat ya!",
            status: "approved",
          },
        }),
      } as Response;
    });

    render(
      <PublicGuestbookWall
        mode="public"
        data={{}}
        theme={{}}
        layoutVariant={undefined}
        maxItems={undefined}
      />,
    );

    const nameInput = screen.getByLabelText(/Nama Anda/);
    const msgInput = screen.getByLabelText(/Ucapan & Doa/);

    fireEvent.change(nameInput, { target: { value: "Dimas Anggara" } });
    fireEvent.change(msgInput, { target: { value: "Selamat ya!" } });

    const submitBtn = screen.getByRole("button", { name: "Kirim Ucapan" });
    fireEvent.click(submitBtn);

    expect(await screen.findByText("Ucapan Anda berhasil dikirim!")).toBeDefined();
    expect(screen.getByText(/Selamat ya!/)).toBeDefined();
  });

  it("shows awaiting approval notice when submitted entry is pending", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("GET") || u.includes("guestbook?")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: [] }),
        } as Response;
      }
      return {
        ok: true,
        status: 201,
        json: async () => ({
          success: true,
          data: {
            id: "gb-pending",
            guest_name: "Tamu Misterius",
            message: "Semoga langgeng",
            status: "pending",
          },
        }),
      } as Response;
    });

    render(
      <PublicGuestbookWall
        mode="public"
        data={{}}
        theme={{}}
        layoutVariant={undefined}
        maxItems={undefined}
      />,
    );

    const nameInput = screen.getByLabelText(/Nama Anda/);
    const msgInput = screen.getByLabelText(/Ucapan & Doa/);

    fireEvent.change(nameInput, { target: { value: "Tamu Misterius" } });
    fireEvent.change(msgInput, { target: { value: "Semoga langgeng" } });

    const submitBtn = screen.getByRole("button", { name: "Kirim Ucapan" });
    fireEvent.click(submitBtn);

    expect(
      await screen.findByText(/sedang menunggu persetujuan mempelai/),
    ).toBeDefined();
  });
});
