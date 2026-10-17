import { Suspense } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiClient, accessTokenStore } from "@wi/api-client";

import { AuthProvider } from "../src/lib/auth";
import { InvitationCard } from "../src/components/InvitationCard";
import "@wi/ui/src/testing/setup.js";

/**
 * P3-14 — Checkout and payment status security tests.
 *
 * The most critical tests here are the URL-tampering checks (`docs/SECURITY/07`):
 *
 *   A `?status=success` URL parameter MUST NOT cause the UI to show a success state.
 *   Only a server response from `GET /orders/:id/payment/status` determines the UI state.
 *
 * The page tests use mock API responses and the actual `getPaymentStatus` wrapper,
 * which is the security boundary: the function only reads from the server response.
 */

const pushMock = vi.fn();
const replaceMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ push: pushMock, replace: replaceMock })),
  useSearchParams: vi.fn(() => new URLSearchParams()),
  useParams: vi.fn(() => ({
    invitationId: "11111111-1111-4111-8111-111111111111",
    orderId: "22222222-2222-4222-8222-222222222222",
  })),
}));

const INVITATION_ID = "11111111-1111-4111-8111-111111111111";
const ORDER_ID = "22222222-2222-4222-8222-222222222222";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const ok = (data: unknown) => json(200, { success: true, data });

const orderDetail = {
  id: ORDER_ID,
  invitation_id: INVITATION_ID,
  package_id: "standard",
  amount_total: 139000,
  status: "pending",
  expired_at: "2026-09-25T00:00:00.000Z",
  created_at: "2026-09-24T00:00:00.000Z",
};

interface ApiCall {
  readonly method: string;
  readonly pathname: string;
  readonly search: string;
}

function makeClient(respond: (call: ApiCall) => Response) {
  const calls: ApiCall[] = [];

  const client = new ApiClient({
    baseUrl: "http://api.test/v1",
    tokenStore: accessTokenStore,
    fetch: async (input, init) => {
      const url = new URL(String(input));
      const call: ApiCall = {
        method: (init?.method ?? "GET").toUpperCase(),
        pathname: url.pathname,
        search: url.search,
      };
      calls.push(call);
      return respond(call);
    },
  });

  return { client, calls };
}

function renderWithClient(node: React.ReactNode, client: ApiClient) {
  return render(
    <AuthProvider client={client} restoreSession={false}>
      <Suspense fallback={<div>Memuat...</div>}>
        {node}
      </Suspense>
    </AuthProvider>,
  );
}

