import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@wi/ui/src/testing/setup.js";

import { PublishSuccessModal } from "../src/components/PublishSuccessModal";

/**
 * P3-15 — PublishSuccessModal component.
 *
 * Shows the public URL, a WhatsApp share button, and a copy-to-clipboard button
 * after a successful publish.
 */

const PUBLIC_URL = "https://invitation.vizunicum.my.id/budi-dan-ani";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PublishSuccessModal", () => {
  it("shows the public URL in the input", async () => {
    render(
      <PublishSuccessModal publicUrl={PUBLIC_URL} open onClose={vi.fn()} />,
    );

    const input = await screen.findByDisplayValue(PUBLIC_URL);
    expect(input).toBeInTheDocument();
  });

  it("has a clickable 'Buka tautan' link that opens in a new tab", async () => {
    render(
      <PublishSuccessModal publicUrl={PUBLIC_URL} open onClose={vi.fn()} />,
    );

    const link = await screen.findByRole("link", { name: /buka tautan/i });
    expect(link).toHaveAttribute("href", PUBLIC_URL);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noreferrer"));
  });

  it("has a WhatsApp share link with the invitation URL", async () => {
    render(
      <PublishSuccessModal publicUrl={PUBLIC_URL} open onClose={vi.fn()} />,
    );

    const waLink = await screen.findByRole("link", { name: /whatsapp/i });
    expect(waLink).toHaveAttribute(
      "href",
      expect.stringContaining("wa.me"),
    );
    expect(waLink).toHaveAttribute(
      "href",
      expect.stringContaining(encodeURIComponent(PUBLIC_URL)),
    );
  });

  it("calls onClose when the close button is clicked", async () => {
    const onClose = vi.fn();
    render(
      <PublishSuccessModal publicUrl={PUBLIC_URL} open onClose={onClose} />,
    );

    // The footer has a "Tutup" button — use the last one (the action button, not the X icon).
    const allClose = await screen.findAllByRole("button", { name: /tutup/i });
    await userEvent.click(allClose[allClose.length - 1]!);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("copies the URL to clipboard when 'Salin' is clicked", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", {
      clipboard: { writeText },
    });

    render(
      <PublishSuccessModal publicUrl={PUBLIC_URL} open onClose={vi.fn()} />,
    );

    await userEvent.click(await screen.findByRole("button", { name: /salin/i }));

    expect(writeText).toHaveBeenCalledWith(PUBLIC_URL);
  });

  it("shows 'Tersalin!' after copying", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", {
      clipboard: { writeText },
    });

    render(
      <PublishSuccessModal publicUrl={PUBLIC_URL} open onClose={vi.fn()} />,
    );

    await userEvent.click(await screen.findByRole("button", { name: /salin/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /tersalin/i })).toBeInTheDocument();
    });
  });

  it("does not render when open=false", () => {
    const { container } = render(
      <PublishSuccessModal publicUrl={PUBLIC_URL} open={false} onClose={vi.fn()} />,
    );

    // dialog element is rendered but closed (not open attribute).
    const dialog = container.querySelector("dialog");
    expect(dialog).not.toHaveAttribute("open");
  });
});
