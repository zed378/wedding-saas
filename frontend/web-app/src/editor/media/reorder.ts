/**
 * P1-24 step 4 — reordering, and the keyboard path that is not an afterthought.
 *
 * ## The keyboard alternative is the requirement, not the fallback
 *
 * `docs/UI-UX/17` asks for it explicitly for this interaction, and the card's DoD says
 * "reordering is **fully** operable by keyboard". Drag-and-drop is unusable with a keyboard,
 * unreliable with a screen reader, and impossible on some assistive setups — so "move up" and
 * "move down" are the primary mechanism here and the drag is the convenience.
 *
 * That ordering matters in practice: a move-up button is a pure function over an array, which
 * is testable in jsdom and provable. A drag is a sequence of pointer events that no unit test
 * in this repository can exercise honestly.
 */

/**
 * Move one item, returning a new array.
 *
 * Out-of-range moves return the array unchanged rather than throwing or wrapping: the first
 * item's "move up" button is disabled, and a keyboard user who reaches it anyway should get
 * nothing rather than a surprise jump to the bottom.
 */
export function moveItem<T>(
  items: readonly T[],
  from: number,
  to: number,
): T[] {
  if (from === to) return [...items];
  if (from < 0 || from >= items.length) return [...items];
  if (to < 0 || to >= items.length) return [...items];

  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

/**
 * A debounced sender for the reorder call. `docs/FRONTEND/05` § Gallery Manager.
 *
 * Somebody rearranging twelve photos presses "move up" eight times in four seconds. Eight
 * `POST /gallery/reorder` calls would each carry a *different* complete order, they would
 * arrive out of sequence, and the last one to land would win — which may not be the one the
 * user finished on. One call per pause, carrying the final arrangement, is both fewer
 * requests and the only version that is correct.
 */
export class ReorderSender {
  #timer: ReturnType<typeof setTimeout> | undefined;
  #pending: readonly string[] | undefined;
  #inFlight = false;
  #again = false;

  constructor(
    private readonly send: (orderedIds: readonly string[]) => Promise<void>,
    private readonly onError: (message: string) => void,
    private readonly debounceMs = 600,
  ) {}

  queue(orderedIds: readonly string[]): void {
    // The latest arrangement replaces the previous one outright. An intermediate order is
    // not a state anybody asked to persist.
    this.#pending = [...orderedIds];

    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.#run();
    }, this.debounceMs);
  }

  /** Send now. For unmount, and for a test that does not want to wait. */
  async flush(): Promise<void> {
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
    await this.#run();
  }

  async #run(): Promise<void> {
    if (this.#inFlight) {
      // Same reasoning as the autosave manager: two overlapping reorder calls can land in
      // either order and the loser silently wins.
      this.#again = true;
      return;
    }
    const order = this.#pending;
    if (order === undefined) return;

    this.#pending = undefined;
    this.#inFlight = true;

    try {
      await this.send(order);
    } catch (error) {
      // The order the user sees is already applied locally. Reporting rather than reverting
      // is deliberate: snapping twelve photos back to where they were, silently, is a worse
      // experience than a message saying the order was not saved.
      this.onError(
        error instanceof Error ? error.message : "Urutan foto gagal disimpan.",
      );
    } finally {
      this.#inFlight = false;
    }

    if (this.#again) {
      this.#again = false;
      await this.#run();
    }
  }
}
