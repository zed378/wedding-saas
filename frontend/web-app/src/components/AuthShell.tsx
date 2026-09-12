"use client";

import type { ReactNode } from "react";

import { Card } from "@wi/ui";

/**
 * P1-20 — the frame every auth screen sits in.
 *
 * One component so that the heading level, the landmark and the form's error region are the
 * same on all five screens. `docs/UI-UX/17` asks for a single `h1` per page and a `main`
 * landmark; five screens each assembling their own is five chances to end up with two `h1`s
 * or none, and the axe pass would only catch the first of those.
 */

export interface AuthShellProps {
  readonly title: string;
  readonly description?: ReactNode;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
}

export function AuthShell({
  title,
  description,
  children,
  footer,
}: AuthShellProps) {
  return (
    <main
      id="main"
      className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-10"
    >
      <Card className="w-full">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-text">{title}</h1>
          {description !== undefined && (
            <p className="mt-2 text-sm text-text-muted">{description}</p>
          )}
        </div>

        {children}

        {footer !== undefined && (
          <div className="mt-6 border-t border-border pt-4 text-sm text-text-muted">
            {footer}
          </div>
        )}
      </Card>
    </main>
  );
}

/**
 * The form-level error region.
 *
 * `role="alert"` with `aria-live="assertive"`, because `docs/UI-UX/17` asks for errors to be
 * announced: a sighted user sees red text appear, and without a live region a screen-reader
 * user gets nothing at all after pressing a button that seemed to do nothing.
 *
 * **Always rendered**, empty when there is no error. A region that appears only when it has
 * content is a region the assistive technology has not been watching, and several screen
 * readers will not announce its first message.
 */
export function FormError({
  message,
}: {
  // `| undefined` explicitly: `exactOptionalPropertyTypes` distinguishes an absent property
  // from one set to undefined, and every caller here computes a value that may be undefined.
  readonly message?: string | undefined;
}) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className={
        message === undefined
          ? "sr-only"
          : "mb-4 rounded-md border border-danger-100 bg-danger-50 px-3 py-2 text-sm text-danger-700"
      }
    >
      {message ?? ""}
    </div>
  );
}

/**
 * A success or informational region, for a screen whose whole answer is a message.
 *
 * `role="status"` rather than `"alert"`: polite, so it waits for a pause rather than cutting
 * across whatever the user is reading. `docs/UI-UX/17`'s distinction, and it matters — an
 * assertive "email sent" interrupting a form field is worse than useless.
 */
export function FormStatus({
  message,
}: {
  readonly message?: string | undefined;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={
        message === undefined
          ? "sr-only"
          : "mb-4 rounded-md border border-success-100 bg-success-50 px-3 py-2 text-sm text-success-700"
      }
    >
      {message ?? ""}
    </div>
  );
}