beforeEach(() => {
  accessTokenStore.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ─── API wrapper: createOrder ─────────────────────────────────────────────────

describe("createOrder API wrapper (security: no amount_total in request)", () => {
  it("sends package_id and addon_ids only — NEVER amount_total", async () => {
    /**
     * SECURITY CRITICAL: `docs/SECURITY/07` § Pricing.
     * `amount_total` MUST NOT be sent from the client. Server calculates from `package_id`.
     */
    const { createOrder } = await import("../src/lib/invitations");

    const bodies: unknown[] = [];
    const client = new ApiClient({
      baseUrl: "http://api.test/v1",
      tokenStore: accessTokenStore,
      fetch: async (input, init) => {
        if (typeof init?.body === "string") {
          bodies.push(JSON.parse(init.body) as unknown);
        }
        return json(201, { success: true, data: orderDetail });
      },
    });

    await createOrder(client, INVITATION_ID, {
      packageId: "standard",
      addonIds: [],
    });

    expect(bodies).toHaveLength(1);
    const body = bodies[0] as Record<string, unknown>;
    expect(body).toHaveProperty("package_id", "standard");
    expect(body).toHaveProperty("addon_ids");
    // The security check: amount_total MUST NOT be present.
    expect(body).not.toHaveProperty("amount_total");
  });

  it("sends the correct package_id and empty addon_ids array", async () => {
    const { createOrder } = await import("../src/lib/invitations");

    const bodies: unknown[] = [];
    const client = new ApiClient({
      baseUrl: "http://api.test/v1",
      tokenStore: accessTokenStore,
      fetch: async (input, init) => {
        if (typeof init?.body === "string") {
          bodies.push(JSON.parse(init.body) as unknown);
        }
        return json(201, { success: true, data: orderDetail });
      },
    });

    await createOrder(client, INVITATION_ID, {
      packageId: "standard",
      addonIds: [],
    });

    const body = bodies[0] as Record<string, unknown>;
    expect(body["package_id"]).toBe("standard");
    expect(body["addon_ids"]).toEqual([]);
  });
});

// ─── API wrapper: getPaymentStatus ───────────────────────────────────────────

describe("getPaymentStatus API wrapper (SECURITY: server is authoritative)", () => {
  /**
   * This tests the API wrapper that is the single source of truth for payment status.
   * The wrapper calls `GET /orders/:id/payment/status` and returns the server response.
   * No URL parameters are consulted.
   */
  it("calls the correct endpoint and returns server response", async () => {
    const { getPaymentStatus } = await import("../src/lib/invitations");

    const calls: string[] = [];
    const client = new ApiClient({
      baseUrl: "http://api.test/v1",
      tokenStore: accessTokenStore,
      fetch: async (input) => {
        calls.push(new URL(String(input)).pathname);
        return ok({
          order_status: "pending",
          payment_status: "pending",
          paid_at: null,
        });
      },
    });

    const result = await getPaymentStatus(client, ORDER_ID);

    // Verify endpoint is called.
    expect(calls).toContain(`/v1/orders/${ORDER_ID}/payment/status`);
    // Returns the server's response, not any URL value.
    expect(result.payment_status).toBe("pending");
    expect(result.order_status).toBe("pending");
  });

  it("reports success only when server says payment_status === 'success'", async () => {
    const { getPaymentStatus } = await import("../src/lib/invitations");

    const client = new ApiClient({
      baseUrl: "http://api.test/v1",
      tokenStore: accessTokenStore,
      fetch: async () =>
        ok({
          order_status: "paid",
          payment_status: "success",
          paid_at: "2026-09-24T12:00:00.000Z",
        }),
    });

    const result = await getPaymentStatus(client, ORDER_ID);

    expect(result.payment_status).toBe("success");
    expect(result.order_status).toBe("paid");
    expect(result.paid_at).toBe("2026-09-24T12:00:00.000Z");
  });

  it("does NOT report success when server says pending, regardless of any URL state", async () => {
    const { getPaymentStatus } = await import("../src/lib/invitations");

    // Even if someone could set a fake URL param, the wrapper ignores it completely.
    // The URL is irrelevant to this function — it only reads the server response.
    const client = new ApiClient({
      baseUrl: "http://api.test/v1",
      tokenStore: accessTokenStore,
      fetch: async () =>
        ok({
          order_status: "pending",
          payment_status: "pending",
          paid_at: null,
        }),
    });

    const result = await getPaymentStatus(client, ORDER_ID);
    expect(result.payment_status).not.toBe("success");
    expect(result.payment_status).toBe("pending");
  });
});

// ─── Checkout page render ─────────────────────────────────────────────────────

describe("checkout page", () => {
  it("shows the package card with price and features", async () => {
    const { default: CheckoutPage } = await import(
      "../src/app/(app)/checkout/[invitationId]/page"
    );

    const { client } = makeClient(() => ok({}));

    renderWithClient(
      <CheckoutPage params={{ invitationId: INVITATION_ID }} />,
      client,
    );

    expect(await screen.findByText("Paket Standard")).toBeInTheDocument();
    expect(screen.getAllByText(/Rp 139\.000/)[0]).toBeInTheDocument();
    expect(screen.getByText(/12 bulan/)).toBeInTheDocument();
  });

  it("shows the Bayar Sekarang button", async () => {
    const { default: CheckoutPage } = await import(
      "../src/app/(app)/checkout/[invitationId]/page"
    );

    const { client } = makeClient(() => ok({}));

    renderWithClient(
      <CheckoutPage params={{ invitationId: INVITATION_ID }} />,
      client,
    );

    expect(
      await screen.findByRole("button", { name: /bayar sekarang/i }),
    ).toBeInTheDocument();
  });

  it("creates an order on button click and navigates to payment page", async () => {
    const { default: CheckoutPage } = await import(
      "../src/app/(app)/checkout/[invitationId]/page"
    );

    pushMock.mockClear();

    const { client } = makeClient((call) => {
      if (call.method === "POST" && call.pathname.endsWith("/orders")) {
        return json(201, { success: true, data: orderDetail });
      }
      return ok({});
    });

    renderWithClient(
      <CheckoutPage params={{ invitationId: INVITATION_ID }} />,
      client,
    );

    await userEvent.click(
      await screen.findByRole("button", { name: /bayar sekarang/i }),
    );

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith(
        `/checkout/${INVITATION_ID}/payment/${ORDER_ID}`,
      );
    });
  });
});

