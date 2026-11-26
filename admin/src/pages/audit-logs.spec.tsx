import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { AuditLogsPage } from "./AuditLogsPage.js";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@wi/api-client", () => ({
  ApiClient: class {
    get = get;
  },
}));

const item = {
  id: "audit-1",
  admin_id: "actor-1",
  admin_email: "operator@example.test",
  action: "user.suspend",
  resource_type: "user",
  resource_id: "resource-1",
  reason: "Verified abuse report",
  created_at: "2026-01-01T12:00:00Z",
  before_state: { status: "active", unchanged: "same", removed: "old" },
  after_state: {
    status: "suspended",
    unchanged: "same",
    added: "<script>alert(1)</script>",
  },
};
const page = { items: [item], total: 21, page: 1, total_pages: 2 };

describe("P5-12 audit viewer", () => {
  beforeEach(() => {
    get.mockReset();
    get.mockResolvedValue({ data: page });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("loads real API data and displays append-only and minimum retention policy", async () => {
    render(<AuditLogsPage />);
    expect(
      await screen.findByText("operator@example.test"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/tidak dapat diubah atau dihapus/),
    ).toHaveTextContent("Retensi minimum 2 tahun");
    expect(get).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/admin/audit-logs?"),
    );
    expect(
      screen.queryByRole("button", { name: /hapus|ubah catatan/i }),
    ).not.toBeInTheDocument();
  });

  it("sends actor, type, resource ID and date filters and keeps them during pagination", async () => {
    render(<AuditLogsPage />);
    await screen.findByText("operator@example.test");
    fireEvent.change(screen.getByLabelText("ID pelaku"), {
      target: { value: "22222222-2222-4222-8222-222222222222" },
    });
    fireEvent.change(screen.getByLabelText("Jenis sumber daya"), {
      target: { value: "user" },
    });
    fireEvent.change(screen.getByLabelText("ID sumber daya"), {
      target: { value: "33333333-3333-4333-8333-333333333333" },
    });
    fireEvent.change(screen.getByLabelText("Dari tanggal"), {
      target: { value: "2026-01-01T00:00" },
    });
    fireEvent.change(screen.getByLabelText("Sampai tanggal"), {
      target: { value: "2026-01-03T00:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Terapkan filter" }));
    await waitFor(() =>
      expect(get).toHaveBeenLastCalledWith(
        expect.stringContaining("resource_id=33333333"),
      ),
    );
    const url = new URL(
      get.mock.calls.at(-1)![0],
      "https://admin.example.test",
    );
    expect(url.searchParams.get("admin_id")).toBe(
      "22222222-2222-4222-8222-222222222222",
    );
    expect(url.searchParams.get("resource_type")).toBe("user");
    expect(url.searchParams.get("date_from")).toBe(
      new Date("2026-01-01T00:00").toISOString(),
    );
    expect(url.searchParams.get("date_to")).toBe(
      new Date("2026-01-03T00:00").toISOString(),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Berikutnya" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Berikutnya" }));
    await waitFor(() =>
      expect(get).toHaveBeenLastCalledWith(expect.stringContaining("page=2")),
    );
    expect(get.mock.calls.at(-1)![0]).toContain("resource_type=user");
  });

  it("shows changed, added and removed fields while escaping stored HTML", async () => {
    render(<AuditLogsPage />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: /Lihat perubahan user.suspend/,
      }),
    );
    const table = screen.getAllByRole("table")[1]!;
    expect(within(table).getByText("status")).toBeInTheDocument();
    expect(within(table).getByText('"active"')).toBeInTheDocument();
    expect(within(table).getByText('"suspended"')).toBeInTheDocument();
    expect(within(table).getByText("added")).toBeInTheDocument();
    expect(within(table).getByText("removed")).toBeInTheDocument();
    expect(within(table).queryByText("unchanged")).not.toBeInTheDocument();
    expect(
      within(table).getByText('"<script>alert(1)</script>"'),
    ).toBeInTheDocument();
    expect(document.querySelector("script")).toBeNull();
  });

  it("exports through the audited endpoint and downloads JSON", async () => {
    const create = vi.fn(() => "blob:audit-export");
    const revoke = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: create,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revoke,
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    get.mockImplementation((path: string) =>
      Promise.resolve({
        data: path.includes("/export")
          ? { export_id: "export-1", items: [item], total: 1 }
          : page,
      }),
    );
    render(<AuditLogsPage />);
    await screen.findByText("operator@example.test");
    fireEvent.click(screen.getByRole("button", { name: "Ekspor JSON" }));
    expect(await screen.findByText(/1 catatan diekspor/)).toBeInTheDocument();
    expect(get).toHaveBeenLastCalledWith("/api/v1/admin/audit-logs/export?");
    expect(create).toHaveBeenCalledWith(expect.any(Blob));
    expect(click).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith("blob:audit-export");
  });

  it("handles loading, empty and failed requests without showing sample data", async () => {
    get.mockRejectedValueOnce(new Error("unavailable"));
    render(<AuditLogsPage />);
    expect(screen.getByText("Memuat log audit…")).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Log audit gagal dimuat",
    );
    get.mockResolvedValueOnce({ data: { ...page, items: [], total: 0 } });
    fireEvent.click(screen.getByRole("button", { name: "Coba lagi" }));
    expect(
      await screen.findByText("Tidak ada log yang cocok dengan filter."),
    ).toBeInTheDocument();
    expect(screen.queryByText("operator@example.test")).not.toBeInTheDocument();
  });
});
