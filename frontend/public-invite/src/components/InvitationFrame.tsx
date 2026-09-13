import type { ReactNode } from "react";

/**
 * `P2-08` step 6 — the letterbox. `docs/UI-UX/15` § Responsive Strategy.
 *
 * *"Public Invitation | Purely mobile-first, desktop is 'letterboxed' — a mobile-width
 * view centered on a large screen (because the invitation is visually designed with a
 * mobile aspect ratio in mind) — a common pattern in the digital invitation industry."*
 *
 * ## Why a width cap rather than a responsive layout
 *
 * A template's sections are composed for a phone: a full-bleed cover photo, a single
 * column of event cards, a gallery two across. Letting those stretch to 1440px does not
 * produce a desktop design, it produces a phone design with very long lines — and every
 * template in the catalogue would have to be redesigned twice to avoid it.
 *
 * The cap is `26rem` (416px), a little over `docs/UI-UX/12`'s 375px device width, so a
 * 390px iPhone is unconstrained and a desktop sees the same proportions a guest on a
 * phone does.
 *
 * ## The surround is neutral, and that is deliberate
 *
 * The area beside the letterbox belongs to no template. It uses a plain neutral rather
 * than a theme colour because `--color-*` is per-invitation data: a theme with a dark
 * background would paint the whole desktop screen, and a template author choosing a
 * colour for a cover section did not choose it for that.
 */
export function InvitationFrame({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh justify-center bg-neutral-100">
      <div
        data-invitation-frame="true"
        // `w-full` first: below the cap this is an ordinary full-width page, which is the
        // case almost every guest is in.
        className="w-full max-w-[26rem] bg-white shadow-sm"
      >
        {children}
      </div>
    </div>
  );
}
