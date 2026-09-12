import type { FieldPath } from "./store";

/**
 * P1-22 step 3 and 6 — the autosave manager. `docs/FRONTEND/06` § Data Flow.
 *
 * ## What it guarantees
 *
 * **Nothing is lost.** A field edited while a save is in flight is queued for the next one; a
 * save that fails leaves its fields queued; a field edited a hundred times produces one
 * request per pause. The card's first DoD item — "editing 100 fields in sequence loses
 * nothing" — is a statement about this file.
 *
 * **One request at a time.** Two overlapping PATCHes to the same sub-resource can land in
 * either order, and the loser silently wins. So a flush that begins while one is running sets
 * a flag instead, and the running save schedules the next one when it settles.
 *
 * ## Why it is a plain class
 *
 * No React. Timers, an in-flight promise and a pending set are awkward inside a hook's
 * closure and trivial in an object, and the tests that matter — a hundred edits, a failure
 * mid-flight, a keystroke during a save — are far easier to write against something that
 * takes a clock and a transport as arguments.
 *
 * ## Grouping
 *
 * `docs/API/04` has a sub-resource per concern: `/couple/:role`, `/events/:id`, `/settings`,
 * `/quote`. A change to `couple.groom.nickname` becomes a PATCH to the couple endpoint, and
 * two changes to two fields of the same person become **one** request. `groupFields` is where
 * that mapping lives; the manager itself never knows a URL.
 */

export type SaveGroupKey = string;

export interface SaveGroup {
  /** Stable per sub-resource, e.g. `couple:groom`. Changes to it coalesce. */
  readonly key: SaveGroupKey;
  readonly fields: readonly FieldPath[];
}

export interface AutosaveTransport {
  /**
   * Persist one group. Resolves with the server's new `updated_at` when it has one.
   *
   * Throwing means the save failed: the manager keeps the fields queued and reports the
   * failure. It does not retry automatically — `docs/UI-UX/12` asks for a **manual** retry
   * button, because a silent retry loop against a server rejecting the data is a spinner
   * that never stops.
   */
  readonly save: (group: SaveGroup) => Promise<{ updatedAt?: string } | void>;
}

export interface AutosaveCallbacks {
  readonly onBeginSave: (fields: readonly FieldPath[]) => void;
  readonly onSaved: (
    fields: readonly FieldPath[],
    updatedAt: string | undefined,
  ) => void;
  readonly onFailed: (fields: readonly FieldPath[], message: string) => void;
}

export interface AutosaveOptions {
  readonly transport: AutosaveTransport;
  /**
   * Which sub-resource owns a path.
   *
   * **Required**, and it lives in `transport.ts` rather than here. This file is about timing
   * and queuing; the moment it also knew that `couple.groom.*` is one endpoint, it would be a
   * second place holding the field vocabulary — which is what
   * `scripts/check-no-hardcoded-fields.mjs` exists to prevent.
   */
  readonly groupFor: (path: FieldPath) => SaveGroupKey;
  readonly callbacks: AutosaveCallbacks;
  /** `docs/FRONTEND/06`: "debounced 1-1.5s". */
  readonly debounceMs?: number;
  /** Injected so tests do not wait in real time. */
  readonly setTimeout?: typeof globalThis.setTimeout;
  readonly clearTimeout?: typeof globalThis.clearTimeout;
}

const DEFAULT_DEBOUNCE_MS = 1_200;

export class AutosaveManager {
  readonly #options: Required<
    Pick<AutosaveOptions, "transport" | "callbacks">
  > & {
    debounceMs: number;
    setTimeout: typeof globalThis.setTimeout;
    clearTimeout: typeof globalThis.clearTimeout;
    groupFor: (path: FieldPath) => SaveGroupKey;
  };

  /** Fields waiting to be sent, by group. */
  readonly #pending = new Map<SaveGroupKey, Set<FieldPath>>();
  #timer: ReturnType<typeof globalThis.setTimeout> | undefined;
  #inFlight: Promise<void> | undefined;
  /** A flush arrived while one was running; run again when it settles. */
  #again = false;
  #stopped = false;

