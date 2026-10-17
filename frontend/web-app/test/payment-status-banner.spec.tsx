import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  PaymentStatusBanner,
  type PaymentStatusKind,
} from "../src/components/PaymentStatusBanner";

/**
 * P3-14 — PaymentStatusBanner component.
 *
 * Each status maps to a distinct label and visual cue. The component is used on the
 * payment page, and its state ALWAYS comes from the server (`GET /orders/:id/payment/status`),
 * never from URL parameters.
 */

afterEach(() => {
  cleanup();
});

const STATUS_LABELS: Readonly<Record<PaymentStatusKind, RegExp>> = {
  checking: /memeriksa pembayaran/i,
  pending: /menunggu pembayaran/i,
  success: /pembayaran berhasil/i,
  failed: /pembayaran gagal/i,
  expired: /pesanan kedaluwarsa/i,
};

describe("PaymentStatusBanner", () => {
  it.each(Object.entries(STATUS_LABELS) as [PaymentStatusKind, RegExp][])(
    "renders the correct label for status %s",
    (status, expected) => {
      render(<PaymentStatusBanner status={status} />);
      expect(screen.getByRole("status")).toHaveTextContent(expected);
    },
  );

  it("shows a spinner for 'checking' status", () => {
    const { container } = render(<PaymentStatusBanner status="checking" />);
    // The Spinner component renders an SVG with role="presentation" or similar.
    // We look for the Spinner by checking the component's `showSpinner` branch.
    // A spinner visible = an element that animates is present (svg or Spinner wrapper).
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("shows a spinner for 'pending' status", () => {
    const { container } = render(<PaymentStatusBanner status="pending" />);
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("does NOT show a retry button when onRetry is not provided", () => {
    render(<PaymentStatusBanner status="failed" />);
    expect(
      screen.queryByRole("button", { name: /coba lagi/i }),
    ).not.toBeInTheDocument();
  });

  it("shows a retry button when status is 'failed' and onRetry is provided", async () => {
    const onRetry = vi.fn();
    render(<PaymentStatusBanner status="failed" onRetry={onRetry} />);

    const btn = screen.getByRole("button", { name: /coba lagi/i });
    expect(btn).toBeInTheDocument();

    await userEvent.click(btn);
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("shows a retry button when status is 'expired' and onRetry is provided", async () => {
    const onRetry = vi.fn();
    render(<PaymentStatusBanner status="expired" onRetry={onRetry} />);

    await userEvent.click(screen.getByRole("button", { name: /coba lagi/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("does NOT show a retry button for 'success' status", () => {
    render(
      <PaymentStatusBanner status="success" onRetry={vi.fn()} />,
    );
    expect(
      screen.queryByRole("button", { name: /coba lagi/i }),
    ).not.toBeInTheDocument();
  });

  it("has a role='status' for live region announcements", () => {
    render(<PaymentStatusBanner status="checking" />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
