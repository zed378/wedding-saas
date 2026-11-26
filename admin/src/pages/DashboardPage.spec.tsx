import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { accessTokenStore } from "@wi/api-client";
import { DashboardPage } from "./DashboardPage";
import { conversion, rupiah } from "./dashboard-model";

const summary = {
  generated_at: "2026-11-25T12:00:00Z",
  timezone: "UTC",
  revenue_basis: "paid_orders_amount_total_by_created_at_excluding_refunds",
  total_users: 2,
  total_invitations: 4,
  paid_orders: 1,
  total_revenue: "139000",
  daily_revenue: "139000",
  monthly_revenue: "139000",
  invitations_by_status: [
    { status: "draft", count: 3 },
    { status: "published", count: 1 },
  ],
  orders_by_day: [
    { date: "2026-11-24", count: 2, revenue: "278000" },
    { date: "2026-11-25", count: 1, revenue: "139000" },
  ],
  revenue_by_month: [{ month: "2026-11", revenue: "139000" }],
  funnel: { created: 4, ever_paid: 2, paid_and_published: 1 },
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  accessTokenStore.clear();
});
describe("operational dashboard (P5-11)", () => {
  it("renders live aggregates, labelled revenue, funnel and accessible chart data", async () => {
    accessTokenStore.set("admin-access-token");
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: summary }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetch);
    render(<DashboardPage />);
    expect(await screen.findByText("Total Pengguna")).toBeInTheDocument();
    expect(screen.getByText(/Funnel Draft/)).toBeInTheDocument();
    expect(screen.getByText(/50.0% dari dibuat/)).toBeInTheDocument();
    expect(screen.getByText(/Refunded tidak dihitung/)).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Pesanan 30 Hari Terakhir" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Pendapatan 30 Hari Terakhir" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("2026-11-25")).toHaveLength(2);
    const dailyRevenueDetails = screen
      .getByText("Lihat data pendapatan 30 hari terakhir")
      .closest("details")!;
    fireEvent.click(
      within(dailyRevenueDetails).getByText(
        "Lihat data pendapatan 30 hari terakhir",
      ),
    );
    expect(
      within(dailyRevenueDetails).getByRole("columnheader", {
        name: "Pendapatan",
      }),
    ).toBeInTheDocument();
    expect(
      within(dailyRevenueDetails).getByText(/278\.000/),
    ).toBeInTheDocument();
    expect(fetch.mock.calls[0]![0]).toBe(
      "http://localhost:3000/api/v1/admin/dashboard/summary",
    );
    expect(fetch.mock.calls[0]![1].headers["Authorization"]).toBe(
      "Bearer admin-access-token",
    );
  });
  it("shows a retryable failure without fabricated placeholder metrics", async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError("offline"));
    vi.stubGlobal("fetch", fetch);
    render(<DashboardPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Ringkasan gagal dimuat",
    );
    expect(screen.queryByText("Total Pengguna")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Muat ulang" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  });
  it("formats bigint money exactly and handles empty conversion", () => {
    expect(rupiah("9007199254740993")).toContain("9.007.199.254.740.993");
    expect(conversion(0, 0)).toBe("0%");
    expect(conversion(1, 4)).toBe("25.0%");
  });
});
