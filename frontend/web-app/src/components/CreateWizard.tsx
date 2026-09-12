"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { Button, Input, Stepper } from "@wi/ui";

import { useAuth } from "../lib/auth";
import { toFriendlyError, type FriendlyError } from "../lib/error-messages";
import {
  checkSlug,
  createInvitation,
  localSlugProblem,
  suggestSlug,
  SLUG_MAX_LENGTH,
  SLUG_MIN_LENGTH,
  type SlugAvailability,
} from "../lib/invitations";
import { AuthShell, FormError } from "./AuthShell";

/**
 * P1-21 — the creation wizard. `docs/PLAN/04` § F2.
 *
 * ## Two steps, or one
 *
 * `docs/PLAN/04` describes template selection, then name and address, then the editor. A user
 * arriving from the catalogue has already chosen — card step 4: "template selection (skipped
 * if arriving from the catalog)" — so the template step disappears rather than being shown
 * pre-filled. A step that only confirms a decision already made is a step people click
 * through without reading.
 *
 * ## The availability check is advisory and the create call is authoritative
 *
 * ADR-057. `slug-available` cannot reserve anything: between its answer and the `POST` that
 * uses it another user can claim the address. So the field shows the check while typing
 * **and** the submit handler still handles 409 `SLUG_TAKEN` — which is a real path with a
 * real test, not a defensive branch nobody exercises.
 *
 * ## It runs once
 *
 * Card DoD 3: "the wizard runs once and does not reappear on subsequent edits". It is a route
 * a user visits to create something, and it redirects into the editor on success. Nothing
 * re-enters it, because nothing links back to it from an existing invitation.
 */

export interface CreateWizardProps {
  /** From the catalogue, when the user picked a template before arriving. */
  readonly presetTemplateId?: string | undefined;
  /** Templates to choose from. `P2-01` supplies the real catalogue. */
  readonly templates: readonly { readonly id: string; readonly name: string }[];
  readonly onCreated: (invitationId: string) => void;
  readonly dashboardHref: string;
}

type SlugState =
  | { readonly kind: "idle" }
  | { readonly kind: "checking" }
  | { readonly kind: "answered"; readonly result: SlugAvailability };

const STEPS = [
  { id: "template", label: "Template" },
  { id: "details", label: "Nama & alamat" },
] as const;

