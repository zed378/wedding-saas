/**
 * P3-14 — payment status display. `docs/UI-UX/13` § Awaiting Payment Page.
 *
 * Used on the payment page to show the current server-polled status. The status prop comes
 * ONLY from `GET /orders/:id/payment/status` — never from URL parameters
 * (`docs/SECURITY/07` Golden Rule).
 *
 * All colours are design tokens from `@wi/ui/tokens.css`. No literal colour anywhere.
 */

import { Spinner } from "@wi/ui";

export type PaymentStatusKind =
  | "checking"
  | "pending"
  | "success"
  | "failed"
  | "expired";

export interface PaymentStatusBannerProps {
  readonly status: PaymentStatusKind;
  readonly onRetry?: (() => void) | undefined;
}

const BANNER: Readonly<
  Record<
    PaymentStatusKind,
    {
      readonly bg: string;
      readonly border: string;
      readonly text: string;
      readonly label: string;
      readonly showSpinner?: boolean;
    }
  >
> = {
  checking: {
    bg: "bg-warning-50",
    border: "border-warning-500",
    text: "text-warning-700",
    label: "Memeriksa pembayaran…",
    showSpinner: true,
  },
  pending: {
    bg: "bg-surface-sunken",
    border: "border-border",
    text: "text-text",
    label: "Menunggu pembayaran",
    showSpinner: true,
  },
  success: {
    bg: "bg-success-50",
    border: "border-success-600",
    text: "text-success-800",
    label: "Pembayaran berhasil!",
  },
  failed: {
    bg: "bg-danger-50",
    border: "border-danger-600",
    text: "text-danger-700",
    label: "Pembayaran gagal",
  },
  expired: {
    bg: "bg-danger-50",
    border: "border-danger-600",
    text: "text-danger-700",
    label: "Pesanan kedaluwarsa",
  },
};

export function PaymentStatusBanner({
  status,
  onRetry,
}: PaymentStatusBannerProps) {
  const config = BANNER[status];

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-center gap-3 rounded-lg border px-4 py-3 ${config.bg} ${config.border}`}
    >
      {config.showSpinner === true && (
        <Spinner className="size-4 shrink-0" />
      )}

      {status === "success" && (
        <span aria-hidden="true" className="text-lg">
          ✓
        </span>
      )}

      <span className={`text-sm font-medium ${config.text}`}>
        {config.label}
      </span>

      {(status === "failed" || status === "expired") && onRetry !== undefined && (
        <button
          type="button"
          className="focus-ring ml-auto rounded-md border border-border bg-surface px-3 py-1 text-sm font-medium text-text hover:bg-surface-sunken"
          onClick={onRetry}
        >
          Coba Lagi
        </button>
      )}
    </div>
  );
}
