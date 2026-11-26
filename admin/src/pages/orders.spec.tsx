import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { accessTokenStore } from "@wi/api-client";
import { OrdersPage } from "./OrdersPage.js";

const order = {
  id: "33333333-3333-4333-8333-333333333331",
  invitationId: "22222222-2222-4222-8222-222222222221",
  userId: "11111111-1111-4111-8111-111111111111",
  packageId: "package-id",
  addonIds: [],
  amountTotal: "139000",
  status: "paid",
  orderType: "new_publish",
  userEmail: "budi@example.test",
  userFullName: "Budi Santoso",
  invitationSlug: "budi-ratna",
  createdAt: "2026-01-01T00:00:00Z",
  expiredAt: "2026-01-02T00:00:00Z",
  paymentCount: 1,
};
const detail = {
  ...order,
  updatedAt: order.createdAt,
  user: {
    id: order.userId,
    email: order.userEmail,
    fullName: order.userFullName,
    phone: null,
  },
  invitation: {
    id: order.invitationId,
    slug: order.invitationSlug,
    internalName: null,
  },
  payments: [
    {
      id: "payment-1",
      provider: "midtrans",
      providerReferenceId: "reference-1",
      method: "bank_transfer",
      amount: "139000",
      status: "paid",
      signatureValid: true,
      verifiedAt: order.createdAt,
      createdAt: order.createdAt,
    },
  ],
  notifications: [],
  hasFraudAlert: true,
  invoice: { number: "INV-TEST-1", generatedAt: order.createdAt },
};
const response = (data: unknown, status = 200) =>
  new Response(
    JSON.stringify({
      success: status < 400,
      data,
      error:
        status >= 400
          ? { code: "FORBIDDEN", message: "Akses ditolak" }
          : undefined,
    }),
    { status, headers: { "Content-Type": "application/json" } },
  );
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  accessTokenStore.set("admin-access-token");
  fetchMock = vi.fn(async (input: string) => {
    const url = new URL(input, "https://admin.test");
    if (url.pathname.endsWith("/mfa/step-up"))
      return response({ step_up_token: "verified-step-up" });
    if (url.pathname.endsWith("/refund"))
      return response({
        message: "Refund tercatat. Dana riil wajib dikembalikan manual.",
      });
    if (url.pathname === "/api/v1/admin/orders")
      return response(url.search ? [] : [order]);
    return response(detail);
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  accessTokenStore.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function openRefund() {
  render(<OrdersPage />);
  fireEvent.click(
    await screen.findByRole("button", { name: `Refund pesanan ${order.id}` }),
  );
  fireEvent.change(screen.getByLabelText(/Alasan Refund/), {
    target: { value: "Pembatalan acara pernikahan" },
  });
  fireEvent.change(screen.getByLabelText(/Kode 2FA/), {
    target: { value: "123456" },
  });
}

describe("P5-07 authenticated order management", () => {
  it("loads API data with bearer authentication", async () => {
    render(<OrdersPage />);
    expect(await screen.findByText("Budi Santoso")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/admin/orders?"),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer admin-access-token",
        }),
      }),
    );
  });
  it("sends search and status filters to the server", async () => {
    render(<OrdersPage />);
    await screen.findByText("Budi Santoso");
    fireEvent.change(screen.getByLabelText(/Cari Pesanan/), {
      target: { value: "siti" },
    });
    await screen.findByText("Tidak ada pesanan yang sesuai dengan filter.");
    fireEvent.change(screen.getByLabelText(/Status Pembayaran/), {
      target: { value: "failed" },
    });
    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        expect.stringContaining("search=siti&status=failed"),
        expect.anything(),
      ),
    );
  });
  it("shows payment attempts, reconciliation timeline and fraud evidence from API detail", async () => {
    render(<OrdersPage />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: `Lihat detail pesanan ${order.id}`,
      }),
    );
    expect(
      await screen.findByText("Upaya Pembayaran (Gateway Attempts)"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Linimasa Notifikasi Webhook & Query"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("fraud-alert-banner")).toBeInTheDocument();
    expect(screen.getByText("INV-TEST-1")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/api/v1/admin/orders/${order.id}`),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer admin-access-token",
        }),
      }),
    );
  });
  it("shows a retryable list failure without fabricated orders", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    render(<OrdersPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Daftar pesanan gagal dimuat",
    );
    expect(screen.queryByText("Budi Santoso")).not.toBeInTheDocument();
    fetchMock.mockImplementation(async () => response([]));
    fireEvent.click(screen.getByRole("button", { name: "Coba lagi" }));
    expect(
      await screen.findByText("Tidak ada pesanan yang sesuai dengan filter."),
    ).toBeInTheDocument();
  });
  it("shows detail failure without fabricating financial history", async () => {
    render(<OrdersPage />);
    const button = await screen.findByRole("button", {
      name: `Lihat detail pesanan ${order.id}`,
    });
    fetchMock.mockRejectedValue(new Error("offline"));
    fireEvent.click(button);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Detail pesanan gagal dimuat",
    );
    expect(screen.queryByText("INV-TEST-1")).not.toBeInTheDocument();
  });
});
describe("P5-08 verified manual refund", () => {
  it("requires an audit reason and six digit factor and retains the manual money notice", async () => {
    render(<OrdersPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: `Refund pesanan ${order.id}` }),
    );
    expect(screen.getByText(/Peringatan Aliran Dana/)).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Konfirmasi Refund" });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Alasan Refund/), {
      target: { value: "Pembatalan resmi" },
    });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Kode 2FA/), {
      target: { value: "123456" },
    });
    expect(button).toBeEnabled();
  });
  it("exchanges the factor for a token before refund with X-MFA-Step-Up and reason only", async () => {
    await openRefund();
    fireEvent.click(screen.getByRole("button", { name: "Konfirmasi Refund" }));
    expect(await screen.findByText(/Refund tercatat/)).toBeInTheDocument();
    const step = fetchMock.mock.calls.find((c) =>
      String(c[0]).endsWith("/mfa/step-up"),
    )!;
    const refund = fetchMock.mock.calls.find((c) =>
      String(c[0]).endsWith("/refund"),
    )!;
    expect(step[1]).toEqual(
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ code: "123456" }),
        headers: expect.objectContaining({
          Authorization: "Bearer admin-access-token",
        }),
      }),
    );
    expect(refund[1]).toEqual(
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ reason: "Pembatalan acara pernikahan" }),
        headers: expect.objectContaining({
          Authorization: "Bearer admin-access-token",
          "X-MFA-Step-Up": "verified-step-up",
        }),
      }),
    );
    expect(fetchMock.mock.calls.indexOf(step)).toBeLessThan(
      fetchMock.mock.calls.indexOf(refund),
    );
  });
  it("does not submit refund when factor verification fails", async () => {
    await openRefund();
    fetchMock.mockImplementation(async () => response(null, 403));
    fireEvent.click(screen.getByRole("button", { name: "Konfirmasi Refund" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Akses ditolak");
    expect(
      fetchMock.mock.calls.some((c) => String(c[0]).endsWith("/refund")),
    ).toBe(false);
  });
});
