"use client";

import { useState } from "react";
import { Button, Modal } from "@wi/ui";

import { useAuth } from "../lib/auth";
import { useEditor } from "./EditorProvider";
import { unpublishInvitation } from "../lib/invitations";

/**
 * P3-15 — unpublish action in the editor header. `docs/UI-UX/13`.
 *
 * Shown only when the invitation is `published` (`invitationStatus === 'published'` prop
 * on `EditorShell`). A confirmation modal explains the consequence before anything happens.
 *
 * ADR-081: unpublish → `paid` if there was a paid order, → `draft` if trial only.
 */

type State =
  | { readonly kind: "idle" }
  | { readonly kind: "confirming" }
  | { readonly kind: "unpublishing" }
  | { readonly kind: "error"; readonly message: string };

export interface UnpublishActionProps {
  readonly onUnpublished: () => void;
}

export function UnpublishAction({ onUnpublished }: UnpublishActionProps) {
  const invitationId = useEditor((state) => state.invitationId);
  const { api } = useAuth();
  const [state, setState] = useState<State>({ kind: "idle" });

  async function handleConfirm() {
    setState({ kind: "unpublishing" });

    try {
      await unpublishInvitation(api, invitationId);
      setState({ kind: "idle" });
      onUnpublished();
    } catch {
      setState({
        kind: "error",
        message: "Gagal membatalkan publikasi. Silakan coba lagi.",
      });
    }
  }

  return (
    <>
      <button
        type="button"
        className="focus-ring rounded-md border border-border px-3 py-1.5 text-sm font-medium text-text hover:bg-surface-sunken"
        onClick={() => {
          setState({ kind: "confirming" });
        }}
      >
        Batalkan publikasi
      </button>

      <Modal
        open={state.kind === "confirming" || state.kind === "unpublishing"}
        onClose={() => {
          if (state.kind !== "unpublishing") {
            setState({ kind: "idle" });
          }
        }}
        title="Batalkan publikasi undangan?"
        description="Tautan publik akan berhenti bekerja. Tamu yang sudah punya link tidak akan bisa mengaksesnya."
        size="confirmation"
        footer={
          <div className="flex gap-2">
            <Button
              variant="secondary"
              disabled={state.kind === "unpublishing"}
              onClick={() => {
                setState({ kind: "idle" });
              }}
            >
              Batal
            </Button>
            <Button
              variant="danger"
              loading={state.kind === "unpublishing"}
              loadingLabel="Membatalkan publikasi…"
              onClick={() => {
                void handleConfirm();
              }}
            >
              Batalkan Publikasi
            </Button>
          </div>
        }
      />

      <Modal
        open={state.kind === "error"}
        onClose={() => {
          setState({ kind: "idle" });
        }}
        title="Terjadi kesalahan"
        size="confirmation"
        footer={
          <Button
            onClick={() => {
              setState({ kind: "idle" });
            }}
          >
            Tutup
          </Button>
        }
      >
        {state.kind === "error" && (
          <p className="text-sm text-text">{state.message}</p>
        )}
      </Modal>
    </>
  );
}
