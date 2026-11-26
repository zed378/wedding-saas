import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InvitationsPage } from "./InvitationsPage.js";
const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@wi/api-client", () => ({
  ApiClient: class {
    get = get;
  },
  accessTokenStore: {},
}));
const row = {
  id: "inv-1",
  slug: "budi-ratna",
  status: "published",
  owner_name: "Budi",
  owner_email: "budi@example.test",
  template_name: "Klasik",
  version: "1.0.0",
  expiry_date: "2027-01-01",
};
afterEach(cleanup);
beforeEach(() => {
  get.mockReset();
  get.mockResolvedValue({ data: [row], meta: { total: 21 } });
});
describe("P5-10 invitation overview", () => {
  it("searches by slug and owner with bounded pagination", async () => {
    render(<InvitationsPage />);
    expect(await screen.findByText("budi-ratna")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Slug undangan"), {
      target: { value: "budi" },
    });
    fireEvent.change(screen.getByLabelText("Nama atau email pemilik"), {
      target: { value: "budi@example.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cari undangan" }));
    await waitFor(() =>
      expect(get).toHaveBeenLastCalledWith(
        "/api/v1/admin/invitations",
        expect.objectContaining({
          query: {
            search_slug: "budi",
            search_user: "budi@example.test",
            page: 1,
            limit: 20,
          },
        }),
      ),
    );
    await screen.findByText("budi-ratna");
    fireEvent.click(screen.getByRole("button", { name: "Berikutnya" }));
    await waitFor(() =>
      expect(get).toHaveBeenLastCalledWith(
        "/api/v1/admin/invitations",
        expect.objectContaining({
          query: expect.objectContaining({ page: 2 }),
        }),
      ),
    );
  });
  it("shows operational histories and exposes no edit action", async () => {
    get.mockImplementation(async (path: string) =>
      path.endsWith("inv-1")
        ? {
            data: {
              ...row,
              owner: { email: row.owner_email, full_name: "Budi" },
              template_version: { name: "Klasik", version: "1.0.0" },
              published_at: null,
              validation_summary: {
                ready: false,
                missing_required_fields: 2,
                incomplete_sections: ["couple", "events"],
              },
              order_history: [
                {
                  id: "order-1",
                  status: "paid",
                  amount_total: "139000",
                  created_at: "2026-01-01",
                },
              ],
              status_history: [
                {
                  from_status: "draft",
                  to_status: "paid",
                  changed_at: "2026-01-01",
                },
              ],
            },
          }
        : { data: [row], meta: { total: 1 } },
    );
    render(<InvitationsPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Lihat detail budi-ratna" }),
    );
    expect(await screen.findByText("Riwayat pesanan")).toBeInTheDocument();
    expect(screen.getByText(/order-1/)).toBeInTheDocument();
    expect(screen.getByText(/draft → paid/)).toBeInTheDocument();
    expect(
      screen.getByText("2 bidang wajib belum lengkap."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Bagian belum lengkap: couple, events/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /edit|ubah|hapus/i }),
    ).not.toBeInTheDocument();
  });
  it("shows a recoverable error without substitute customer data", async () => {
    get.mockRejectedValue(new Error("offline"));
    render(<InvitationsPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("gagal dimuat");
    expect(screen.queryByText("budi-ratna")).not.toBeInTheDocument();
    get.mockResolvedValue({ data: [], meta: { total: 0 } });
    fireEvent.click(screen.getByRole("button", { name: "Coba lagi" }));
    expect(
      await screen.findByText("Tidak ada undangan yang sesuai."),
    ).toBeInTheDocument();
  });
  it("retries a failed detail request without losing the selected invitation", async () => {
    let detailRequests = 0;
    get.mockImplementation(async (path: string) => {
      if (!path.endsWith("inv-1")) return { data: [row], meta: { total: 1 } };
      detailRequests += 1;
      if (detailRequests === 1) throw new Error("offline");
      return {
        data: {
          ...row,
          owner: { email: row.owner_email, full_name: "Budi" },
          template_version: { name: "Klasik", version: "1.0.0" },
          published_at: null,
          validation_summary: {
            ready: true,
            missing_required_fields: 0,
            incomplete_sections: [],
          },
          order_history: [],
          status_history: [],
        },
      };
    });
    render(<InvitationsPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Lihat detail budi-ratna" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Detail undangan gagal dimuat.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Coba lagi" }));
    expect(await screen.findByText("Detail operasional")).toBeInTheDocument();
    expect(detailRequests).toBe(2);
  });
});
