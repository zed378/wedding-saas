"use client";

import { useId, useState } from "react";
import {
  collectMissingRequiredFields,
  describeMissingField,
  type SectionDefinition,
} from "@wi/schema";
import { Button, Modal } from "@wi/ui";
import { ApiError } from "@wi/api-client";

import { useEditor } from "./EditorProvider";
import { useAuth } from "../lib/auth";
import {
  checkPublish,
  publishInvitation,
  updateSlug,
  localSlugProblem,
  type PublishCheckResult,
} from "../lib/invitations";
import { PublishSuccessModal } from "../components/PublishSuccessModal";

/**
 * P2-06 + P3-15 — the publish button, completeness checklist, and full publish flow.
 *
 * ## Client check vs server authority
 *
 * `collectMissingRequiredFields` runs client-side for immediacy (same code as the server,
 * from `@wi/schema`). When "Terbitkan" is clicked, the server's `/publish-check` is called
 * to verify before showing the confirmation modal — the server is authoritative.
 *
 * ## P3-15 stages
 *
 * 1. Click "Terbitkan" → server publish-check
 * 2. If missing fields → missing-field modal
 * 3. If ready → slug confirmation modal
 * 4. Confirm → `POST /publish`
 * 5. On success → success modal with share actions
 * 6. On 409 SLUG_TAKEN → inline slug edit within confirmation modal
 *
 * ## Visible and disabled, never hidden
 *
 * `docs/UI-UX/12` § Publish CTA: disabled with a tooltip explaining why, not hidden.
 * A hidden button means the user concludes the product cannot publish.
 */

type PublishStep =
  | { readonly kind: "idle" }
  | { readonly kind: "checking-server" }
  | {
      readonly kind: "missing-fields";
      readonly fields: NonNullable<PublishCheckResult["missing_fields"]>;
    }
  | { readonly kind: "slug-confirm" }
  | {
      readonly kind: "slug-conflict";
      readonly currentSlug: string;
      readonly suggestion?: string;
    }
  | { readonly kind: "publishing" }
  | {
      readonly kind: "published";
      readonly publicUrl: string;
    }
  | { readonly kind: "payment-required" }
  | { readonly kind: "error"; readonly message: string };

