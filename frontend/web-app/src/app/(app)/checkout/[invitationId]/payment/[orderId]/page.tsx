"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button, Spinner } from "@wi/ui";
import { ApiError } from "@wi/api-client";

import { useAuth } from "../../../../../../lib/auth";
import {
  getOrder,
  getPaymentStatus,
  initiatePayment,
  type OrderDetail,
  type PaymentStatus,
} from "../../../../../../lib/invitations";
import { PaymentStatusBanner } from "../../../../../../components/PaymentStatusBanner";
import { isInAppBrowser, getBrowserName } from "../../../../../../lib/in-app-browser";

/**
 * P3-14 — `/checkout/[invitationId]/payment/[orderId]`.
 * `docs/UI-UX/13` § Confirmation & Payment Page, § Awaiting Payment Page.
 *
 * ## Security: NEVER reads `?status=success` to determine payment state
 *
 * `docs/SECURITY/07` Golden Rule: payment_success MUST NOT be equated with a
 * user_request_parameter. The `?returning=true` query parameter is ONLY used to
 * change the initial UI wording ("Memeriksa status pembayaran…" instead of the
 * initiation button). The actual payment state always comes from the server via
 * `GET /orders/:id/payment/status`.
 *
 * ## Polling
 *
 * After a payment window is opened, the page polls every 3 seconds. After 60 seconds
 * (20 polls), polling stops and shows a "still processing" fallback message. The server
 * does a provider query on each poll request (`P3-06`).
 *
 * Protected by the `(app)` group layout.
 */

const POLL_INTERVAL_MS = 3_000;
const POLL_MAX_COUNT = 20; // 60 seconds total

type InitPhase =
  | { readonly kind: "idle" }
  | { readonly kind: "initiating" }
  | { readonly kind: "opened" }
  | { readonly kind: "error"; readonly message: string };

type PollState =
  | { readonly kind: "idle" }
  | { readonly kind: "polling"; readonly count: number }
  | { readonly kind: "resolved"; readonly paymentStatus: "success" | "failed" }
  | { readonly kind: "expired" }
  | { readonly kind: "timeout" };

