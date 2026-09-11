import { cx } from "../cx.js";

/**
 * P0-22 — Stepper. `docs/UI-UX/06`: "for the onboarding flow".
 *
 * ## An ordered list, not a row of circles
 *
 * The steps are a sequence, so the markup is `<ol>`. A screen reader then says "list,
 * four items, item two of four" without any ARIA at all — which is most of what a
 * progress indicator is for.
 *
 * ## The state is in words
 *
 * `docs/UI-UX/08`: colour is never the only signal. A completed step is not merely
 * green: it carries a visually-hidden "selesai", the current step carries
 * `aria-current="step"`, and an upcoming step says so. Someone who cannot distinguish
 * the green from the grey still knows where they are.
 *
 * It is deliberately **not** interactive. Onboarding steps that can be clicked out of
 * order are a source of half-completed state, and `docs/UI-UX/10` describes the flow as
 * linear. If a later task needs navigation, it should be a decision, not a default.
 */

export interface Step {
  readonly id: string;
  readonly label: string;
}

export interface StepperProps {
  readonly steps: readonly Step[];
  /** Zero-based index of the step the user is on. */
  readonly current: number;
  /** The accessible name, e.g. "Langkah pembuatan undangan". */
  readonly label: string;
  readonly className?: string | undefined;
}

export function Stepper({ steps, current, label, className }: StepperProps) {
  return (
    <nav aria-label={label} className={className}>
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-3">
        {steps.map((step, index) => {
          const state =
            index < current
              ? "done"
              : index === current
                ? "current"
                : "upcoming";

          return (
            <li key={step.id} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={cx(
                  "flex size-8 shrink-0 items-center justify-center rounded-full border text-body-sm font-semibold",
                  // success-700, not success-600. White on #16a34a is 3.30:1 --
                  // below the 4.5:1 docs/UI-UX/08 requires for the numeral and the
                  // check glyph. Measured in tokens.spec.ts.
                  state === "done" &&
                    "border-success-700 bg-success-700 text-text-inverse",
                  state === "current" &&
                    "border-primary-600 bg-primary-600 text-text-inverse",
                  state === "upcoming" &&
                    "border-border-strong bg-surface-raised text-text-muted",
                )}
              >
                {state === "done" ? "✓" : index + 1}
              </span>

              <span
                aria-current={state === "current" ? "step" : undefined}
                className={cx(
                  "text-body font-medium",
                  state === "current" ? "text-text" : "text-text-muted",
                )}
              >
                {step.label}
                <span className="sr-only">
                  {state === "done"
                    ? " (selesai)"
                    : state === "current"
                      ? " (langkah saat ini)"
                      : " (belum dimulai)"}
                </span>
              </span>

              {index < steps.length - 1 && (
                <span
                  aria-hidden="true"
                  className="ml-2 hidden h-px w-8 bg-border-strong sm:block"
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