  constructor(options: AutosaveOptions) {
    this.#options = {
      transport: options.transport,
      callbacks: options.callbacks,
      debounceMs: options.debounceMs ?? DEFAULT_DEBOUNCE_MS,
      setTimeout: options.setTimeout ?? globalThis.setTimeout,
      clearTimeout: options.clearTimeout ?? globalThis.clearTimeout,
      groupFor: options.groupFor,
    };
  }

  /**
   * Record a change. Restarts the debounce.
   *
   * Card step 6: a fast typist produces one request per pause. Each keystroke replaces the
   * timer, so twenty characters in a row are one save — and the field is only recorded once
   * because `#pending` holds a set of paths rather than a list of changes.
   */
  queue(path: FieldPath): void {
    if (this.#stopped) return;

    const key = this.#options.groupFor(path);
    const group = this.#pending.get(key) ?? new Set<FieldPath>();
    group.add(path);
    this.#pending.set(key, group);

    this.#restartTimer();
  }

  /** Send everything now, without waiting for the debounce. For a retry, or on unmount. */
  async flush(): Promise<void> {
    this.#cancelTimer();
    await this.#run();
  }

  /**
   * Stop accepting work and send what is queued.
   *
   * Called when the editor unmounts. A pending debounce discarded on navigation is the
   * quietest way to lose a user's last sentence.
   */
  async stop(): Promise<void> {
    this.#cancelTimer();
    await this.#run();
    this.#stopped = true;
  }

  /** For the status indicator and for tests: is anything unsent? */
  get hasPending(): boolean {
    return this.#pending.size > 0;
  }

  #restartTimer(): void {
    this.#cancelTimer();
    this.#timer = this.#options.setTimeout(() => {
      this.#timer = undefined;
      void this.#run();
    }, this.#options.debounceMs);
  }

  #cancelTimer(): void {
    if (this.#timer !== undefined) {
      this.#options.clearTimeout(this.#timer);
      this.#timer = undefined;
    }
  }

  async #run(): Promise<void> {
    if (this.#inFlight !== undefined) {
      // Two overlapping PATCHes to one sub-resource can land in either order, and the loser
      // silently wins. So this does not start a second save; it asks the running one to go
      // round again.
      this.#again = true;
      return this.#inFlight;
    }
    if (this.#pending.size === 0) return;

    this.#inFlight = this.#cycle();
    try {
      await this.#inFlight;
    } finally {
      this.#inFlight = undefined;
    }

    if (this.#again) {
      this.#again = false;
      await this.#run();
    }
  }

  async #cycle(): Promise<void> {
    // Taken, not drained-as-we-go: a keystroke arriving during the request lands in a fresh
    // `#pending` entry and is sent by the next cycle rather than being marked saved.
    const batches = [...this.#pending.entries()].map(([key, fields]) => ({
      key,
      fields: [...fields],
    }));
    this.#pending.clear();

    const all = batches.flatMap((b) => b.fields);
    this.#options.callbacks.onBeginSave(all);

    for (const batch of batches) {
      try {
        const result = await this.#options.transport.save(batch);
        this.#options.callbacks.onSaved(
          batch.fields,
          typeof result === "object" && result !== null
            ? result.updatedAt
            : undefined,
        );
      } catch (error) {
        // Requeued, so the work is not lost and a retry has something to send. The other
        // batches still go — a failing events endpoint should not hold the couple's names
        // hostage.
        const group = this.#pending.get(batch.key) ?? new Set<FieldPath>();
        for (const field of batch.fields) group.add(field);
        this.#pending.set(batch.key, group);

        this.#options.callbacks.onFailed(
          batch.fields,
          error instanceof Error ? error.message : "Perubahan gagal disimpan.",
        );
      }
    }
  }
}
