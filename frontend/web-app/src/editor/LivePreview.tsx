"use client";

import { useEffect, useRef, useState } from "react";
import {
  TemplateRenderer,
  type SectionDefinition,
} from "@wi/template-renderer";

import { useEditor } from "./EditorProvider";
import type { TemplateSectionDefinition } from "./store";

/**
 * P2-05 — the live preview. `docs/FRONTEND/06` § Live Preview.
 *
 * ## It reads local state and never refetches
 *
 * `docs/FRONTEND/06` § Why Not Fetch-on-Every-Keystroke is the reason `docs/PLAN/17`'s
 * 300ms criterion is achievable at all: the preview is a function of the editor store, so
 * a keystroke reaches it in a render rather than a round trip. Autosave happens on its own
 * schedule (`P1-22`) and the preview does not wait for it — which also means the preview
 * shows unsaved work, and that is the point of a preview.
 *
 * ## The same renderer as the public page
 *
 * `mode="live"`, and otherwise the identical component `public-invite` mounts. That is
 * what makes this an honest preview rather than a second implementation that drifts, and
 * `preview-parity.spec.tsx` asserts the two produce the same DOM for the same data.
 *
 * ## In the same document, not an iframe
 *
 * `docs/FRONTEND/06` § Performance: simpler state sync, and iframe isolation is
 * reconsidered only if CSS bleed becomes a real problem. Worth knowing what that trade
 * costs — the renderer's own `<style>` block is scoped by `wi-` class names, so the risk
 * runs the other way: the application's stylesheet could affect the preview. The device
 * frame below is a plain element, so a `max-width` on the frame is all that separates a
 * "mobile" preview from the page around it.
 */

/** `docs/UI-UX/12`: a 375px mobile frame and a scaled desktop view. */
type Device = "mobile" | "desktop";

const DEVICES: readonly { readonly id: Device; readonly label: string }[] = [
  { id: "mobile", label: "Ponsel" },
  { id: "desktop", label: "Desktop" },
];

