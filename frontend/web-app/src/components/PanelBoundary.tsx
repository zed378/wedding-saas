"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * P2-04 step 4 — the boundary around the editor's preview panel.
 *
 * `docs/FRONTEND/08` § Editor is unusually specific, and it is the most valuable sentence
 * in that document:
 *
 *   *"An error in the Live Preview rendering MUST NOT remove the Properties Panel/form
 *   data — the user must still be able to edit & data must still be saved even if the
 *   visual preview temporarily fails to render."*
 *
 * The failure it describes is expensive in a way the public page's is not. On the public
 * page a broken section costs a guest some content. Here it costs the couple **work they
 * have already done**: without a boundary, one bad render unmounts the whole editor,
 * taking the properties panel, the dirty-field set and every keystroke not yet saved with
 * it. `P1-22` went to some trouble to make sure a failed save never loses a keystroke;
 * an unhandled render error would lose the same data by a different route.
 *
 * ## Why this boundary shows a message and the public one does not
 *
 * `SectionBoundary` renders nothing by default — a guest is not served by being told the
 * gallery is broken. Here the person looking at the screen **is** the person who needs to
 * know, and they need to know two things: that the preview failed, and that their edits
 * are safe. Silence would read as "the invitation is empty", which is the more alarming
 * of the two wrong conclusions.
 *
 * ## Why a class
 *
 * React has no hook for `componentDidCatch`. Same as `SectionBoundary`, same reason.
 */

interface Props {
  readonly children: ReactNode;
  readonly onError?: ((error: Error, info: ErrorInfo) => void) | undefined;
}

interface State {
  readonly failed: boolean;
}

export class PanelBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;

    return (
      <div
        // `status` rather than `alert`: the editor is not in an emergency and an
        // assertive announcement would interrupt whatever the user is typing, which is
        // the thing this boundary exists to protect.
        role="status"
        className="rounded-md border border-border bg-surface-sunken p-4 text-sm text-text-muted"
      >
        <p className="font-medium text-text">Pratinjau gagal ditampilkan.</p>
        <p>
          Perubahan Anda tetap tersimpan. Lanjutkan mengedit di panel sebelah,
          lalu muat ulang halaman untuk mencoba pratinjau lagi.
        </p>
      </div>
    );
  }
}
