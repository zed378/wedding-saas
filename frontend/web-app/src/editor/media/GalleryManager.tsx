"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@wi/ui";
import { MEDIA_PURPOSES } from "@wi/schema";

import { useAuth } from "../../lib/auth";
import { toFriendlyError } from "../../lib/error-messages";
import { FormError, FormStatus } from "../../components/AuthShell";
import { moveItem, ReorderSender } from "./reorder";
import { preCheck, UploadQueue, type UploadItem } from "./upload-queue";

/**
 * P1-24 — the gallery manager. `docs/FRONTEND/05` § Gallery Manager Component.
 *
 * ## Two lists, deliberately
 *
 * **Photos already attached** come from the server and can be reordered, captioned, made the
 * cover or removed. **Uploads in flight** are local and have no gallery entry yet. Merging
 * them into one list would mean a half-uploaded file with a drag handle and a cover button
 * that cannot work, which is a worse lie than two headings.
 *
 * ## Keyboard first
 *
 * Move up and move down are buttons, and the drag is the convenience laid over them. The card
 * DoD says "fully operable by keyboard" and `docs/UI-UX/17` asks for it by name for this
 * interaction — so the mechanism that works for everybody is the one that exists, and the
 * pointer version calls the same function.
 */

/** `docs/API/05`'s purpose for a gallery upload, from the shared vocabulary. */
const GALLERY_PURPOSE = MEDIA_PURPOSES[1];

export interface GalleryPhoto {
  readonly id: string;
  readonly media_id: string;
  readonly caption: string | null;
  readonly display_order: number;
  readonly is_cover: boolean;
  readonly status: string;
  readonly url?: string;
  readonly thumbnail_url?: string;
}

export interface GalleryManagerProps {
  readonly invitationId: string;
}