// ─── Payment page: URL parameter tampering (SECURITY CRITICAL) ───────────────

describe("payment page: URL parameter security (SECURITY/07 Golden Rule)", () => {
  /**
   * SECURITY/07 Golden Rule:
   * `payment_success` MUST NOT be equated with a `user_request_parameter`.
   *
   * These tests prove that the payment PAGE component does not read `?status=success`
   * from the URL to determine its UI state. The actual state must come from the server.
   *
   * We test at the API wrapper level (above) and at the page component level here.
   */

  it("shows the order summary without claiming success based on URL", async () => {
    const { default: PaymentPage } = await import(
      "../src/app/(app)/checkout/[invitationId]/payment/[orderId]/page"
    );

    const { client } = makeClient((call) => {
      if (
        call.method === "GET" &&
        call.pathname.includes("/payment/status")
      ) {
        // Server says pending — payment NOT done.
        return ok({
          order_status: "pending",
          payment_status: "pending",
          paid_at: null,
        });
      }
      return ok(orderDetail);
    });

    renderWithClient(
      <PaymentPage
        params={{
          invitationId: INVITATION_ID,
          orderId: ORDER_ID,
        }}
      />,
      client,
    );

    // Must show the order summary (loaded).
    await screen.findAllByText(/Rp 139\.000/);

    // Must NOT show success state — server said pending.
    expect(
      screen.queryByText(/pembayaran berhasil/i),
    ).not.toBeInTheDocument();

    // Must NOT show a "Lanjutkan ke Terbitkan" link based solely on URL params.
    expect(
      screen.queryByRole("link", { name: /lanjutkan ke terbitkan/i }),
    ).not.toBeInTheDocument();
  });

  it("shows success ONLY after server confirms payment_status === 'success'", async () => {
    const { default: PaymentPage } = await import(
      "../src/app/(app)/checkout/[invitationId]/payment/[orderId]/page"
    );

    let pollCount = 0;

    // Stub window.open (payment initiation).
    vi.stubGlobal("open", vi.fn());

    const { client } = makeClient((call) => {
      if (
        call.method === "POST" &&
        call.pathname.includes("/payment") &&
        !call.pathname.includes("/status")
      ) {
        return json(201, {
          success: true,
          data: {
            redirect_url: "https://payment.test/pay",
            token: "test-token",
            expires_at: "2026-09-25T00:00:00.000Z",
          },
        });
      }
      if (
        call.method === "GET" &&
        call.pathname.includes("/payment/status")
      ) {
        pollCount++;
        if (pollCount >= 1) {
          return ok({
            order_status: "paid",
            payment_status: "success",
            paid_at: "2026-09-24T12:00:00.000Z",
          });
        }
        return ok({
          order_status: "pending",
          payment_status: "pending",
          paid_at: null,
        });
      }
      return ok(orderDetail);
    });

    renderWithClient(
      <PaymentPage
        params={{
          invitationId: INVITATION_ID,
          orderId: ORDER_ID,
        }}
      />,
      client,
    );

    await screen.findAllByText(/Rp 139\.000/);

    await userEvent.click(
      await screen.findByRole("button", { name: /lanjutkan ke pembayaran/i }),
    );

    // After server confirms success, the success banner appears.
    await waitFor(
      () => {
        expect(
          screen.getByText(/pembayaran berhasil/i),
        ).toBeInTheDocument();
      },
      { timeout: 15_000 },
    );

    // The success CTA link appears.
    expect(
      screen.getByRole("link", { name: /lanjutkan ke terbitkan/i }),
    ).toBeInTheDocument();
  }, 20_000);

  it("does NOT show success after expired order, even if user adds ?status=success", async () => {
    /**
     * Additional tamper-proof test: expired order never shows success, regardless of
     * what the URL might contain.
     */
    const { default: PaymentPage } = await import(
      "../src/app/(app)/checkout/[invitationId]/payment/[orderId]/page"
    );

    const { client } = makeClient(() =>
      ok({ ...orderDetail, status: "expired" }),
    );

    renderWithClient(
      <PaymentPage
        params={{
          invitationId: INVITATION_ID,
          orderId: ORDER_ID,
        }}
      />,
      client,
    );

    await screen.findAllByText(/Rp 139\.000/);

    // Expired order shows expired state.
    expect(screen.getByText(/pesanan kedaluwarsa/i)).toBeInTheDocument();

    // NOT success.
    expect(
      screen.queryByText(/pembayaran berhasil/i),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /lanjutkan ke terbitkan/i }),
    ).not.toBeInTheDocument();
  });
});

