import type { ReactNode } from "react";

import { cx } from "../cx.js";

/**
 * P0-22 — Badge, and the invitation status map.
 *
 * `docs/UI-UX/08` § Invitation Status (Badge) gives the colour per status, and
 * `docs/UI-UX/06` § Usage Rules repeats it. This is **the only place** either exists.
 * The DoD says so, and the reason is specific: a status badge rendered by a conditional
 * on a dashboard, and again in a table, and again in the admin panel, is three
 * conditionals that will disagree the first time a status is added — and the one that
 * gets missed is always the rarest status, seen by the fewest people, reported by none
 * of them.
 *
 * ## Colour is never the only signal
 *
 * `docs/UI-UX/08` § Contrast & Accessibility: "Color is NEVER the sole indicator of
 * information (e.g., status is also accompanied by a text label/icon, not just the badge
 * color) — important for color-blind users."
 *
 * So `InvitationStatusBadge` renders a **label**, and the label is not optional. There
 * is no prop to turn it off.
 */

export type BadgeTone =
  "neutral" | "primary" | "success" | "warning" | "danger" | "info" | "premium";

const TONE: Record<BadgeTone, string> = {
  neutral: "bg-neutral-100 text-neutral-700 border-neutral-300",
  primary: "bg-primary-50 text-primary-800 border-primary-200",
  success: "bg-success-50 text-success-800 border-success-600",
  warning: "bg-warning-50 text-warning-800 border-warning-500",
  danger: "bg-danger-50 text-danger-800 border-danger-600",
  info: "bg-info-50 text-info-800 border-info-500",
  // docs/UI-UX/08: secondary/amber is "accents, promo highlights/premium badges".
  premium: "bg-secondary-100 text-secondary-900 border-secondary-500",
};

export interface BadgeProps {
  readonly tone?: BadgeTone | undefined;
  readonly children: ReactNode;
  readonly className?: string | undefined;
}

export function Badge({ tone = "neutral", children, className }: BadgeProps) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5",
        "text-body-sm font-medium whitespace-nowrap",
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * The five invitation statuses. `docs/DATABASE/04`'s CHECK constraint is the same list,
 * and a status the database can store but this map cannot render would be a badge that
 * throws on a real row.
 */
export type InvitationStatus =
  | "draft"
  | "pending_payment"
  | "paid"
  | "published"
  | "expired"
  | "soft_deleted";

interface StatusPresentation {
  readonly tone: BadgeTone;
  readonly label: string;
}

/**
 * `docs/UI-UX/08` § Invitation Status (Badge), verbatim:
 *
 * | draft | neutral-400 | pending_payment | warning | paid | info |
 * | published | success | expired | danger (muted) |
 *
 * `soft_deleted` is not in that table because it is not a state a user is shown — a
 * soft-deleted invitation is absent from their list entirely (`docs/PLAN/06`). It is
 * here because the column can hold it and the admin panel (`P5`) will display it, and a
 * map that throws on a value the database contains is worse than a neutral badge.
 */
const STATUS: Record<InvitationStatus, StatusPresentation> = {
  draft: { tone: "neutral", label: "Draf" },
  pending_payment: { tone: "warning", label: "Menunggu pembayaran" },
  paid: { tone: "info", label: "Sudah dibayar" },
  published: { tone: "success", label: "Terbit" },
  expired: { tone: "danger", label: "Kedaluwarsa" },
  soft_deleted: { tone: "neutral", label: "Dihapus" },
};

export interface InvitationStatusBadgeProps {
  readonly status: InvitationStatus;
  readonly className?: string | undefined;
}

export function InvitationStatusBadge({
  status,
  className,
}: InvitationStatusBadgeProps) {
  // A status outside the map means the database grew a value this build does not know.
  // A neutral badge naming the raw value is the right failure: it degrades, it is
  // obviously wrong to whoever sees it, and it does not take the page down.
  const presentation = STATUS[status] ?? { tone: "neutral", label: status };

  return (
    <Badge tone={presentation.tone} className={className}>
      {presentation.label}
    </Badge>
  );
}

/** Exported for tests and for the admin filter list. Not for rendering by hand. */
export const INVITATION_STATUS_PRESENTATION: Readonly<
  Record<InvitationStatus, StatusPresentation>
> = STATUS;
