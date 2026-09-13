/**
 * `P2-12` — the preview watermark. `docs/PLAN/01` FR-4.3, `docs/PLAN/04` § F6.
 *
 * *"a 'PREVIEW - NOT YET PUBLISHED' visual watermark"*. Two parts, for two different jobs:
 *
 *   - **a sticky banner** at the top, as real text in a `role="note"`, so a screen reader
 *     announces it and a guest scrolling a long invitation never loses it;
 *   - **a tiled diagonal overlay** across the whole page, `aria-hidden` and
 *     `pointer-events: none`, so a screenshot of any part of the invitation still says it is
 *     a preview. A banner alone is cropped out of the first screenshot anybody takes.
 *
 * Neither is themeable. The whole point is that it looks the same on every template and
 * cannot be styled away by a colour choice.
 */
export function PreviewWatermark() {
  return (
    <>
      <div
        role="note"
        data-preview-watermark="true"
        className="sticky top-0 z-30 bg-neutral-900 px-4 py-2 text-center text-xs font-semibold tracking-wide text-white uppercase"
      >
        Pratinjau — belum diterbitkan
      </div>
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-20 flex flex-wrap content-start justify-center gap-x-10 gap-y-24 overflow-hidden pt-24 opacity-10 select-none"
      >
        {Array.from({ length: 24 }, (_, index) => (
          <span
            key={index}
            className="-rotate-30 text-lg font-bold whitespace-nowrap text-neutral-900 uppercase"
          >
            Pratinjau
          </span>
        ))}
      </div>
    </>
  );
}
