"use client";

import { useEffect, useState } from "react";

import { Button } from "@wi/ui";

import { useEditor, useEditorContext } from "./EditorProvider";

/**
 * P1-22 step 4 — the save status indicator. `docs/UI-UX/12` § Autosave & Status Indicator.
 *
 * ## This is a feature, not a decoration
 *
 * `docs/UI-UX/18` makes the user's confidence in autosave an acceptance criterion. An editor
 * with no save button asks people to trust that their work is safe, and the only evidence
 * they get is this line of text. An indicator that says "Saved" while a request is in flight
 * is worse than no indicator at all: it teaches somebody to close the tab.
 *
 * So the DoD is stated negatively — "never shows 'Saved' when a request is in flight or
 * failed" — and the states are exhaustive rather than defaulted. There is no `else` branch
 * that renders "Saved" because nothing else matched.
 */

export function SaveStatusIndicator() {
  const status = useEditor((s) => s.saveStatus);
  const savedAt = useEditor((s) => s.savedAt);
  const failure = useEditor((s) => s.failure);
  const dirtyCount = useEditor((s) => s.dirtyFields.size);
  const { retry } = useEditorContext();

  const [retrying, setRetrying] = useState(false);

  if (status === "saving") {
    return (
      <Status tone="muted" busy>
        Menyimpan…
      </Status>
    );
  }

  if (status === "error") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Status tone="danger" assertive>
          {failure?.message ?? "Perubahan gagal disimpan."}
        </Status>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          loading={retrying}
          onClick={() => {
            void (async () => {
              setRetrying(true);
              try {
                await retry();
              } finally {
                setRetrying(false);
              }
            })();
          }}
        >
          Coba lagi
        </Button>
      </div>
    );
  }

  if (status === "saved" && savedAt !== undefined) {
    return (
      <Status tone="muted">
        Tersimpan <RelativeTime at={savedAt} />
      </Status>
    );
  }

  // `idle`. Either nothing has happened yet, or there are unsaved changes waiting for the
  // debounce — and the second must not read as "saved".
  return (
    <Status tone="muted">
      {dirtyCount > 0 ? "Perubahan belum tersimpan" : "Siap"}
    </Status>
  );
}

function Status({
  children,
  tone,
  busy,
  assertive,
}: {
  readonly children: React.ReactNode;
  readonly tone: "muted" | "danger";
  readonly busy?: boolean;
  readonly assertive?: boolean;
}) {
  return (
    <p
      // A live region, because this changes without the user doing anything to it and a
      // screen-reader user would otherwise never learn that a save failed.
      role="status"
      aria-live={assertive === true ? "assertive" : "polite"}
      {...(busy === true ? { "aria-busy": true } : {})}
      className={
        tone === "danger"
          ? "text-sm font-medium text-danger-700"
          : "text-sm text-text-muted"
      }
    >
      {children}
    </p>
  );
}

/**
 * "2 detik lalu", ticking.
 *
 * `docs/UI-UX/12` asks for a relative timestamp. It has to re-render on its own: a
 * timestamp rendered once says "just now" for the next twenty minutes, which is the same
 * class of lie as showing "Saved" during a request.
 */
function RelativeTime({ at }: { readonly at: number }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    // Ten seconds is enough for a value that is only ever precise to the minute after the
    // first minute, and it keeps a mostly-idle editor from waking up every second.
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 10_000);
    return () => {
      clearInterval(timer);
    };
  }, []);

  return <>{formatRelative(Math.max(0, now - at))}</>;
}

export function formatRelative(elapsedMs: number): string {
  const seconds = Math.floor(elapsedMs / 1000);
  if (seconds < 5) return "baru saja";
  if (seconds < 60) return `${String(seconds)} detik lalu`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)} menit lalu`;

  const hours = Math.floor(minutes / 60);
  return `${String(hours)} jam lalu`;
}

/**
 * P1-22 step 5 — the multi-tab conflict warning. `docs/FRONTEND/06` § Conflict Handling.
 *
 * Non-blocking, and dismissible. The MVP is last-write-wins and this does not change that:
 * the point is that a user who edited the same invitation in two tabs is **told**, rather
 * than discovering later that half an evening's work is gone. Blocking the editor would be a
 * worse trade — it would strand somebody whose second tab was a forgotten one.
 */
export function ConflictWarning() {
  const conflict = useEditor((s) => s.conflict);
  const dismiss = useEditor((s) => s.dismissConflict);

  if (!conflict) return null;

  return (
    <div
      role="alert"
      className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-warning-100 bg-warning-50 px-3 py-2 text-sm text-warning-800"
    >
      <span>
        Undangan ini sepertinya juga diubah di tempat lain. Muat ulang halaman
        untuk melihat versi terbaru.
      </span>
      <button
        type="button"
        className="focus-ring rounded-md px-2 py-1 font-medium underline"
        onClick={dismiss}
      >
        Tutup
      </button>
    </div>
  );
}