export function GalleryManager({ invitationId }: GalleryManagerProps) {
  const { api } = useAuth();
  const [photos, setPhotos] = useState<readonly GalleryPhoto[]>([]);
  const [uploads, setUploads] = useState<readonly UploadItem[]>([]);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [rejected, setRejected] = useState<readonly string[]>([]);

  const reorderer = useMemo(
    () =>
      new ReorderSender(
        async (orderedIds) => {
          await api.request(`/invitations/${invitationId}/gallery/reorder`, {
            method: "POST",
            body: { ordered_photo_ids: [...orderedIds] },
          });
        },
        (message) => {
          setProblem(message);
        },
      ),
    [api, invitationId],
  );

  const queue = useMemo(
    () =>
      new UploadQueue({
        transport: {
          upload: async (file, onProgress, signal) => {
            const form = new FormData();
            form.append("file", file);
            // Imported, not typed: `gallery` is also a section key, and
            // `scripts/check-no-hardcoded-fields.mjs` cannot tell a media purpose from one
            // in a string literal — correctly, because they mean different things.
            form.append("purpose", GALLERY_PURPOSE);

            // Progress is reported in two steps rather than continuously: `fetch` has no
            // upload-progress event, and swapping in `XMLHttpRequest` for a real one is
            // `P2`'s problem if anybody asks. Saying "sent, now waiting" is honest; a fake
            // animated bar would not be.
            onProgress(10);
            const result = await api.request<{ id: string }>(
              `/invitations/${invitationId}/media`,
              { method: "POST", body: form, signal },
            );
            onProgress(100);
            return { mediaId: result.data.id };
          },
          poll: async (mediaId) => {
            const result = await api.request<{
              status: string;
              url?: string;
            }>(`/media/${mediaId}`);
            return result.data;
          },
        },
        onChange: (items) => {
          setUploads([...items]);
        },
      }),
    [api, invitationId],
  );

  // Attach each upload as it becomes ready. Done here rather than inside the queue because
  // attaching is a gallery concern -- the queue's job ends when the file is `ready`.
  const attached = useRef(new Set<string>());
  useEffect(() => {
    for (const item of uploads) {
      if (item.state !== "ready" || item.mediaId === undefined) continue;
      if (attached.current.has(item.id)) continue;
      attached.current.add(item.id);

      void (async () => {
        try {
          const result = await api.request<GalleryPhoto>(
            `/invitations/${invitationId}/gallery`,
            { method: "POST", body: { media_id: item.mediaId } },
          );
          setPhotos((current) => [...current, result.data]);
        } catch (error) {
          setProblem(toFriendlyError(error).message);
        }
      })();
    }
  }, [uploads, api, invitationId]);

  const load = useCallback(async () => {
    try {
      const result = await api.request<GalleryPhoto[]>(
        `/invitations/${invitationId}/gallery`,
      );
      setPhotos(result.data);
    } catch (error) {
      setProblem(toFriendlyError(error).message);
    }
  }, [api, invitationId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(
    () => () => {
      queue.cancelAll();
      void reorderer.flush();
    },
    [queue, reorderer],
  );

  const onFiles = (files: readonly File[]) => {
    setRejected([]);
    const accepted: File[] = [];
    const refused: string[] = [];

    for (const file of files) {
      const reason = preCheck(file);
      // `docs/FRONTEND/05` step 6 and the card's step 7: a specific message naming the file,
      // never a code, and the rest of the batch still goes.
      if (reason === undefined) accepted.push(file);
      else refused.push(`${file.name}: ${reason}`);
    }

    setRejected(refused);
    if (accepted.length > 0) queue.add(accepted);
  };

  const move = (index: number, delta: number) => {
    const next = moveItem(photos, index, index + delta);
    setPhotos(next);
    reorderer.queue(next.map((p) => p.id));
  };

  const setCover = async (photo: GalleryPhoto) => {
    try {
      await api.request(`/invitations/${invitationId}/gallery/${photo.id}`, {
        method: "PATCH",
        body: { is_cover: true },
      });
      // Exactly one, mirroring what the server just did (`P1-19`). Reloading would also
      // work and would cost a round trip on every cover change.
      setPhotos((current) =>
        current.map((p) => ({ ...p, is_cover: p.id === photo.id })),
      );
    } catch (error) {
      setProblem(toFriendlyError(error).message);
    }
  };

  const remove = async (photo: GalleryPhoto) => {
    const previous = photos;
    setPhotos((current) => current.filter((p) => p.id !== photo.id));

    try {
      await api.request(`/invitations/${invitationId}/gallery/${photo.id}`, {
        method: "DELETE",
      });
      // `docs/FRONTEND/05` asks for a brief undo. The server soft-deletes the media
      // (`P1-19`), so the file survives — but re-attaching it needs an endpoint that accepts
      // a soft-deleted media id, which `P1-19` deliberately refuses. Said plainly rather
      // than offered and broken.
      setNotice("Foto dihapus dari galeri.");
    } catch (error) {
      // Put it back. A delete that failed must not look like one that worked.
      setPhotos(previous);
      setProblem(toFriendlyError(error).message);
    }
  };

  return (
    <section aria-labelledby="gallery-heading">
      <h3 id="gallery-heading" className="mb-3 text-sm font-semibold text-text">
        Galeri foto
      </h3>

      <FormError message={problem} />
      <FormStatus message={notice} />

      <FilePicker onFiles={onFiles} />

      {rejected.length > 0 && (
        <ul role="alert" className="mt-3 space-y-1 text-sm text-danger-700">
          {rejected.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}

      {uploads.length > 0 && (
        <ul className="mt-4 space-y-2">
          {uploads
            .filter((item) => item.state !== "ready")
            .map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm"
              >
                <span className="min-w-0 flex-1 truncate">{item.fileName}</span>
                <span className="text-text-muted">{stateLabel(item)}</span>
                {item.state === "failed" && (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      queue.retry(item.id);
                    }}
                  >
                    Coba lagi
                  </Button>
                )}
              </li>
            ))}
        </ul>
      )}

      <ul className="mt-4 space-y-2">
        {photos.map((photo, index) => (
          <li
            key={photo.id}
            className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2"
          >
            {photo.thumbnail_url !== undefined ? (
              // eslint-disable-next-line @next/next/no-img-element -- runtime CDN host
              <img
                src={photo.thumbnail_url}
                alt=""
                className="h-12 w-12 rounded object-cover"
              />
            ) : (
              <div
                aria-hidden="true"
                className="h-12 w-12 rounded bg-surface-sunken"
              />
            )}

            <span className="min-w-0 flex-1 truncate text-sm">
              {photo.caption ?? `Foto ${String(index + 1)}`}
            </span>

            {photo.is_cover && (
              <span className="rounded bg-success-50 px-2 py-0.5 text-xs text-success-700">
                Sampul
              </span>
            )}

            {/*
             * The keyboard path, and the primary one. `docs/UI-UX/17` asks for this by name:
             * drag-and-drop is unusable with a keyboard and unreliable with a screen reader,
             * so the mechanism that works for everybody is the one that exists.
             *
             * The position is in the accessible name because "move up" alone, eleven times
             * down a list, tells a screen-reader user nothing about where they are.
             */}
            <Button
              type="button"
              size="sm"
              variant="secondary"
              aria-label={`Naikkan foto ${String(index + 1)}`}
              disabled={index === 0}
              onClick={() => {
                move(index, -1);
              }}
            >
              ↑
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              aria-label={`Turunkan foto ${String(index + 1)}`}
              disabled={index === photos.length - 1}
              onClick={() => {
                move(index, 1);
              }}
            >
              ↓
            </Button>

            <Button
              type="button"
              size="sm"
              variant="secondary"
              aria-label={`Jadikan foto ${String(index + 1)} sebagai sampul`}
              onClick={() => {
                void setCover(photo);
              }}
            >
              Sampul
            </Button>

            <Button
              type="button"
              size="sm"
              variant="secondary"
              aria-label={`Hapus foto ${String(index + 1)}`}
              onClick={() => {
                void remove(photo);
              }}
            >
              Hapus
            </Button>
          </li>
        ))}
      </ul>

      {photos.length === 0 && uploads.length === 0 && (
        <p className="mt-4 text-sm text-text-muted">
          Belum ada foto. Pilih beberapa foto untuk memulai.
        </p>
      )}
    </section>
  );
}

function stateLabel(item: UploadItem): string {
  switch (item.state) {
    case "queued":
      return "Menunggu";
    case "uploading":
      return `Mengunggah ${String(item.progress)}%`;
    case "processing":
      return "Memproses";
    case "failed":
      return item.error ?? "Gagal";
    case "ready":
      return "Selesai";
  }
}

/**
 * The file input, labelled and keyboard-reachable.
 *
 * A styled `<label>` wrapping a real `<input type="file">` rather than a button that calls
 * `.click()`: the real input is what a keyboard and a screen reader understand, and the
 * scripted version loses the accessible name every time somebody restyles it.
 */
function FilePicker({
  onFiles,
}: {
  readonly onFiles: (files: readonly File[]) => void;
}) {
  return (
    <div>
      <label
        className="focus-within:ring-2 inline-flex min-h-11 cursor-pointer items-center rounded-md border border-border px-4 text-sm font-medium text-text hover:bg-surface-sunken"
        htmlFor="gallery-files"
      >
        Pilih foto
      </label>
      <input
        id="gallery-files"
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          if (files.length > 0) onFiles(files);
          // Reset, so choosing the same file twice in a row fires a change event the second
          // time. Without this a failed upload cannot be retried by re-picking the file.
          e.target.value = "";
        }}
      />
    </div>
  );
}
