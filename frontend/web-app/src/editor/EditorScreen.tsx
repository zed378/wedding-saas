"use client";

import { useEffect, useState } from "react";

import { useAuth } from "../lib/auth";
import { toFriendlyError } from "../lib/error-messages";
import { EditorProvider } from "./EditorProvider";
import { EditorShell } from "./EditorShell";
import { PropertiesPanel } from "./PropertiesPanel";
import type { TemplateDefinition } from "./store";

/**
 * P1-22 — loading one invitation into an editor session. `docs/FRONTEND/06` § Editor Modules.
 *
 * Separate from `EditorProvider` because they fail differently: this can 404, and the
 * provider cannot exist until the data is there. Folding the fetch into the provider would
 * mean a store initialised with empty data and then overwritten — which is a store that
 * briefly disagrees with the server, and the panels would render the disagreement.
 */

interface InvitationDetail {
  readonly id: string;
  readonly internal_name: string | null;
  readonly updated_at: string;
  readonly template_version_id: string;
  readonly settings?: { readonly enabled_sections?: readonly string[] };
  readonly [key: string]: unknown;
}

type LoadState =
  | { readonly kind: "loading" }
  | {
      readonly kind: "loaded";
      readonly detail: InvitationDetail;
      readonly definition: TemplateDefinition | undefined;
    }
  | { readonly kind: "failed"; readonly message: string };

export function EditorScreen({
  invitationId,
}: {
  readonly invitationId: string;
}) {
  const { api } = useAuth();
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      try {
        const result = await api.request<InvitationDetail>(
          `/invitations/${invitationId}`,
          { signal: controller.signal },
        );

        if (controller.signal.aborted) return;

        setState({
          kind: "loaded",
          detail: result.data,
          // The template's section definitions come from `P2-01`'s catalogue API, which does
          // not exist yet. Undefined rather than invented: a fabricated section list would
          // render a plausible editor for a template nobody has seen.
          definition: undefined,
        });
      } catch (error) {
        if (!controller.signal.aborted) {
          setState({ kind: "failed", message: toFriendlyError(error).message });
        }
      }
    })();

    return () => {
      controller.abort();
    };
  }, [api, invitationId]);

  if (state.kind === "loading") {
    return (
      <main id="main" className="mx-auto w-full max-w-5xl px-4 py-10">
        <p role="status" aria-live="polite" className="text-sm text-text-muted">
          Memuat undangan…
        </p>
      </main>
    );
  }

  if (state.kind === "failed") {
    return (
      <main id="main" className="mx-auto w-full max-w-md px-4 py-10">
        <h1 className="text-xl font-semibold text-text">
          Undangan tidak ditemukan
        </h1>
        {/*
         * One message for "not yours" and for "does not exist", because the API answers both
         * with a 404 on purpose (ADR-018) and a friendlier frontend would undo it.
         */}
        <p role="alert" className="mt-2 text-sm text-text-muted">
          {state.message}
        </p>
        <a
          className="focus-ring mt-6 inline-flex items-center justify-center rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-text-inverse hover:bg-primary-700"
          href="/dashboard"
        >
          Kembali ke dasbor
        </a>
      </main>
    );
  }

  const { detail, definition } = state;

  return (
    <EditorProvider
      invitationId={invitationId}
      data={detail as unknown as Record<string, unknown>}
      templateDefinition={definition}
      knownUpdatedAt={detail.updated_at}
    >
      <EditorShell
        title={detail.internal_name ?? "Undangan tanpa nama"}
        dashboardHref="/dashboard"
        preview={<PreviewPlaceholder />}
        properties={<PropertiesPanel />}
      />
    </EditorProvider>
  );
}

/**
 * `P2-05` builds the live preview, and `P2-02` the renderer it needs.
 *
 * A placeholder that says so, rather than an empty div: an editor with a blank centre column
 * reads as broken, and the person most likely to see this is whoever picks up the next card.
 */
function PreviewPlaceholder() {
  return (
    <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-text-muted">
      Pratinjau langsung akan tersedia setelah komponen template siap.
    </div>
  );
}
