import type { Metadata } from "next";
import type { ReactNode } from "react";

import { ToastProvider } from "@wi/ui";

import { AuthProvider } from "../lib/auth";

import "./globals.css";

/**
 * P0-22 — the app shell.
 *
 * `lang="id"` is not cosmetic. A screen reader picks its pronunciation rules from it,
 * and an Indonesian interface announced with English phonemes is close to unusable --
 * `docs/UI-UX/17` requires the page language to be set for exactly this reason.
 */
export const metadata: Metadata = {
  title: {
    default: "Undangan Digital",
    template: "%s · Undangan Digital",
  },
  description: "Buat dan terbitkan undangan pernikahan digital.",
  // The authenticated app is never indexed: every page behind it is someone's private
  // data, and the marketing pages that should be indexed are a P1 concern with their
  // own metadata.
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <html lang="id">
      <body className="min-h-dvh bg-surface text-text antialiased">
        {/*
         * The skip link is the first focusable thing on every page.
         * docs/UI-UX/17: a keyboard user must be able to reach the content without
         * tabbing through the whole navigation on every single page. It is hidden
         * until focused, which is why `sr-only focus:not-sr-only` rather than
         * `hidden`.
         */}
        <a
          href="#main"
          className="focus-ring sr-only rounded-md bg-primary-600 px-4 py-2 text-text-inverse focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50"
        >
          Lewati ke konten utama
        </a>

        {/*
         * `AuthProvider` outside `ToastProvider` would leave a session-expiry toast with
         * nowhere to go; inside it, the provider can report one. The order is deliberate.
         */}
        <ToastProvider>
          <AuthProvider>{children}</AuthProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
