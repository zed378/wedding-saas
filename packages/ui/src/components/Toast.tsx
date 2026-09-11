"use client";

/*
 * A client component.
 *
 * Next.js's App Router renders everything on the server by default, and a server
 * component cannot hold state, use a ref, or receive an event handler. This file does
 * one of those, so it declares the boundary itself rather than making every consumer
 * remember to -- `layout.tsx` importing `<ToastProvider>` would otherwise fail at build
 * time with an error about hooks that names the app, not the library.
 *
 * The purely presentational components in this package (Badge, Card, Skeleton, Avatar,
 * Stepper, Spinner) deliberately do NOT carry this directive: they render fine on the
 * server, and marking them would pull them into the client bundle for no reason.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { cx } from "../cx.js";

/**
 * P0-22 — Toast. `docs/UI-UX/06`: "success, error, info, warning".
 *
 * ## Two live regions, not one
 *
 * `polite` waits for the screen reader to finish what it is saying; `assertive`
 * interrupts. Interrupting someone mid-sentence to say "saved" is rude and, done often
 * enough, is why people turn announcements off. Interrupting them to say "payment
 * failed" is correct.
 *
 * So errors go to an assertive region and everything else to a polite one. They have to
 * be **separate elements that exist from first render** — a live region created at the
 * moment its content appears is frequently not announced at all, because the browser has
 * nothing to diff against.
 *
 * ## Errors do not auto-dismiss
 *
 * `docs/FRONTEND/08` § Global Fetch Error Handling routes 5xx here. A message that
 * disappears after four seconds is a message someone can miss entirely, and the one
 * class of message worth reading is the one that says something went wrong.
 */

export type ToastVariant = "success" | "error" | "info" | "warning";

export interface Toast {
  readonly id: string;
  readonly variant: ToastVariant;
  readonly message: string;
  readonly description?: string | undefined;
}

export interface ToastApi {
  readonly show: (toast: Omit<Toast, "id">) => string;
  readonly dismiss: (id: string) => void;
  readonly toasts: readonly Toast[];
}

const ToastContext = createContext<ToastApi | null>(null);

/** Milliseconds before a non-error toast removes itself. */
const AUTO_DISMISS_MS = 5000;

const VARIANT: Record<ToastVariant, { box: string; label: string }> = {
  success: {
    box: "border-success-600 bg-success-50 text-success-800",
    label: "Berhasil",
  },
  error: {
    box: "border-danger-600 bg-danger-50 text-danger-800",
    label: "Gagal",
  },
  warning: {
    box: "border-warning-500 bg-warning-50 text-warning-800",
    label: "Peringatan",
  },
  info: { box: "border-info-500 bg-info-50 text-info-800", label: "Informasi" },
};

export function ToastProvider({
  children,
  autoDismissMs = AUTO_DISMISS_MS,
}: {
  readonly children: ReactNode;
  readonly autoDismissMs?: number | undefined;
}) {
  const [toasts, setToasts] = useState<readonly Toast[]>([]);
  const counter = useRef(0);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (toast: Omit<Toast, "id">): string => {
      counter.current += 1;
      const id = `toast-${counter.current}`;
      setToasts((current) => [...current, { ...toast, id }]);

      if (toast.variant !== "error") {
        setTimeout(() => {
          dismiss(id);
        }, autoDismissMs);
      }

      return id;
    },
    [autoDismissMs, dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({ show, dismiss, toasts }),
    [show, dismiss, toasts],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (api === null) {
    throw new Error("useToast must be used inside a <ToastProvider>");
  }
  return api;
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  readonly toasts: readonly Toast[];
  readonly onDismiss: (id: string) => void;
}) {
  const errors = toasts.filter((t) => t.variant === "error");
  const rest = toasts.filter((t) => t.variant !== "error");

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 sm:items-end">
      {/* Both regions render always, empty or not. A live region created at the moment
          its content arrives is frequently not announced. */}
      <Region label="Pemberitahuan penting" politeness="assertive">
        {errors.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
        ))}
      </Region>
      <Region label="Pemberitahuan" politeness="polite">
        {rest.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
        ))}
      </Region>
    </div>
  );
}

function Region({
  label,
  politeness,
  children,
}: {
  readonly label: string;
  readonly politeness: "polite" | "assertive";
  readonly children: ReactNode;
}) {
  return (
    <div
      role={politeness === "assertive" ? "alert" : "status"}
      aria-live={politeness}
      aria-label={label}
      className="flex w-full flex-col gap-2 sm:max-w-sm"
    >
      {children}
    </div>
  );
}

function ToastItem({
  toast,
  onDismiss,
}: {
  readonly toast: Toast;
  readonly onDismiss: (id: string) => void;
}) {
  const variant = VARIANT[toast.variant];

  return (
    <div
      className={cx(
        "pointer-events-auto flex items-start gap-3 rounded-md border-l-4 p-4 shadow-md",
        variant.box,
      )}
    >
      <div className="flex flex-1 flex-col gap-1">
        {/* The variant is stated in words as well as colour, per docs/UI-UX/08:
            "Color is NEVER the sole indicator of information". */}
        <p className="text-body font-semibold">
          <span className="sr-only">{variant.label}: </span>
          {toast.message}
        </p>
        {toast.description !== undefined && (
          <p className="text-body-sm">{toast.description}</p>
        )}
      </div>

      <button
        type="button"
        onClick={() => {
          onDismiss(toast.id);
        }}
        className="touch-target focus-ring -m-2 rounded-md px-2"
      >
        <span aria-hidden="true">×</span>
        <span className="sr-only">Tutup pemberitahuan</span>
      </button>
    </div>
  );
}