export function LivePreview() {
  const data = useEditor((state) => state.data);
  const definition = useEditor((state) => state.templateDefinition);
  const activeSectionKey = useEditor((state) => state.activeSectionKey);

  const [device, setDevice] = useState<Device>("mobile");
  const container = useRef<HTMLDivElement>(null);

  /**
   * Step 5 — selecting a section in the sidebar scrolls the preview to it.
   *
   * By attribute rather than by a ref per section: the renderer already emits
   * `data-section` on every one, and a ref map would mean the preview reaching into the
   * renderer's internals to register callbacks. This works for any template without the
   * renderer knowing the editor exists.
   *
   * `block: "start"` and not `center`, because a section is usually taller than the
   * viewport and centring it puts its heading off the top of the frame.
   */
  useEffect(() => {
    if (activeSectionKey === undefined) return;

    const target = container.current?.querySelector(
      `[data-section="${activeSectionKey}"]`,
    );

    // Feature-tested rather than assumed. `scrollIntoView` is absent in jsdom and its
    // options argument is not universal even where it exists -- and a preview that threw
    // because a section was selected would take the whole panel down through `P2-04`'s
    // boundary, turning a cosmetic nicety into a visible failure.
    if (typeof target?.scrollIntoView !== "function") return;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [activeSectionKey]);

  if (definition === undefined) {
    return (
      <p className="text-sm text-text-muted" role="status">
        Pratinjau belum tersedia untuk template ini.
      </p>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3">
      {/*
       * `docs/UI-UX/17` § Areas of Special Attention: the skip link. Without it a keyboard
       * user reaching the properties panel has to tab through an entire invitation --
       * every gallery image, every form control in the RSVP shell -- which on a long
       * template is dozens of stops to get to the thing they came to edit.
       *
       * Visible on focus only, and first in the tab order of this panel.
       */}
      <a
        className="focus-ring sr-only focus:not-sr-only focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:text-text"
        href="#editor-properties"
      >
        Lewati pratinjau
      </a>

      <div
        className="flex items-center gap-2"
        role="group"
        aria-label="Tampilan perangkat"
      >
        {DEVICES.map((option) => (
          <button
            key={option.id}
            type="button"
            // `aria-pressed` rather than a radio group: these are two states of one
            // control, and a screen reader should hear "Ponsel, pressed" rather than
            // announce a form the user did not open.
            aria-pressed={device === option.id}
            onClick={() => {
              setDevice(option.id);
            }}
            className={[
              "focus-ring min-h-9 rounded-md border px-3 text-xs font-medium",
              device === option.id
                ? "border-primary-600 bg-primary-50 text-primary-700"
                : "border-border text-text-muted",
            ].join(" ")}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div
        ref={container}
        data-device={device}
        className={[
          "min-h-0 flex-1 overflow-y-auto rounded-lg border border-border bg-surface",
          // The mobile frame is `docs/UI-UX/12`'s 375px. Desktop is simply unconstrained:
          // the panel is already narrower than a desktop viewport, so a transform-scaled
          // "real" desktop would be a preview of a layout at a size nobody uses.
          // `docs/UI-UX/12`'s 375px, as a token: a device width is a measurement
          // somebody might change, and `--container-device-mobile` is where it lives.
          device === "mobile"
            ? "mx-auto w-[var(--container-device-mobile)] max-w-full"
            : "w-full",
        ].join(" ")}
      >
        <TemplateRenderer
          mode="live"
          templateVersion={{
            sections: renderableSections(definition.sections),
            theme: definition.theme ?? {},
            customizable_theme_keys: definition.customizable_theme_keys ?? [],
          }}
          invitationData={data}
          enabledSections={enabledSections(data)}
          themeOverride={themeOverride(data)}
          // `docs/FRONTEND/08` § Editor: the couple is the person who needs to know a
          // section failed to draw, unlike a guest on the public page.
          sectionFallback={
            <p className="p-4 text-sm text-text-muted">
              Bagian ini belum bisa ditampilkan.
            </p>
          }
        />
      </div>
    </div>
  );
}

/**
 * `enabled_sections` out of the invitation's settings.
 *
 * The store holds the invitation exactly as the API returned it, and `docs/PLAN/08`
 * § Where Settings Fields Physically Live puts these on `invitation_settings` rather than
 * on the invitation — so they arrive nested under `settings` and the renderer takes them
 * as a separate prop.
 */
function enabledSections(
  data: Readonly<Record<string, unknown>>,
): readonly string[] | undefined {
  const settings = data["settings"];
  if (settings === null || typeof settings !== "object") return undefined;

  const enabled = (settings as Record<string, unknown>)["enabled_sections"];
  return Array.isArray(enabled)
    ? enabled.filter((key): key is string => typeof key === "string")
    : undefined;
}

function themeOverride(
  data: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> | undefined {
  const settings = data["settings"];
  if (settings === null || typeof settings !== "object") return undefined;

  const override = (settings as Record<string, unknown>)["theme_override"];
  return override !== null && typeof override === "object"
    ? (override as Record<string, unknown>)
    : undefined;
}

/**
 * The store's section list, narrowed to what the renderer requires.
 *
 * The store holds whatever the API returned and its `component` is optional -- the type
 * predates the preview, and a section list without component names is still a usable
 * properties panel. The renderer requires the name, because it is the thing it resolves
 * through the registry.
 *
 * A section with no component is therefore **dropped here** rather than passed on as a
 * definition the renderer would report as unrenderable. That distinction matters: an
 * unregistered component is a catalogue problem worth alerting on (`docs/PLAN/18` R5),
 * while a missing name is an older row and is not news.
 */
function renderableSections(
  sections: readonly TemplateSectionDefinition[],
): SectionDefinition[] {
  return sections
    .filter(
      (section): section is TemplateSectionDefinition & { component: string } =>
        typeof section.component === "string" && section.component.length > 0,
    )
    .map((section) => ({
      section_key: section.section_key,
      component: section.component,
      enabled_by_default: section.enabled_by_default ?? true,
      configurable: section.configurable ?? true,
      required_fields: section.required_fields ?? [],
      optional_fields: section.optional_fields ?? [],
      ...(section.max_items !== undefined
        ? { max_items: section.max_items }
        : {}),
      ...(section.layout_variant !== undefined
        ? { layout_variant: section.layout_variant }
        : {}),
    }));
}
