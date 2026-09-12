/**
 * P1-24 steps 1-3 — the upload queue. `docs/FRONTEND/05` § Upload Flow.
 *
 * ## What it guarantees
 *
 * **Ten files selected at once all arrive.** Card DoD 1. The queue holds every file, runs at
 * most three at a time, and a failure removes one file from the running set without touching
 * the others — so a rejected photo does not take the batch down with it.
 *
 * **Concurrency is capped at three.** `docs/FRONTEND/05` asks for it explicitly, and the
 * reason is the user's connection rather than the server's: ten simultaneous multipart
 * uploads on a phone means ten that are all slow, no progress anywhere for a minute, and a
 * person who concludes it is broken.
 *
 * **A failure is per file and retryable.** `docs/FRONTEND/05` step 6: "let the user retry
 * without losing context (other fields aren't reset)". A retry re-enters the same item rather
 * than creating a new one, so its place in the list and its local preview survive.
 *
 * ## Why it is a plain class again
 *
 * Same reason as the autosave manager: a queue, a running set and a poll loop are awkward in
 * a hook's closure and trivial in an object — and the tests that matter (ten files, one
 * failing, one retried) are far easier to write against something that takes its transport as
 * an argument.
 */

export type UploadState =
  "queued" | "uploading" | "processing" | "ready" | "failed";

export interface UploadItem {
  /** Stable for the life of the item, including across a retry. */
  readonly id: string;
  readonly fileName: string;
  readonly sizeBytes: number;
  readonly state: UploadState;
  /** 0-100 while uploading. */
  readonly progress: number;
  /** `URL.createObjectURL`, shown until the CDN url arrives. */
  readonly previewUrl: string | undefined;
  /** Set once the server has a row for it. */
  readonly mediaId: string | undefined;
  readonly url: string | undefined;
  /** Indonesian, never a code. `docs/FRONTEND/05` step 6. */
  readonly error: string | undefined;
}

export interface UploadTransport {
  /**
   * `POST /invitations/:id/media`. Reports progress and resolves with the media id.
   *
   * Throwing means the upload failed. The message is shown to the user, so it must already
   * be in Indonesian — `toFriendlyError` is what produces it at the call site.
   */
  readonly upload: (
    file: File,
    onProgress: (percent: number) => void,
    signal: AbortSignal,
  ) => Promise<{ mediaId: string }>;

  /** `GET /media/:id`, for the poll between `processing` and `ready`. */
  readonly poll: (
    mediaId: string,
  ) => Promise<{ status: string; url?: string | undefined }>;
}

export interface UploadQueueOptions {
  readonly transport: UploadTransport;
  readonly onChange: (items: readonly UploadItem[]) => void;
  /** `docs/FRONTEND/05`: "max 3 concurrent". */
  readonly concurrency?: number;
  /** How often to ask whether processing finished. */
  readonly pollIntervalMs?: number;
  /** Give up polling after this long and report it, rather than spinning forever. */
  readonly pollTimeoutMs?: number;
  readonly createObjectUrl?: (file: File) => string;
  readonly revokeObjectUrl?: (url: string) => void;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_CONCURRENCY = 3;
const DEFAULT_POLL_MS = 1_500;
/**
 * Two minutes.
 *
 * `P1-18`'s worker scans, decodes and writes three variants; a large photo on a busy host is
 * seconds, not minutes. Two minutes is generous enough that a slow day does not produce a
 * false failure, and short enough that a genuinely stuck job does not leave a spinner on
 * somebody's screen for the evening.
 */
const DEFAULT_POLL_TIMEOUT_MS = 120_000;

let counter = 0;

export class UploadQueue {
  readonly #options: Required<
    Omit<UploadQueueOptions, "transport" | "onChange">
  > & {
    transport: UploadTransport;
    onChange: (items: readonly UploadItem[]) => void;
  };

  #items: UploadItem[] = [];
  #running = 0;
  readonly #controllers = new Map<string, AbortController>();

  constructor(options: UploadQueueOptions) {
    this.#options = {
      transport: options.transport,
      onChange: options.onChange,
      concurrency: options.concurrency ?? DEFAULT_CONCURRENCY,
      pollIntervalMs: options.pollIntervalMs ?? DEFAULT_POLL_MS,
      pollTimeoutMs: options.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS,
      createObjectUrl:
        options.createObjectUrl ?? ((file) => URL.createObjectURL(file)),
      revokeObjectUrl:
        options.revokeObjectUrl ??
        ((url) => {
          URL.revokeObjectURL(url);
        }),
      now: options.now ?? (() => Date.now()),
      sleep:
        options.sleep ??
        ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    };
  }

  get items(): readonly UploadItem[] {
    return this.#items;
  }

