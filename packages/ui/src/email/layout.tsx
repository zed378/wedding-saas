import React from "react";
import type { BaseEmailProps } from "./types.js";

export interface EmailLayoutProps extends BaseEmailProps {
  readonly title: string;
  readonly children: React.ReactNode;
}

/**
 * Standard email layout for all transactional Momen Bahagia emails (P4-06).
 * Follows table-based HTML layout for reliable cross-client rendering.
 */
export function EmailLayout({
  title,
  previewText,
  unsubscribeUrl,
  preferencesUrl,
  children,
}: EmailLayoutProps): React.JSX.Element {
  return (
    <html lang="id">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{title}</title>
        <style>{`
          body { margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; color: #1e293b; }
          a { color: #4f46e5; text-decoration: none; }
          a:hover { text-decoration: underline; }
        `}</style>
      </head>
      <body style={{ margin: 0, padding: 0, backgroundColor: "#f8fafc" }}>
        {previewText ? (
          <div
            style={{
              display: "none",
              maxHeight: 0,
              maxWidth: 0,
              opacity: 0,
              overflow: "hidden",
            }}
          >
            {previewText}
          </div>
        ) : null}

        <table
          width="100%"
          border={0}
          cellPadding={0}
          cellSpacing={0}
          style={{ backgroundColor: "#f8fafc", padding: "32px 16px" }}
        >
          <tbody>
            <tr>
              <td align="center">
                {/* Header */}
                <table
                  width="100%"
                  border={0}
                  cellPadding={0}
                  cellSpacing={0}
                  style={{ maxWidth: "600px", marginBottom: "24px" }}
                >
                  <tbody>
                    <tr>
                      <td align="center">
                        <span
                          style={{
                            fontSize: "22px",
                            fontWeight: 700,
                            letterSpacing: "-0.5px",
                            color: "#1e1b4b",
                          }}
                        >
                          Momen Bahagia
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>

                {/* Main Card */}
                <table
                  width="100%"
                  border={0}
                  cellPadding={0}
                  cellSpacing={0}
                  style={{
                    maxWidth: "600px",
                    backgroundColor: "#ffffff",
                    borderRadius: "12px",
                    border: "1px solid #e2e8f0",
                    overflow: "hidden",
                    boxShadow: "0 1px 3px 0 rgba(0, 0, 0, 0.05)",
                  }}
                >
                  <tbody>
                    <tr>
                      <td style={{ padding: "36px 32px" }}>{children}</td>
                    </tr>
                  </tbody>
                </table>

                {/* Footer */}
                <table
                  width="100%"
                  border={0}
                  cellPadding={0}
                  cellSpacing={0}
                  style={{
                    maxWidth: "600px",
                    marginTop: "24px",
                    textAlign: "center",
                  }}
                >
                  <tbody>
                    <tr>
                      <td
                        style={{
                          fontSize: "12px",
                          lineHeight: "18px",
                          color: "#64748b",
                        }}
                      >
                        <p style={{ margin: "0 0 8px 0" }}>
                          Email ini dikirim otomatis oleh sistem Momen Bahagia.
                        </p>
                        <p style={{ margin: "0 0 12px 0" }}>
                          © {new Date().getFullYear()} Momen Bahagia · Platform
                          Undangan Digital Indonesia
                        </p>
                        {preferencesUrl || unsubscribeUrl ? (
                          <p style={{ margin: 0, fontSize: "11px" }}>
                            {preferencesUrl ? (
                              <a
                                href={preferencesUrl}
                                style={{
                                  color: "#64748b",
                                  textDecoration: "underline",
                                }}
                              >
                                Pengaturan Notifikasi
                              </a>
                            ) : null}
                            {preferencesUrl && unsubscribeUrl ? " · " : null}
                            {unsubscribeUrl ? (
                              <a
                                href={unsubscribeUrl}
                                style={{
                                  color: "#64748b",
                                  textDecoration: "underline",
                                }}
                              >
                                Berhenti Berlangganan
                              </a>
                            ) : null}
                          </p>
                        ) : null}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      </body>
    </html>
  );
}

export function EmailButton({
  href,
  children,
}: {
  readonly href: string;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <table
      border={0}
      cellPadding={0}
      cellSpacing={0}
      style={{ margin: "24px 0" }}
    >
      <tbody>
        <tr>
          <td
            align="center"
            style={{
              backgroundColor: "#4f46e5",
              borderRadius: "8px",
            }}
          >
            <a
              href={href}
              style={{
                display: "inline-block",
                padding: "12px 24px",
                fontSize: "14px",
                fontWeight: 600,
                color: "#ffffff",
                textDecoration: "none",
                borderRadius: "8px",
              }}
            >
              {children}
            </a>
          </td>
        </tr>
      </tbody>
    </table>
  );
}
