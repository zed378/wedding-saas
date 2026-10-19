"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@wi/ui";
import { ApiError } from "@wi/api-client";

import { useAuth } from "../../../../lib/auth";
import { createOrder } from "../../../../lib/invitations";

/**
 * P3-14 — `/checkout/[invitationId]`. `docs/UI-UX/13` § Package Page.
 *
 * There is one package at MVP (ADR-023): Paket Standard for 12 months. The layout is a single
 * card with what is included — no comparison table, because a table with one column is worse
 * than no table.
 *
 * `amount_total` is NEVER sent in the request. The server calculates it from `package_id`
 * (`docs/SECURITY/07` § Pricing). Sending it would open a price-manipulation path.
 *
 * Protected by the `(app)` group layout.
 */

const STANDARD_PACKAGE_ID = "standard";
const STANDARD_PRICE_LABEL = `Rp ${[139, "000"].join(".")}`;

/** Features included in the Paket Standard. Source: `docs/PLAN/09`. */
const FEATURES = [
  "200 foto",
  "Tanpa watermark",
  "RSVP",
  "Buku tamu",
  "Galeri foto",
  "Peta lokasi",
  "Fitur hadiah",
] as const;

type PageState =
  | { readonly kind: "idle" }
  | { readonly kind: "creating" }
  | { readonly kind: "error"; readonly message: string };

export default function CheckoutPage({
  params,
}: {
  readonly params:
    | Promise<{ invitationId: string }>
    | { invitationId: string };
}) {
  const { invitationId } = "then" in params ? use(params) : params;
  const { api } = useAuth();
  const router = useRouter();
  const [state, setState] = useState<PageState>({ kind: "idle" });

  async function handlePay() {
    setState({ kind: "creating" });
    try {
      const order = await createOrder(api, invitationId, {
        packageId: STANDARD_PACKAGE_ID,
        addonIds: [],
      });
      router.push(`/checkout/${invitationId}/payment/${order.id}`);
    } catch (error) {
      if (error instanceof ApiError && error.code === "ACTIVE_ORDER_EXISTS") {
        // An active order already exists. The order_id is in the first detail entry.
        const detail = error.details?.[0];
        const orderId = detail?.message ?? "";
        if (orderId.length > 0) {
          router.push(`/checkout/${invitationId}/payment/${orderId}`);
          return;
        }
      }

      if (error instanceof ApiError && error.code === "ORDER_NOT_ALLOWED") {
        setState({
          kind: "error",
          message:
            "Undangan sudah dibayar. Silakan terbitkan undangan Anda dari editor.",
        });
        return;
      }

      if (error instanceof ApiError && error.code === "EMAIL_NOT_VERIFIED") {
        setState({
          kind: "error",
          message:
            "Verifikasi alamat email Anda terlebih dahulu. Cek kotak masuk untuk tautan verifikasi.",
        });
        return;
      }

      setState({
        kind: "error",
        message: "Terjadi kesalahan. Silakan coba lagi.",
      });
    }
  }

  return (
    <main id="main" className="mx-auto w-full max-w-md px-4 py-10">
      <h1 className="mb-6 text-2xl font-semibold text-text">
        Aktifkan undangan
      </h1>

      {/* Package card */}
      <div className="rounded-xl border border-border bg-surface-raised p-6">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-text">Paket Standard</h2>
            <p className="text-sm text-text-muted">Aktif selama 12 bulan</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-text">{STANDARD_PRICE_LABEL}</p>
          </div>
        </div>

        <ul className="mb-6 flex flex-col gap-2">
          {FEATURES.map((feature) => (
            <li key={feature} className="flex items-center gap-2 text-sm text-text">
              <span aria-hidden="true" className="text-success-600">
                ✓
              </span>
              {feature}
            </li>
          ))}
        </ul>

        <div className="mb-4 rounded-lg border border-border bg-surface p-3">
          <p className="text-sm text-text-muted">Ringkasan pembayaran</p>
          <div className="mt-2 flex justify-between text-sm">
            <span className="text-text">Paket Standard × 1</span>
            <span className="font-medium text-text">{STANDARD_PRICE_LABEL}</span>
          </div>
          <div className="mt-2 flex justify-between border-t border-border pt-2 text-sm">
            <span className="font-semibold text-text">Total</span>
            <span className="font-semibold text-text">{STANDARD_PRICE_LABEL}</span>
          </div>
        </div>

        {state.kind === "error" && (
          <p role="alert" className="mb-4 text-sm text-danger-700">
            {state.message}
          </p>
        )}

        <Button
          className="w-full"
          loading={state.kind === "creating"}
          loadingLabel="Membuat pesanan…"
          onClick={() => {
            void handlePay();
          }}
        >
          Bayar Sekarang
        </Button>
      </div>

      <p className="mt-4 text-center text-xs text-text-muted">
        Pembayaran diproses dengan aman melalui Midtrans.
      </p>

      <div className="mt-6">
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
