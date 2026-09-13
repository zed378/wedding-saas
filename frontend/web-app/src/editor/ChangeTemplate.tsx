"use client";

import { useEffect, useState } from "react";

import { sectionLabel } from "@wi/schema";
import { Modal } from "@wi/ui";

import { useAuth } from "../lib/auth";
import { toFriendlyError } from "../lib/error-messages";
import {
  changeTemplate,
  getTemplateShape,
  listTemplateChoices,
  type TemplateChoice,
} from "../lib/invitations";
import { useEditor, useEditorContext } from "./EditorProvider";
import {
  previewTemplateChange,
  type TemplateChangePreview,
} from "./template-change";

/**
 * `P2-14` — "Change Template", in the editor. `docs/UI-UX/12` § Changing Templates from the
 * Editor, `docs/UI-UX/05` § Change Template Flow.
 *
 * `P1-15` built `POST /invitations/:id/change-template` and no card built the screen, so a
 * user had no way to reach the one guarantee the template system is designed around — that
 * a different design never costs them their words. `P2-14`'s template-switch E2E cannot run
 * without it, which is how the gap surfaced.
 *
 * ## The flow, as the document draws it
 *
 * Catalogue list → confirmation naming what will stop being displayed → applying → the editor
 * reloads on the new template with every field still there. The confirmation says plainly
 * that hidden data is kept and comes back on switching again, because "X fields may not be
 * displayed" reads as "X fields will be deleted" to anyone who has lost work before.
 *
 * ## Pending edits go first
 *
 * The autosave queue is flushed before the change is requested. The editor reloads after the
 * change, and a debounce still waiting at that moment would be discarded with the old page.
 */

type Step =
  | { readonly kind: "choose" }
  | {
      readonly kind: "confirm";
      readonly template: TemplateChoice;
      readonly preview: TemplateChangePreview;
    }
  | { readonly kind: "applying"; readonly template: TemplateChoice };

export interface ChangeTemplateProps {
  /** Called after the server has changed the template, to reload the editor on it. */
  readonly onChanged?: () => void;
}

export function ChangeTemplate({ onChanged }: ChangeTemplateProps) {
  const { api } = useAuth();
  const { autosave } = useEditorContext();
  const invitationId = useEditor((state) => state.invitationId);
  const data = useEditor((state) => state.data);

  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState<readonly TemplateChoice[]>([]);
  const [step, setStep] = useState<Step>({ kind: "choose" });
  const [message, setMessage] = useState("");

  const currentSlug = (data["template"] as { slug?: unknown } | undefined)
    ?.slug;
  const settings = (data["settings"] ?? {}) as {
    enabled_sections?: unknown;
    theme_override?: unknown;
  };
  const enabledSections = Array.isArray(settings.enabled_sections)
    ? (settings.enabled_sections as string[])
    : [];

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    listTemplateChoices(api)
      .then((choices) => {
        if (!cancelled) setTemplates(choices);
      })
      .catch(() => {
        if (!cancelled) setMessage("Daftar template tidak bisa dimuat.");
      });
    return () => {
      cancelled = true;
    };
  }, [api, open]);

  const close = () => {
    setOpen(false);
    setStep({ kind: "choose" });
    setMessage("");
  };

  const choose = async (template: TemplateChoice) => {
    setMessage("");
    try {
      const target = await getTemplateShape(api, template.slug);
      setStep({
        kind: "confirm",
        template,
        preview: previewTemplateChange({
          enabledSections,
          themeOverride: settings.theme_override,
          target,
        }),
      });
    } catch {
      setMessage("Template ini tidak bisa dimuat. Coba lagi.");
    }
  };

  const apply = async (template: TemplateChoice) => {
    setStep({ kind: "applying", template });
    setMessage("");
    try {
      await autosave.flush();
      await changeTemplate(api, invitationId, template.id);
      close();
      onChanged?.();
    } catch (error) {
      setStep({ kind: "choose" });
      setMessage(toFriendlyError(error).message);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
        className="focus-ring min-h-9 rounded-md border border-border px-3 text-sm font-medium text-text"
      >
        Ganti template
      </button>

      <Modal
        open={open}
        onClose={close}
        title="Ganti template"
        description="Isi undangan Anda tidak berubah. Hanya tampilannya yang berganti."
        size="form"
      >
        <div className="flex flex-col gap-4">
          {step.kind === "choose" && (
            <ul className="flex flex-col gap-2" aria-label="Pilihan template">
              {templates.map((template) => {
                const current = template.slug === currentSlug;
                return (
                  <li key={template.id}>
                    <button
                      type="button"
                      disabled={current}
                      onClick={() => void choose(template)}
                      className="focus-ring flex min-h-11 w-full items-center justify-between rounded-md border border-border px-3 text-left text-sm font-medium text-text disabled:opacity-60"
                    >
                      <span>{template.name}</span>
                      {current && (
                        <span className="text-text-muted">
                          Template saat ini
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {step.kind === "confirm" && (
            <div className="flex flex-col gap-3">
              <h3 className="text-sm font-semibold text-text">
                Beralih ke {step.template.name}?
              </h3>

              {step.preview.hiddenSections.length === 0 ? (
                <p className="text-sm text-text">
                  Semua bagian yang sedang tampil juga ada di template ini.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  <p className="text-sm text-text">
                    {step.preview.hiddenSections.length} bagian tidak akan
                    ditampilkan di template ini:
                  </p>
                  <ul
                    aria-label="Bagian yang tidak ditampilkan"
                    className="list-disc pl-5 text-sm text-text"
                  >
                    {step.preview.hiddenSections.map((key) => (
                      <li key={key}>{sectionLabel(key)}</li>
                    ))}
                  </ul>
                  <p className="text-sm text-text-muted">
                    Isinya tetap tersimpan dan tampil lagi bila Anda kembali ke
                    template yang memilikinya.
                  </p>
                </div>
              )}

              {step.preview.droppedThemeKeys.length > 0 && (
                <p className="text-sm text-text-muted">
                  Pengaturan warna dan huruf yang tidak tersedia di template ini
                  akan dikembalikan ke bawaan.
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void apply(step.template)}
                  className="focus-ring min-h-11 rounded-md bg-primary-600 px-4 text-sm font-medium text-text-inverse"
                >
                  Ganti template
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStep({ kind: "choose" });
                  }}
                  className="focus-ring min-h-11 rounded-md border border-border px-4 text-sm font-medium text-text"
                >
                  Kembali
                </button>
              </div>
            </div>
          )}

          {step.kind === "applying" && (
            <p className="text-sm text-text">
              Menerapkan {step.template.name}…
            </p>
          )}

          <p
            role="status"
            aria-live="polite"
            className="min-h-5 text-sm text-text-muted"
          >
            {message}
          </p>
        </div>
      </Modal>
    </>
  );
}
