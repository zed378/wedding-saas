"use client";

/**
 * P2-04 step 2 — the route boundary for the public invitation.
 *
 * `docs/FRONTEND/08` § Public Invitation: *"A total error (invitation data fetch fails) →
 * a clear fallback page with a refresh option, NOT a blank white screen."*
 *
 * ## The tone is the requirement, not decoration
 *
 * `docs/UI-UX/14` § Special States asks for "a friendly tone" and explicitly not "a
 * technical error". This page is seen by a wedding guest who followed a WhatsApp link —
 * they did nothing wrong, they cannot fix anything, and a stack trace or an error code
 * tells them only that something is broken and they are on their own.
 *
 * So: no error code, no `digest`, no "something went wrong" shrug. What went wrong, in a
 * sentence, and the one action that might help.
 *
 * ## It says nothing about the invitation
 *
 * Not "this invitation could not be loaded" — that would confirm to anyone trying slugs
 * that a particular one exists and is merely failing. An expired or missing invitation is
 * `not-found.tsx`'s (`P2-08`), and the two must read as different situations without this
 * one leaking which it is.
 */
export default function PublicInviteError({
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  return (
    <main
      style={{
        minHeight: "60vh",
        display: "grid",
        placeItems: "center",
        padding: "2rem",
        textAlign: "center",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div>
        <h1 style={{ fontSize: "1.25rem", margin: "0 0 0.5rem" }}>
          Undangan belum bisa ditampilkan
        </h1>
        <p style={{ margin: "0 0 1.5rem", opacity: 0.8 }}>
          Sepertinya ada gangguan sesaat. Coba muat ulang halaman ini.
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
    </main>
  );
}
