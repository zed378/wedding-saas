import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

/**
 * The public shell.
 *
 * Almost empty on purpose: an invitation's chrome IS the template, so anything added
 * here appears on every wedding regardless of which template they chose.
 */
export const metadata: Metadata = {
  title: "Undangan Pernikahan",
};

export default function RootLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <html lang="id">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