export default function PaymentPage({
  params,
}: {
  readonly params:
    | Promise<{ invitationId: string; orderId: string }>
    | { invitationId: string; orderId: string };
}) {
  const { invitationId, orderId } = "then" in params ? use(params) : params;
  const searchParams = useSearchParams();
  const { api } = useAuth();

  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [initPhase, setInitPhase] = useState<InitPhase>({ kind: "idle" });
  const [pollState, setPollState] = useState<PollState>({ kind: "idle" });

  /**
   * `?returning=true` is informational only — used to skip the "Lanjutkan ke Pembayaran"
   * button and start polling immediately (the user just came back from the provider).
   *
   * NEVER reads `?status=` or any status claim from the URL.
   */
  const returning = searchParams.get("returning") === "true";

  const inApp = isInAppBrowser();
  const browserName = getBrowserName();

  // Track poll count via ref to avoid stale closure in the interval.
  const pollCountRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load order detail on mount.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const detail = await getOrder(api, orderId);
        if (!cancelled) {
          setOrder(detail);
          // If order is already expired, go straight to expired state.
          if (detail.status === "expired") {
            setPollState({ kind: "expired" });
          }
        }
      } catch {
        if (!cancelled) {
          setOrderError("Pesanan tidak ditemukan atau sudah tidak berlaku.");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [api, orderId]);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current !== null) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (abortRef.current !== null) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    pollCountRef.current = 0;
    setPollState({ kind: "polling", count: 0 });

    pollTimerRef.current = setInterval(() => {
      pollCountRef.current += 1;
      const count = pollCountRef.current;

      if (count > POLL_MAX_COUNT) {
        stopPolling();
        setPollState({ kind: "timeout" });
        return;
      }

      abortRef.current = new AbortController();
      const signal = abortRef.current.signal;

      void (async () => {
        try {
          const status: PaymentStatus = await getPaymentStatus(api, orderId, signal);

          // Expired order.
          if (status.order_status === "expired") {
            stopPolling();
            setPollState({ kind: "expired" });
            return;
          }

          // Successful payment — from server, never URL.
          if (status.payment_status === "success") {
            stopPolling();
            setPollState({ kind: "resolved", paymentStatus: "success" });
            return;
          }

          // Failed payment.
          if (status.payment_status === "failed") {
            stopPolling();
            setPollState({ kind: "resolved", paymentStatus: "failed" });
            return;
          }

          // Still pending — update count for render.
          setPollState({ kind: "polling", count });
        } catch (error) {
          if (
            error instanceof ApiError ||
            (error instanceof Error && error.name !== "AbortError")
          ) {
            // Transient poll error — don't stop, just continue.
          }
        }
      })();
    }, POLL_INTERVAL_MS);
  }, [api, orderId, stopPolling]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  // If `?returning=true`, start polling immediately once order is loaded.
  useEffect(() => {
    if (returning && order !== null && pollState.kind === "idle") {
      startPolling();
    }
  }, [returning, order, pollState.kind, startPolling]);

  async function handleInitiate() {
    if (order === null) return;

    setInitPhase({ kind: "initiating" });

    try {
      const payment = await initiatePayment(api, orderId);

      // Detect in-app browser before opening.
      if (inApp) {
        // Don't open in in-app browser — just show the copy link.
        setInitPhase({ kind: "opened" });
        startPolling();
        return;
      }

      window.open(payment.redirect_url, "_blank");
      setInitPhase({ kind: "opened" });
      startPolling();
    } catch (error) {
      if (error instanceof ApiError) {
        setInitPhase({
          kind: "error",
          message:
            error.code === "ORDER_EXPIRED"
              ? "Pesanan sudah kedaluwarsa. Silakan buat pesanan baru."
              : "Gagal memulai pembayaran. Silakan coba lagi.",
        });
      } else {
        setInitPhase({
          kind: "error",
          message: "Tidak dapat terhubung. Periksa koneksi internet Anda.",
        });
      }
    }
  }

  if (orderError !== null) {
    return (
      <main id="main" className="mx-auto w-full max-w-md px-4 py-10">
        <p role="alert" className="text-sm text-danger-700">
          {orderError}
        </p>
        <a
          href={`/checkout/${invitationId}`}
          className="focus-ring mt-4 inline-block text-sm text-primary-600 underline"
        >
          Mulai ulang checkout
        </a>
      </main>
    );
  }

  if (order === null) {
    return (
      <main id="main" className="mx-auto w-full max-w-md px-4 py-10">
        <p role="status" aria-live="polite" className="text-sm text-text-muted">
          Memuat…
        </p>
      </main>
    );
  }

  const isPolling = pollState.kind === "polling";
  const isSuccess =
    pollState.kind === "resolved" && pollState.paymentStatus === "success";
  const isFailed =
    pollState.kind === "resolved" && pollState.paymentStatus === "failed";
  const isExpired =
    pollState.kind === "expired" || order.status === "expired";
  const isTimeout = pollState.kind === "timeout";

  return (
    <main id="main" className="mx-auto w-full max-w-md px-4 py-10">
      <h1 className="mb-6 text-2xl font-semibold text-text">Pembayaran</h1>

      {/* In-app browser warning */}
      {inApp && initPhase.kind === "idle" && (
        <div className="mb-4 rounded-lg border border-warning-500 bg-warning-50 p-3">
          <p className="text-sm font-medium text-warning-800">
            Buka di browser eksternal
          </p>
          <p className="mt-1 text-sm text-warning-700">
            Pembayaran tidak dapat diselesaikan di dalam{" "}
            {browserName ?? "aplikasi ini"}. Salin tautan dan buka di Chrome
            atau Safari.
          </p>
        </div>
      )}

      {/* Order summary */}
      <div className="mb-6 rounded-lg border border-border bg-surface-raised p-4">
        <h2 className="mb-3 text-sm font-semibold text-text-muted uppercase tracking-wide">
          Ringkasan pesanan
        </h2>
        <div className="flex justify-between text-sm">
          <span className="text-text">Paket Standard</span>
          <span className="font-medium text-text">
            Rp {order.amount_total.toLocaleString("id-ID")}
          </span>
        </div>
        <div className="mt-3 flex justify-between border-t border-border pt-3 text-sm">
          <span className="font-semibold text-text">Total</span>
          <span className="font-semibold text-text">
            Rp {order.amount_total.toLocaleString("id-ID")}
          </span>
        </div>
      </div>

      {/* Status banner */}
      {isPolling && <PaymentStatusBanner status="checking" />}
      {isSuccess && <PaymentStatusBanner status="success" />}
      {isFailed && (
        <PaymentStatusBanner
          status="failed"
          onRetry={() => {
            window.location.href = `/checkout/${invitationId}`;
          }}
        />
      )}
      {isExpired && <PaymentStatusBanner status="expired" />}

      {/* 60-second timeout fallback — stop polling, show advisory message */}
      {isTimeout && (
        <div
          role="status"
          className="rounded-lg border border-warning-500 bg-warning-50 px-4 py-3"
        >
          <p className="text-sm font-medium text-warning-800">
            Pembayaran masih diproses
          </p>
          <p className="mt-1 text-sm text-warning-700">
            Kami akan mengirim email konfirmasi jika pembayaran berhasil. Tidak
            perlu mengulang pembayaran.
          </p>
        </div>
      )}

      {/* Action area */}
      {!isPolling && !isSuccess && !isExpired && !isTimeout && (
        <div className="mt-6">
          {initPhase.kind === "idle" && (
            <>
              {inApp ? (
                <p className="text-sm text-text-muted">
                  Salin tautan halaman ini dan buka di browser eksternal untuk
                  melanjutkan.
                </p>
              ) : (
                <Button
                  className="w-full"
                  onClick={() => {
                    void handleInitiate();
                  }}
                >
                  Lanjutkan ke Pembayaran
                </Button>
              )}
            </>
          )}

          {initPhase.kind === "initiating" && (
            <div className="flex items-center justify-center gap-2 py-4">
              <Spinner className="size-5" />
              <span className="text-sm text-text-muted">
                Menghubungkan ke sistem pembayaran…
              </span>
            </div>
          )}

          {initPhase.kind === "opened" && !isPolling && (
            <div className="rounded-lg border border-border bg-surface-sunken p-4 text-center">
              <p className="text-sm text-text-muted">
                Halaman pembayaran dibuka di tab baru.
              </p>
              <p className="mt-1 text-sm text-text-muted">
                Setelah selesai, kembali ke sini — halaman akan otomatis
                memeriksa status pembayaran Anda.
              </p>
            </div>
          )}

          {initPhase.kind === "error" && (
            <>
              <p role="alert" className="mb-4 text-sm text-danger-700">
                {initPhase.message}
              </p>
              <Button
                variant="secondary"
                className="w-full"
                onClick={() => {
                  setInitPhase({ kind: "idle" });
                }}
              >
                Coba Lagi
              </Button>
            </>
          )}
        </div>
      )}

      {/* Success CTA */}
      {isSuccess && (
        <div className="mt-6">
          <a
            href={`/editor/${invitationId}`}
            className="focus-ring inline-flex w-full items-center justify-center rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-text-inverse hover:bg-primary-700"
          >
            Lanjutkan ke Terbitkan →
          </a>
        </div>
      )}

      {/* Expired CTA */}
      {isExpired && (
        <div className="mt-6">
          <a
            href={`/checkout/${invitationId}`}
            className="focus-ring inline-flex w-full items-center justify-center rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-text-inverse hover:bg-primary-700"
          >
            Buat pesanan baru
          </a>
        </div>
      )}

      {/* Failed CTA */}
      {isFailed && (
        <div className="mt-4">
          <a
            href={`/checkout/${invitationId}`}
            className="focus-ring inline-flex w-full items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-medium text-text hover:bg-surface-sunken"
          >
            Coba lagi dari awal
          </a>
        </div>
      )}

      <div className="mt-8">
        <a
          href="/dashboard"
          className="focus-ring text-sm text-text-muted underline"
        >
          ← Kembali ke dasbor
        </a>
      </div>
    </main>
  );
}