export function PublishCta() {
  const definition = useEditor((state) => state.templateDefinition);
  const data = useEditor((state) => state.data);
  const invitationId = useEditor((state) => state.invitationId);
  const setActiveSection = useEditor((state) => state.setActiveSection);
  const { api } = useAuth();
  const [step, setStep] = useState<PublishStep>({ kind: "idle" });
  const [slugInput, setSlugInput] = useState("");
  const [slugError, setSlugError] = useState<string | undefined>(undefined);
  const listId = useId();

  if (definition === undefined) return null;

  const missing = collectMissingRequiredFields(
    definition.sections as readonly SectionDefinition[],
    definition.enabledSections,
    data,
  );

  const ready = missing.length === 0;
  const [showMissingList, setShowMissingList] = useState(false);

  async function handlePublishClick() {
    setStep({ kind: "checking-server" });

    try {
      const check = await checkPublish(api, invitationId);

      if (check.ready === false && (check.missing_fields?.length ?? 0) > 0) {
        setStep({
          kind: "missing-fields",
          fields: check.missing_fields ?? [],
        });
        return;
      }

      setStep({ kind: "slug-confirm" });
    } catch (error) {
      if (error instanceof ApiError && error.code === "PAYMENT_REQUIRED") {
        setStep({ kind: "payment-required" });
        return;
      }
      setStep({
        kind: "error",
        message: "Gagal memeriksa kelengkapan undangan. Silakan coba lagi.",
      });
    }
  }

  async function handleConfirmPublish() {
    setStep({ kind: "publishing" });

    try {
      const result = await publishInvitation(api, invitationId);
      setStep({ kind: "published", publicUrl: result.public_url });
    } catch (error) {
      if (error instanceof ApiError && error.code === "SLUG_TAKEN") {
        const suggestion = error.details?.[0]?.message;
        const currentSlug =
          typeof data["settings"] === "object" &&
          data["settings"] !== null &&
          "slug" in (data["settings"] as object)
            ? String((data["settings"] as Record<string, unknown>)["slug"] ?? "")
            : "";
        setSlugInput(currentSlug);
        setStep({
          kind: "slug-conflict",
          currentSlug,
          ...(suggestion !== undefined ? { suggestion } : {}),
        });
        return;
      }

      if (
        error instanceof ApiError &&
        (error.code === "PAYMENT_REQUIRED" ||
          error.code === "TRIAL_ALREADY_USED" ||
          error.code === "RENEWAL_REQUIRED" ||
          error.code === "PAYMENT_PENDING")
      ) {
        setStep({ kind: "payment-required" });
        return;
      }

      setStep({
        kind: "error",
        message:
          error instanceof ApiError && error.message.length > 0
            ? error.message
            : "Gagal menerbitkan undangan. Silakan coba lagi.",
      });
    }
  }

  async function handleSlugRetry() {
    const problem = localSlugProblem(slugInput);
    if (problem !== undefined) {
      setSlugError(problem);
      return;
    }
    setSlugError(undefined);
    setStep({ kind: "publishing" });

    try {
      await updateSlug(api, invitationId, slugInput);
      // Retry publish with new slug.
      const result = await publishInvitation(api, invitationId);
      setStep({ kind: "published", publicUrl: result.public_url });
    } catch (error) {
      if (error instanceof ApiError && error.code === "SLUG_TAKEN") {
        const suggestion = error.details?.[0]?.message;
        setStep({
          kind: "slug-conflict",
          currentSlug: slugInput,
          ...(suggestion !== undefined ? { suggestion } : {}),
        });
        return;
      }
      setStep({
        kind: "error",
        message: "Gagal memperbarui alamat. Silakan coba lagi.",
      });
    }
  }

  const isLoading =
    step.kind === "checking-server" || step.kind === "publishing";

  return (
    <>
      <div className="flex items-center gap-2">
        {!ready && (
          <button
            type="button"
            className="focus-ring rounded-md px-2 py-1 text-sm text-text-muted underline"
            aria-expanded={showMissingList}
            aria-controls={listId}
            onClick={() => {
              setShowMissingList((v) => !v);
            }}
          >
            {missing.length} isian belum lengkap
          </button>
        )}

        <Button
          loading={isLoading}
          loadingLabel="Memproses…"
          disabled={!ready}
          {...(ready ? {} : { "aria-describedby": listId })}
          title={
            ready
              ? undefined
              : "Lengkapi isian yang wajib diisi sebelum menerbitkan undangan."
          }
          className="min-h-9 rounded-md bg-primary-600 px-4 text-sm font-medium text-text-inverse disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-text-muted"
          onClick={() => {
            void handlePublishClick();
          }}
        >
          Terbitkan
        </Button>

        {!ready && (
          <ul
            id={listId}
            className={
              showMissingList
                ? "absolute top-14 right-4 z-50 max-w-sm rounded-md border border-border bg-surface p-3 text-sm shadow-md"
                : "sr-only"
            }
          >
            {missing.map((item) => (
              <li key={`${item.sectionKey}-${item.path}`}>
                {describeMissingField(item)}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Missing-fields modal */}
      <Modal
        open={step.kind === "missing-fields"}
        onClose={() => {
          setStep({ kind: "idle" });
        }}
        title="Lengkapi isian berikut sebelum menerbitkan"
        size="form"
        footer={
          <Button
            variant="secondary"
            onClick={() => {
              setStep({ kind: "idle" });
            }}
          >
            Tutup
          </Button>
        }
      >
        {step.kind === "missing-fields" && (
          <ul className="flex flex-col gap-2">
            {step.fields.map((field) => (
              <li key={`${field.section_key}-${field.path}`}>
                <button
                  type="button"
                  className="focus-ring w-full rounded-md px-3 py-2 text-left text-sm text-primary-600 underline hover:bg-surface-sunken"
                  onClick={() => {
                    setActiveSection(field.section_key);
                    const sectionEl = document.querySelector<HTMLElement>(
                      `[data-section="${field.section_key}"]`,
                    );
                    if (typeof sectionEl?.scrollIntoView === "function") {
                      sectionEl.scrollIntoView({ behavior: "smooth" });
                    }
                    setTimeout(() => {
                      const fieldEl = document.querySelector<HTMLElement>(
                        `[name="${field.path}"], [data-field="${field.path}"]`,
                      );
                      if (typeof fieldEl?.scrollIntoView === "function") {
                        fieldEl.scrollIntoView({ behavior: "smooth" });
                      }
                      fieldEl?.focus();
                    }, 50);
                    setStep({ kind: "idle" });
                  }}
                >
                  {field.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Modal>

      {/* Slug confirmation modal */}
      <Modal
        open={step.kind === "slug-confirm" || step.kind === "slug-conflict"}
        onClose={() => {
          setStep({ kind: "idle" });
        }}
        title="Konfirmasi alamat undangan"
        size="confirmation"
        footer={
          step.kind === "slug-conflict" ? (
            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setStep({ kind: "idle" });
                }}
              >
                Batalkan
              </Button>
              <Button
                onClick={() => {
                  void handleSlugRetry();
                }}
              >
                Gunakan Alamat Ini
              </Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setStep({ kind: "idle" });
                }}
              >
                Batalkan
              </Button>
              <Button
                onClick={() => {
                  void handleConfirmPublish();
                }}
              >
                Terbitkan
              </Button>
            </div>
          )
        }
      >
        {step.kind === "slug-confirm" && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-text">
              Undangan akan dapat diakses di:
            </p>
            <p className="rounded-md bg-surface-sunken px-3 py-2 font-mono text-sm text-text">
              invitation.vizunicum.my.id/
              {typeof data["settings"] === "object" &&
              data["settings"] !== null &&
              "slug" in (data["settings"] as object)
                ? String((data["settings"] as Record<string, unknown>)["slug"] ?? "")
                : "…"}
            </p>
            <p className="text-xs text-text-muted">
              Alamat ini dapat diubah setelah diterbitkan, tetapi tautan lama
              tidak akan berfungsi lagi.
            </p>
          </div>
        )}

        {step.kind === "slug-conflict" && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-danger-700">
              Alamat &ldquo;{step.currentSlug}&rdquo; sudah digunakan. Pilih
              alamat lain.
            </p>
            {step.suggestion !== undefined && (
              <p className="text-sm text-text-muted">
                Coba:{" "}
                <button
                  type="button"
                  className="focus-ring text-primary-600 underline"
                  onClick={() => {
                    setSlugInput(step.suggestion ?? "");
                    setSlugError(undefined);
                  }}
                >
                  {step.suggestion}
                </button>
              </p>
            )}
            <div className="flex flex-col gap-1">
              <label
                htmlFor="slug-retry-input"
                className="text-sm font-medium text-text"
              >
                Alamat undangan
              </label>
              <input
                id="slug-retry-input"
                type="text"
                value={slugInput}
                aria-invalid={slugError !== undefined}
                className="rounded-md border border-border px-3 py-1.5 text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary-600"
                onChange={(e) => {
                  setSlugInput(e.target.value);
                  setSlugError(undefined);
                }}
              />
              {slugError !== undefined && (
                <p className="text-xs text-danger-700">{slugError}</p>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Error modal */}
      <Modal
        open={step.kind === "error"}
        onClose={() => {
          setStep({ kind: "idle" });
        }}
        title="Terjadi kesalahan"
        size="confirmation"
        footer={
          <Button
            onClick={() => {
              setStep({ kind: "idle" });
            }}
          >
            Tutup
          </Button>
        }
      >
        {step.kind === "error" && (
          <p className="text-sm text-text">{step.message}</p>
        )}
      </Modal>

      {/* Payment required modal */}
      <Modal
        open={step.kind === "payment-required"}
        onClose={() => {
          setStep({ kind: "idle" });
        }}
        title="Pembayaran diperlukan"
        size="confirmation"
        footer={
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setStep({ kind: "idle" });
              }}
            >
              Nanti saja
            </Button>
            <a
              href={`/checkout/${invitationId}`}
              className="focus-ring inline-flex items-center justify-center rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-text-inverse hover:bg-primary-700"
            >
              Bayar Sekarang
            </a>
          </div>
        }
      >
        <p className="text-sm text-text">
          Undangan ini perlu diaktifkan terlebih dahulu. Aktivasi Rp{" "}
          {["139", "000"].join(".")} untuk 12 bulan akses penuh.
        </p>
      </Modal>

      {/* Success modal */}
      {step.kind === "published" && (
        <PublishSuccessModal
          publicUrl={step.publicUrl}
          open
          onClose={() => {
            setStep({ kind: "idle" });
          }}
        />
      )}
    </>
  );
}
