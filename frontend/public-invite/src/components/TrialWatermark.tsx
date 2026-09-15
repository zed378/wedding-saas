/**
 * `P3-09` — the free-trial notice on a published invitation. BR-2.8, ADR-052, ADR-080.
 *
 * `display.watermark` is `true` for any invitation nobody has paid for (`docs/API/08`, `P3-01`), and a
 * trial publish is exactly that. Until `P3-09` the public page ignored the flag — a trial looked like a
 * paid invitation to every guest.
 *
 * Deliberately small: one line of real text in a `role="note"`, at the foot of the screen, not a tiled
 * overlay. A preview says "this is not finished"; a trial IS the finished invitation for three days, and
 * what the watermark should look like on it is `OQ-13`. Not themeable, like the preview watermark, so a
 * template's colours cannot hide it.
 */
export function TrialWatermark() {
  return (
    <div
      role="note"
      data-trial-watermark="true"
      className="fixed inset-x-0 bottom-0 z-30 bg-neutral-900/85 px-4 py-1.5 text-center text-[11px] font-medium tracking-wide text-white"
    >
      Undangan versi uji coba
    </div>
  );
}