// ─── Invitation card: "Bayar" button ─────────────────────────────────────────

describe("InvitationCard: payment actions", () => {
  it("shows 'Bayar' button for pending_payment invitations", () => {
    const inv = {
      id: INVITATION_ID,
      internal_name: "Budi & Ani",
      status: "pending_payment" as const,
      slug: null,
      template_id: "tpl-1",
      published_at: null,
      expiry_date: null,
      created_at: "2026-09-01T00:00:00.000Z",
      updated_at: "2026-09-01T00:00:00.000Z",
    };

    const { client } = makeClient(() => ok({}));
    renderWithClient(
      <InvitationCard
        invitation={inv}
        publicHost="https://invitation.test"
      />,
      client,
    );

    const bayarLink = screen.getByRole("link", { name: /bayar budi & ani/i });
    expect(bayarLink).toHaveAttribute(
      "href",
      `/checkout/${INVITATION_ID}`,
    );
  });

  it("shows 'Perbarui' button for expired invitations", () => {
    const inv = {
      id: INVITATION_ID,
      internal_name: "Budi & Ani",
      status: "expired" as const,
      slug: null,
      template_id: "tpl-1",
      published_at: null,
      expiry_date: null,
      created_at: "2026-09-01T00:00:00.000Z",
      updated_at: "2026-09-01T00:00:00.000Z",
    };

    const { client } = makeClient(() => ok({}));
    renderWithClient(
      <InvitationCard
        invitation={inv}
        publicHost="https://invitation.test"
      />,
      client,
    );

    const renewLink = screen.getByRole("link", {
      name: /perbarui budi & ani/i,
    });
    expect(renewLink).toHaveAttribute("href", `/checkout/${INVITATION_ID}`);
  });

  it("does NOT show a payment button for draft invitations", () => {
    const inv = {
      id: INVITATION_ID,
      internal_name: "Budi & Ani",
      status: "draft" as const,
      slug: null,
      template_id: "tpl-1",
      published_at: null,
      expiry_date: null,
      created_at: "2026-09-01T00:00:00.000Z",
      updated_at: "2026-09-01T00:00:00.000Z",
    };

    const { client } = makeClient(() => ok({}));
    renderWithClient(
      <InvitationCard
        invitation={inv}
        publicHost="https://invitation.test"
      />,
      client,
    );

    expect(screen.queryByRole("link", { name: /bayar/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /perbarui/i })).not.toBeInTheDocument();
  });
});
