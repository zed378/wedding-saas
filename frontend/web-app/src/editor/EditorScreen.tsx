"use client";

import { useEffect, useState } from "react";

import { useAuth } from "../lib/auth";
import { toFriendlyError } from "../lib/error-messages";
import { EditorProvider } from "./EditorProvider";
import { EditorShell } from "./EditorShell";
import { LivePreview } from "./LivePreview";
import { PropertiesPanel } from "./PropertiesPanel";
import type { TemplateDefinition } from "./store";
import { toEditorDocument, type MediaUrls } from "./transport";

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
  /** `PG-19`, ADR-060: the slug and version that address the catalogue. */
  readonly template: {
    readonly slug: string;
    readonly name: string;
    readonly version: string;
  };
  readonly settings?: { readonly enabled_sections?: readonly string[] };
  readonly [key: string]: unknown;
}

type LoadState =
  | { readonly kind: "loading" }
  | {
      readonly kind: "loaded";
      readonly detail: InvitationDetail;
      /** `P2-15`: the detail in `docs/PLAN/08`'s canonical shape, which the editor works in. */
      readonly document: Record<string, unknown>;
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

        /**
         * The definition of the version this invitation is LOCKED to. `PG-19`, ADR-060.
         *
         * Addressed by slug and version rather than by `template_version_id`, because
         * that is what `docs/API/03` offers — and deliberately not `GET /templates/:slug`,
         * which serves the newest published version. BR-3.1 keeps an invitation on the
         * version it locked until the user explicitly upgrades, so the newest is the one
         * answer that is certain to be wrong here.
         *
         * A failure to load it is not a failure to load the invitation: the editor still
         * works, the properties panel still saves, and only the preview and the section
         * list are unavailable. So it is fetched separately and its error is swallowed
         * rather than escalated — `definition: undefined` is a state the editor already
         * handles from `P1-22`.
         */
        const definition = await api
          .request<TemplateDetailResponse>(
            `/templates/${encodeURIComponent(result.data.template.slug)}` +
              `/versions/${encodeURIComponent(result.data.template.version)}`,
            { signal: controller.signal },
          )
          .then((response) => toDefinition(response.data))
          .catch(() => undefined);

        if (controller.signal.aborted) return;

        /*
         * `P2-15`. Photo URLs for the preview. The detail carries media ids only; the gallery
         * list carries the CDN addresses. Optional in the same way as the definition: without
         * it the editor works and the preview draws no photos.
         */
        const media: MediaUrls = await api
          .request<Record<string, unknown>[]>(
            `/invitations/${invitationId}/gallery`,
            {
              signal: controller.signal,
            },
          )
          .then(
            (response) =>
              new Map(
                response.data
                  .filter((row) => typeof row["media_id"] === "string")
                  .map((row) => [
                    row["media_id"] as string,
                    {
                      url: row["url"] as string | undefined,
                      medium_url: row["medium_url"] as string | undefined,
                      thumbnail_url: row["thumbnail_url"] as string | undefined,
                    },
                  ]),
              ),
          )
          .catch(() => new Map());

        if (controller.signal.aborted) return;

        setState({
          kind: "loaded",
          detail: result.data,
          document: toEditorDocument(result.data, media),
          definition: withInvitationSections(definition, result.data),
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

  const { detail, document, definition } = state;

  return (
    <EditorProvider
      invitationId={invitationId}
      data={document}
      templateDefinition={definition}
      knownUpdatedAt={detail.updated_at}
    >
      <EditorShell
        title={detail.internal_name ?? "Undangan tanpa nama"}
        dashboardHref="/dashboard"
        preview={<LivePreview />}
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

/**
 * `P2-15` — the sections this invitation shows, not the ones its template starts with.
 *
 * `toDefinition` derives `enabledSections` from the template's `enabled_by_default`, and the
 * section list drew its toggles from that. So every visit showed the template's defaults
 * instead of the couple's choices — a section they had turned on appeared off — and toggling
 * one sent the defaults plus that one change, silently undoing every other choice they had
 * made. The invitation's stored selection wins whenever it has one.
 */
export function withInvitationSections(
  definition: TemplateDefinition | undefined,
  detail: {
    readonly settings?: { readonly enabled_sections?: readonly string[] };
  },
): TemplateDefinition | undefined {
  const stored = detail.settings?.enabled_sections;
  if (definition === undefined || !Array.isArray(stored)) return definition;
  return { ...definition, enabledSections: [...stored] };
}

/** `docs/API/03`'s detail shape, narrowed to what the editor reads. */
interface TemplateDetailResponse {
  readonly current_version: {
    readonly sections: unknown;
    readonly theme: unknown;
    readonly customizable_theme_keys: readonly string[];
  };
}

/**
 * The catalogue's version payload as the editor store wants it.
 *
 * `sections` arrives as `unknown` because it is a JSONB column the API does not narrow.
 * `P0-20` validated it before it was ever stored, so this trusts the shape rather than
 * re-validating -- and returns `undefined` when it is not an array, because a definition
 * the editor cannot iterate is no better than none.
 */
function toDefinition(
  payload: TemplateDetailResponse,
): TemplateDefinition | undefined {
  const version = payload.current_version;
  if (!Array.isArray(version.sections)) return undefined;

  return {
    sections: version.sections as TemplateDefinition["sections"],
    // The store derives this from the sections' own `enabled_by_default`; the
    // invitation's actual settings reach the renderer as a separate prop, because
    // `docs/PLAN/08` keeps them in a different table.
    enabledSections: (version.sections as { section_key: string }[])
      .filter(
        (section) =>
          (section as { enabled_by_default?: boolean }).enabled_by_default !==
          false,
      )
      .map((section) => section.section_key),
    theme: (version.theme ?? {}) as Record<string, unknown>,
    customizable_theme_keys: version.customizable_theme_keys,
  };
}
