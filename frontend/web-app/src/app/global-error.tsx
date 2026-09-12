"use client";

/**
 * P2-04 step 2 — the app root boundary. `docs/FRONTEND/08` § Boundary Levels, outermost.
 *
 * This catches what `error.tsx` cannot: a failure in the root layout itself. Next requires
 * it to render its own `<html>` and `<body>`, because the layout that would normally
 * provide them is the thing that failed.
 *
 * ## It cannot use the design system, and that is why
 *
 * `@wi/ui` and `globals.css` are loaded by the root layout. If the layout threw, neither
 * is reliably present — so this page styles itself inline. A boundary that depended on the
 * thing it exists to survive would render unstyled at best and throw again at worst,
 * producing the blank white screen `docs/FRONTEND/08` names as the outcome to avoid.
 *
 * `lang="id"` is repeated here for the same reason `P0-22` set it on the root layout: a
 * screen reader takes its pronunciation from it, and this page is more likely than most
 * to be read aloud by someone who cannot see what happened.
 */
export default function GlobalError({
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  return (
    <html lang="id">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: "2rem",
          textAlign: "center",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div>
          <h1 style={{ fontSize: "1.25rem", margin: "0 0 0.5rem" }}>
            Aplikasi gagal dimuat
          </h1>
          <p style={{ margin: "0 0 1.5rem", opacity: 0.8 }}>
            Terjadi gangguan. Muat ulang halaman untuk mencoba lagi.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              minHeight: "44px",
              padding: "0 1.25rem",
              borderRadius: "8px",
              border: "1px solid currentColor",
              background: "transparent",
              font: "inherit",
              cursor: "pointer",
            }}
          >
            Muat ulang
          </button>
        </div>
      </body>
    </html>
  );
}
