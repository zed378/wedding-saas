"use client";

import { useState } from "react";
import { Modal, Button } from "@wi/ui";

/**
 * P3-15 — publish success modal. `docs/UI-UX/13` § Success Page.
 *
 * Shown after `POST /invitations/:id/publish` returns 200. Provides:
 *  - The public URL (clickable, opens in new tab)
 *  - A WhatsApp share link
 *  - A copy-to-clipboard button
 *
 * The `public_url` comes from the server response and is a guaranteed working link at this
 * point. Behaviour after close is up to the caller — usually a router push to the editor.
 */

export interface PublishSuccessModalProps {
  readonly publicUrl: string;
  readonly open: boolean;
  readonly onClose: () => void;
}

export function PublishSuccessModal({
  publicUrl,
  open,
  onClose,
}: PublishSuccessModalProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch {
      // Clipboard API may be blocked (e.g., in non-secure contexts). Select-text
      // fallback so the user can copy manually.
      const input = document.querySelector<HTMLInputElement>(
        "[data-public-url]",
      );
      input?.select();
    }
  }

  const waText = encodeURIComponent(
    `Undangan pernikahan kami: ${publicUrl}`,
  );
  const waUrl = `https://wa.me/?text=${waText}`;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Undangan berhasil diterbitkan!"
      footer={
        <Button variant="secondary" onClick={onClose}>
          Tutup
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2 rounded-lg border border-success-600 bg-success-50 px-3 py-2">
          <span aria-hidden="true" className="text-lg text-success-600">
            ✓
          </span>
          <p className="text-sm font-medium text-success-800">
            Undangan Anda kini bisa diakses publik.
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-text">Tautan undangan</p>
          <div className="flex gap-2">
            <input
              data-public-url
              readOnly
              value={publicUrl}
              className="min-w-0 flex-1 rounded-md border border-border bg-surface-sunken px-3 py-1.5 text-sm text-text"
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                void handleCopy();
              }}
            >
              {copied ? "Tersalin!" : "Salin"}
            </Button>
          </div>
          <a
            href={publicUrl}
            target="_blank"
            rel="noreferrer"
            className="focus-ring mt-1 text-sm text-primary-600 underline"
          >
            Buka tautan
          </a>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <a
            href={waUrl}
            target="_blank"
            rel="noreferrer"
            className="focus-ring inline-flex items-center justify-center gap-2 rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium text-text hover:bg-surface-sunken"
          >
            {/* WhatsApp green is brand-specified and not a design token; the text and icon
                label the action regardless of colour (`docs/UI-UX/08` § Accessibility). */}
            <span aria-hidden="true">📱</span>
            Bagikan via WhatsApp
          </a>
        </div>
      </div>
    </Modal>
  );
}