  /**
   * Add files. Returns the items so a caller can render them immediately.
   *
   * The local preview is created here, before anything is sent — `docs/FRONTEND/05` step 2.
   * A grid that stays empty until the server answers feels broken on a slow connection, and
   * the user has already seen the photo they picked.
   */
  add(files: readonly File[]): readonly UploadItem[] {
    const added = files.map((file) => {
      counter += 1;
      const item: UploadItem = {
        id: `upload-${String(counter)}`,
        fileName: file.name,
        sizeBytes: file.size,
        state: "queued",
        progress: 0,
        previewUrl: this.#options.createObjectUrl(file),
        mediaId: undefined,
        url: undefined,
        error: undefined,
      };
      this.#files.set(item.id, file);
      return item;
    });

    this.#items = [...this.#items, ...added];
    this.#emit();
    void this.#pump();
    return added;
  }

  /** Re-enter a failed item. Its place in the list and its preview survive. */
  retry(id: string): void {
    const item = this.#items.find((i) => i.id === id);
    if (item === undefined || item.state !== "failed") return;
    if (!this.#files.has(id)) return;

    this.#update(id, { state: "queued", progress: 0, error: undefined });
    void this.#pump();
  }

  /** Stop everything. Called on unmount, so an abandoned page does not keep uploading. */
  cancelAll(): void {
    for (const controller of this.#controllers.values()) controller.abort();
    this.#controllers.clear();
    for (const item of this.#items) {
      if (item.previewUrl !== undefined) {
        this.#options.revokeObjectUrl(item.previewUrl);
      }
    }
  }

  readonly #files = new Map<string, File>();

  #emit(): void {
    this.#options.onChange(this.#items);
  }

  #update(id: string, patch: Partial<UploadItem>): void {
    this.#items = this.#items.map((item) =>
      item.id === id ? { ...item, ...patch } : item,
    );
    this.#emit();
  }

  /** Start as many queued items as the concurrency cap allows. */
  async #pump(): Promise<void> {
    while (this.#running < this.#options.concurrency) {
      const next = this.#items.find((i) => i.state === "queued");
      if (next === undefined) return;

      this.#running += 1;
      this.#update(next.id, { state: "uploading" });
      void this.#run(next.id).finally(() => {
        this.#running -= 1;
        void this.#pump();
      });
    }
  }

  async #run(id: string): Promise<void> {
    const file = this.#files.get(id);
    if (file === undefined) return;

    const controller = new AbortController();
    this.#controllers.set(id, controller);

    try {
      const { mediaId } = await this.#options.transport.upload(
        file,
        (percent) => {
          this.#update(id, { progress: Math.min(100, Math.max(0, percent)) });
        },
        controller.signal,
      );

      this.#update(id, { mediaId, state: "processing", progress: 100 });
      await this.#awaitReady(id, mediaId);
    } catch (error) {
      if (controller.signal.aborted) return;
      this.#update(id, {
        state: "failed",
        error:
          error instanceof Error
            ? error.message
            : "Foto gagal diunggah. Coba lagi.",
      });
    } finally {
      this.#controllers.delete(id);
    }
  }

  /**
   * Poll until the worker finishes. `docs/FRONTEND/05` step 4.
   *
   * A `failed` status is the worker's verdict — infected, undecodable, too large in pixels —
   * and it is permanent, so it becomes a failed item rather than another poll. The timeout is
   * the other terminal case: `P1-18`'s job can be lost if Redis blinked, and a spinner that
   * never resolves is worse than an honest failure with a retry.
   */
  async #awaitReady(id: string, mediaId: string): Promise<void> {
    const deadline = this.#options.now() + this.#options.pollTimeoutMs;

    for (;;) {
      const result = await this.#options.transport.poll(mediaId);

      if (result.status === "ready") {
        this.#update(id, { state: "ready", url: result.url });
        return;
      }

      if (result.status === "failed") {
        this.#update(id, {
          state: "failed",
          error: "Foto tidak dapat diproses. Coba unggah foto lain.",
        });
        return;
      }

      if (this.#options.now() >= deadline) {
        this.#update(id, {
          state: "failed",
          error: "Pemrosesan foto terlalu lama. Coba lagi.",
        });
        return;
      }

      await this.#options.sleep(this.#options.pollIntervalMs);
    }
  }
}

/**
 * The client-side pre-check. `docs/FRONTEND/05` step 1.
 *
 * **Fast feedback, not a control.** `docs/SECURITY/06` is enforced by the server and `P1-17`
 * built all five layers there; this exists so a user who picked a PDF learns it before
 * spending thirty seconds of a phone connection on it. It is deliberately weaker than the
 * server: no magic bytes, because reading them would mean reading the file.
 */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];

export function preCheck(file: File): string | undefined {
  const dot = file.name.lastIndexOf(".");
  const extension = dot > 0 ? file.name.slice(dot).toLowerCase() : "";

  if (!ALLOWED_EXTENSIONS.includes(extension)) {
    return "Gunakan file gambar JPG, PNG, atau WebP.";
  }
  if (file.size > MAX_FILE_BYTES) {
    return "Ukuran file melebihi 10 MB.";
  }
  return undefined;
}
