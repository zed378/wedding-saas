import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { accessTokenStore } from "@wi/api-client";
import { ModerationPage } from "./ModerationPage.js";

const entry = {
  id: "22222222-2222-4222-8222-222222222221",
  invitationId: "11111111-1111-4111-8111-111111111111",
  invitationSlug: "budi-ratna",
  invitationTitle: "Undangan Budi",
  invitationStatus: "published",
  owner: { id: "owner", email: "owner@example.test", fullName: "Budi" },
  guestName: "Tamu Uji",
  message: "Selamat menempuh hidup baru.",
  status: "pending",
  createdAt: "2026-11-25T00:00:00Z",
  reportCount: 1,
  reports: [
    {
      id: "report",
      reason: "Tinjau pesan ini",
      createdAt: "2026-11-25T00:00:00Z",
    },
  ],
  flagSource: "reported",
  flagLabel: "Dilaporkan Tamu (1x)",
};
const response = (data: unknown, status = 200) =>
  new Response(
    JSON.stringify(
      status < 400
        ? { success: true, data }
        : {
            success: false,
            error: { code: "FORBIDDEN", message: "Akses ditolak" },
          },
    ),
    { status, headers: { "Content-Type": "application/json" } },
  );
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  accessTokenStore.set("admin-access");
  fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
    response(init?.method === "GET" ? [entry] : { id: entry.id }),
  );
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  accessTokenStore.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("P5-14 authenticated moderation", () => {
  it("loads queue from the actual API client with admin authentication", async () => {
    render(<ModerationPage />);
    expect(await screen.findByText("Tamu Uji")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        "/api/v1/admin/moderation/guestbook?status=pending",
      ),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer admin-access",
        }),
      }),
    );
    expect(screen.queryByText("Spammer Promosi")).not.toBeInTheDocument();
  });
  it("sends source and search filters to the server", async () => {
    render(<ModerationPage />);
    await screen.findByText("Tamu Uji");
    fireEvent.change(screen.getByLabelText(/Sumber Indikasi/), {
      target: { value: "reported" },
    });
    fireEvent.change(screen.getByLabelText(/Cari Pesan atau Pengirim/), {
      target: { value: "budi" },
    });
    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        expect.stringContaining(
          "search=budi&status=pending&flag_source=reported",
        ),
        expect.anything(),
      ),
    );
  });
  it("shows reports from the fetched entry", async () => {
    render(<ModerationPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Lihat 1 Laporan Tamu/ }),
    );
    expect(await screen.findByText("Tinjau pesan ini")).toBeInTheDocument();
  });
  it.each(["approve", "delete"])(
    "requires a reason and sends authenticated %s",
    async (action) => {
      render(<ModerationPage />);
      fireEvent.click(
        await screen.findByRole("button", {
          name:
            action === "approve"
              ? /Setujui pesan dari Tamu Uji/
              : /Hapus pesan dari Tamu Uji/,
        }),
      );
      const confirm = screen.getByRole("button", {
        name: action === "approve" ? "Konfirmasi Setujui" : "Konfirmasi Hapus",
      });
      expect(confirm).toBeDisabled();
      fireEvent.change(screen.getByLabelText(/Alasan Moderasi/), {
        target: { value: "Pemeriksaan konten selesai" },
      });
      fireEvent.click(confirm);
      await waitFor(() =>
        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining(
            `/api/v1/admin/moderation/guestbook/${entry.id}`,
          ),
          expect.objectContaining({
            method: action === "approve" ? "PATCH" : "DELETE",
            headers: expect.objectContaining({
              Authorization: "Bearer admin-access",
            }),
            body: JSON.stringify(
              action === "approve"
                ? { status: "approved", reason: "Pemeriksaan konten selesai" }
                : { reason: "Pemeriksaan konten selesai" },
            ),
          }),
        ),
      );
    },
  );
  it("shows a retryable failure without inventing queue entries", async () => {
    fetchMock.mockResolvedValueOnce(response(null, 403));
    render(<ModerationPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Antrean moderasi gagal dimuat",
    );
    expect(screen.queryByText("Tamu Uji")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Coba lagi" }));
    expect(await screen.findByText("Tamu Uji")).toBeInTheDocument();
  });
});