export function CreateWizard({
  presetTemplateId,
  templates,
  onCreated,
  dashboardHref,
}: CreateWizardProps) {
  const { api } = useAuth();

  const skipTemplateStep =
    presetTemplateId !== undefined && presetTemplateId.length > 0;

  const [step, setStep] = useState<"template" | "details">(
    skipTemplateStep ? "details" : "template",
  );
  const [templateId, setTemplateId] = useState(presetTemplateId ?? "");
  const [internalName, setInternalName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [slugState, setSlugState] = useState<SlugState>({ kind: "idle" });
  const [problem, setProblem] = useState<FriendlyError | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);

  const localProblem = localSlugProblem(slug);

  /**
   * Debounced availability check.
   *
   * 400ms, and only when the format is already valid: asking the server about `bu` on the
   * way to `budi-dan-ani` spends a request to be told something the local mirror already
   * knows. The abort is what keeps a slow answer for an old value from overwriting a fast
   * answer for the current one.
   */
  useEffect(() => {
    if (slug.length === 0 || localProblem !== undefined) {
      setSlugState({ kind: "idle" });
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      setSlugState({ kind: "checking" });
      void (async () => {
        try {
          const result = await checkSlug(api, slug, controller.signal);
          if (!controller.signal.aborted) {
            setSlugState({ kind: "answered", result });
          }
        } catch {
          // A failed check is not a failed slug. Falling back to idle lets the user submit
          // and lets the server decide, which it was going to do anyway.
          if (!controller.signal.aborted) setSlugState({ kind: "idle" });
        }
      })();
    }, 400);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [api, slug, localProblem]);

  // Suggest an address from the name, until the user edits the address themselves. After
  // that the field is theirs: overwriting somebody's deliberate choice on every keystroke of
  // a different field is the kind of helpfulness people hate.
  const suggestedFrom = useRef("");
  useEffect(() => {
    if (slugTouched) return;
    const suggestion = suggestSlug(internalName);
    if (suggestion === suggestedFrom.current) return;
    suggestedFrom.current = suggestion;
    setSlug(suggestion);
  }, [internalName, slugTouched]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    setProblem(undefined);
    setSubmitting(true);

    try {
      const created = await createInvitation(api, {
        templateId,
        internalName,
        slug,
      });
      onCreated(created.id);
    } catch (error) {
      const friendly = toFriendlyError(error);
      setProblem(friendly);

      // The authoritative answer. ADR-057: the advisory check said yes and the create call
      // says no, because somebody claimed the address in between. The field is marked and
      // the user stays on the step with their work intact.
      if (friendly.field === "slug" || isSlugTaken(error)) {
        setSlugState({
          kind: "answered",
          result: {
            available: false,
            slug,
            reason: "taken",
            message: "Alamat ini baru saja digunakan. Pilih yang lain.",
          },
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (step === "template") {
    return (
      <AuthShell
        title="Pilih template"
        description="Anda dapat menggantinya kapan saja tanpa kehilangan data."
        footer={
          <a
            className="focus-ring text-primary-700 underline"
            href={dashboardHref}
          >
            Kembali ke dasbor
          </a>
        }
      >
        <Stepper steps={STEPS} current={0} label="Langkah pembuatan undangan" />

        <ul className="mt-6 space-y-2">
          {templates.map((template) => (
            <li key={template.id}>
              <button
                type="button"
                className="focus-ring w-full rounded-md border border-border px-4 py-3 text-left text-sm font-medium text-text hover:bg-surface-sunken"
                onClick={() => {
                  setTemplateId(template.id);
                  setStep("details");
                }}
              >
                {template.name}
              </button>
            </li>
          ))}
        </ul>

        {templates.length === 0 && (
          <p className="mt-6 text-sm text-text-muted">
            Belum ada template yang tersedia.
          </p>
        )}
      </AuthShell>
    );
  }

  const slugHint = describeSlug(slugState, localProblem, slugTouched);

  return (
    <AuthShell
      title="Nama dan alamat"
      description="Nama internal hanya untuk Anda. Alamat adalah tautan yang dibagikan ke tamu."
      footer={
        <a
          className="focus-ring text-primary-700 underline"
          href={dashboardHref}
        >
          Kembali ke dasbor
        </a>
      }
    >
      {/*
       * Still index 1 when the template step was skipped. The user did complete it -- in the
       * catalogue -- and a stepper that renumbered would tell somebody arriving from there
       * that they are on step one of one, which is not what happened.
       */}
      <Stepper steps={STEPS} current={1} label="Langkah pembuatan undangan" />

      <div className="mt-6">
        <FormError
          message={problem?.field === undefined ? problem?.message : undefined}
        />
      </div>

      <form onSubmit={(e) => void onSubmit(e)} noValidate>
        <div className="space-y-4">
          <Input
            label="Nama internal"
            name="internal_name"
            required
            value={internalName}
            onChange={(e) => {
              setInternalName(e.target.value);
            }}
            helperText="Contoh: Budi & Ani. Tidak ditampilkan kepada tamu."
            error={
              problem?.field === "internal_name" ? problem.message : undefined
            }
          />

          <Input
            label="Alamat undangan"
            name="slug"
            required
            value={slug}
            minLength={SLUG_MIN_LENGTH}
            maxLength={SLUG_MAX_LENGTH}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value.toLowerCase());
            }}
            helperText={slugHint.helper}
            error={slugHint.error}
          />

          {/*
           * The availability answer, announced politely. A sighted user watches the hint
           * change under the field; without a live region a screen-reader user types an
           * address, hears nothing, and submits it to find out.
           */}
          <p role="status" aria-live="polite" className="sr-only">
            {slugHint.announcement}
          </p>
        </div>

        <Button
          type="submit"
          className="mt-6 w-full"
          loading={submitting}
          // Blocked only on what is locally knowable. Availability is advisory, so a user
          // may submit an address the check has not answered for yet -- the server decides.
          aria-disabled={
            internalName.trim().length === 0 ||
            slug.length === 0 ||
            localProblem !== undefined
          }
        >
          Buat dan lanjut ke editor
        </Button>
      </form>
    </AuthShell>
  );
}

function isSlugTaken(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "SLUG_TAKEN";
}

/** The three things the address field can say, in one place so they cannot disagree. */
function describeSlug(
  state: SlugState,
  localProblem: string | undefined,
  touched: boolean,
): {
  helper: string | undefined;
  error: string | undefined;
  announcement: string;
} {
  if (localProblem !== undefined && touched) {
    return {
      helper: undefined,
      error: localProblem,
      announcement: localProblem,
    };
  }

  if (state.kind === "checking") {
    return {
      helper: "Memeriksa ketersediaan…",
      error: undefined,
      announcement: "",
    };
  }

  if (state.kind === "answered") {
    if (state.result.available) {
      const message = `Alamat ${state.result.slug} tersedia.`;
      return { helper: message, error: undefined, announcement: message };
    }
    const message = state.result.message ?? "Alamat ini tidak dapat digunakan.";
    return { helper: undefined, error: message, announcement: message };
  }

  return {
    helper: "Huruf kecil, angka dan tanda hubung.",
    error: undefined,
    announcement: "",
  };
}
