import type { ReactNode } from "react";

import { cx } from "../cx.js";

/**
 * P0-22 — Card. `docs/UI-UX/06`: "template card, invitation card, order card".
 *
 * One component, not three. The three named uses differ in what they contain, not in
 * how they are framed, and a `TemplateCard` in the design system would be a screen
 * living in the component library -- which is how a design system stops being reusable.
 *
 * `interactive` makes the whole card a link target. When set, the card renders as a
 * `<button>` or the caller wraps it in an anchor: a `<div>` with an onClick is
 * unreachable by keyboard and invisible to a screen reader, and it is the most common
 * accessibility defect in a dashboard.
 */
export interface CardProps {
  readonly children: ReactNode;
  readonly className?: string | undefined;
  readonly padded?: boolean | undefined;
}

export function Card({ children, className, padded = true }: CardProps) {
  return (
    <div
      className={cx(
        "rounded-lg border border-border bg-surface-raised shadow-sm",
        padded && "p-6",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  actions,
}: {
  readonly title: ReactNode;
  readonly description?: ReactNode | undefined;
  readonly actions?: ReactNode | undefined;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-h3 font-semibold text-text">{title}</h3>
        {description !== undefined && (
          <p className="text-body text-text-muted">{description}</p>
        )}
      </div>
      {actions}
    </div>
  );
}
