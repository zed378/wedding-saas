"use client";

import { useCallback, useEffect, useState } from "react";

import { Modal } from "@wi/ui";

import { useAuth } from "../lib/auth";
import {
  createPreviewLink,
  listPreviewLinks,
  revokePreviewLink,
  type CreatedPreviewLink,
  type PreviewLink,
} from "../lib/invitations";
import { useEditor } from "./EditorProvider";

/**
 * `P2-12` — "Share Preview", in the editor. `docs/PLAN/04` § F6, `docs/API/04` § Preview.
 *
 * The card's surface is the backend and the public page, and neither is usable without a
 * control somewhere that creates a link — so the smallest one that satisfies F6 lives here,
 * beside the publish button.
 *
 * ## The link is shown once, and says so
 *
 * The API returns the token only at creation and stores only its hash. A list of links
 * therefore cannot show a link again — there is nothing to show — and a couple who closes the
 * dialog without copying it has to make a new one. The dialog tells them before that happens,
 * rather than after.
 *
 * ## Revoking is immediate
 *
 * The public route refuses a revoked token on the next request and nothing caches it (the
 * API sends `Cache-Control: private, no-store`), so "Cabut" can promise what it does.
 */
export function SharePreview() {
  const { api } = useAuth();
  const invitationId = useEditor((state) => state.invitationId);

  const [open, setOpen] = useState(false);
  const [links, setLinks] = useState<readonly PreviewLink[]>([]);
  const [created, setCreated] = useState<CreatedPreviewLink | undefined>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    try {
      setLinks(await listPreviewLinks(api, invitationId));
    } catch {
      setMessage("Daftar tautan tidak bisa dimuat.");
    }
  }, [api, invitationId]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  const create = async () => {
    setBusy(true);
    setMessage("");
    try {
      const link = await createPreviewLink(api, invitationId);
      setCreated(link);
      await refresh();
    } catch {
      setMessage("Tautan pratinjau tidak bisa dibuat. Coba lagi.");
    } finally {
      setBusy(false);
    }
  };

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setMessage("Tautan disalin.");
    } catch {
      setMessage("Tidak bisa menyalin. Pilih tautannya dan salin manual.");
    }
  };

  const revoke = async (id: string) => {
    setMessage("");
    try {
      await revokePreviewLink(api, invitationId, id);
      if (created?.id === id) setCreated(undefined);
      await refresh();
      setMessage("Tautan dicabut dan tidak bisa dibuka lagi.");
    } catch {
      setMessage("Tautan tidak bisa dicabut. Coba lagi.");
    }
  };

  const date = (iso: string) =>
    new Date(iso).toLocaleString("id-ID", {
      dateStyle: "medium",
      timeStyle: "short",
    });

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
        className="focus-ring min-h-9 rounded-md border border-border px-3 text-sm font-medium text-text"
      >
        Bagikan pratinjau
      </button>

      <Modal
        open={open}
        onClose={() => {
          setOpen(false);
          setCreated(undefined);
          setMessage("");
        }}
        title="Bagikan pratinjau"
        description="Tautan sementara untuk memperlihatkan undangan sebelum diterbitkan. Berlaku 7 hari, bertanda PRATINJAU, dan tidak muncul di mesin pencari."
        size="form"
      >
        <div className="flex flex-col gap-4">
          {created === undefined ? (
            <button
              type="button"
              onClick={() => void create()}
              disabled={busy}
              className="focus-ring min-h-11 self-start rounded-md bg-primary-600 px-4 text-sm font-medium text-text-inverse disabled:opacity-60"
            >
              {busy ? "Membuat…" : "Buat tautan baru"}
            </button>
          ) : (
            <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-sunken p-3">
              <label
                htmlFor="created-preview-url"
                className="text-sm font-medium text-text"
              >
                Tautan pratinjau
              </label>
              <input
                id="created-preview-url"
                readOnly
                value={created.url}
                onFocus={(event) => {
                  event.currentTarget.select();
                }}
                className="focus-ring min-h-11 rounded-md border border-border bg-surface px-3 text-sm text-text"
              />
              <p className="text-sm text-text-muted">
                Salin sekarang. Tautan ini hanya ditampilkan sekali — setelah
                dialog ditutup, buat tautan baru bila perlu.
              </p>
              <button
                type="button"
                onClick={() => void copy(created.url)}
                className="focus-ring min-h-11 self-start rounded-md border border-border px-4 text-sm font-medium text-text"
              >
                Salin tautan
              </button>
            </div>
          )}

          <p
            role="status"
            aria-live="polite"
            className="min-h-5 text-sm text-text-muted"
          >
            {message}
          </p>

          <section aria-labelledby="active-preview-links">
            <h3
              id="active-preview-links"
              className="mb-2 text-sm font-semibold text-text"
            >
              Tautan aktif
            </h3>
            {links.length === 0 ? (
              <p className="text-sm text-text-muted">Belum ada tautan aktif.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {links.map((link) => (
                  <li
                    key={link.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3"
                  >
                    <div className="text-sm">
                      <p className="text-text">
                        Berlaku sampai {date(link.expires_at)}
                      </p>
                      <p className="text-text-muted">
                        {link.last_accessed_at === null
                          ? "Belum pernah dibuka"
                          : `Terakhir dibuka ${date(link.last_accessed_at)}`}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void revoke(link.id)}
                      className="focus-ring min-h-9 rounded-md border border-border px-3 text-sm font-medium text-danger-700"
                    >
                      Cabut
                      <span className="sr-only">
                        {" "}
                        tautan yang berlaku sampai {date(link.expires_at)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </Modal>
    </>
  );
}
