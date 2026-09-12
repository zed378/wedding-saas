import type { ComponentType, ReactNode } from "react";

/**
 * P2-02 — the contract every section component implements.
 *
 * `docs/FRONTEND/04` Render Flow step 5 names the three props: `data`, `theme`,
 * `layoutVariant`. `mode` is the fourth, from § Mode Differences, and it is **required**
 * rather than defaulted — a section that could submit an RSVP because a prop was missing
 * is the failure the mode exists to prevent, and a default is how that happens.
 */

/** `docs/FRONTEND/04` § Mode Differences. */
export type RenderMode = "live" | "public" | "demo";

export interface SectionProps {
  /**
   * Exactly the fields the section declared, resolved from the invitation.
   *
   * Not the whole invitation: a component handed everything can read anything, and
   * `required_fields` then stops describing what it uses.
   */
  readonly data: Record<string, unknown>;
  /** The merged theme, for a component that needs a value rather than a CSS variable. */
  readonly theme: Record<string, unknown>;
  /** From `section.layout_variant`, where the schema offers options. */
  readonly layoutVariant: string | undefined;
  readonly mode: RenderMode;
  /** `section.max_items`, where the schema sets one — a gallery's photo cap. */
  readonly maxItems: number | undefined;
}

export type SectionComponent = ComponentType<SectionProps>;

/** One entry of `template_versions.sections`, as `P0-20` validated it. */
export interface SectionDefinition {
  readonly section_key: string;
  readonly component: string;
  readonly enabled_by_default: boolean;
  readonly configurable: boolean;
  readonly max_items?: number;
  readonly required_fields?: readonly string[];
  readonly optional_fields?: readonly string[];
  readonly layout_variant?: string;
  readonly layout_options?: readonly string[];
}

export interface TemplateVersionDefinition {
  readonly sections: readonly SectionDefinition[];
  readonly theme: Record<string, unknown>;
  readonly customizable_theme_keys?: readonly string[];
}

/**
 * A section that threw while rendering. `docs/FRONTEND/08` § Logging.
 *
 * Carries the section key, the component name and the error itself — and deliberately
 * **not** the section's data. The obvious thing to attach to a render error is the props
 * that caused it, and for this renderer those props can be bank account numbers
 * (`docs/SECURITY/09`) or a guest list.
 *
 * `invitation_id` and `user_id` are the caller's to add: this package has no concept of
 * which invitation it is showing, and giving it one would be the first step to it
 * behaving differently for some of them.
 */
export interface SectionErrorReport {
  readonly sectionKey: string;
  readonly component: string;
  readonly message: string;
  readonly componentStack?: string | undefined;
}

/** Why a section did not render. Surfaced to the caller, never logged from here. */
export interface SectionRenderIssue {
  readonly sectionKey: string;
  readonly component: string;
  readonly reason: "unregistered_component";
}

export interface TemplateRendererProps {
  readonly templateVersion: TemplateVersionDefinition;
  /** The invitation, in `docs/PLAN/08`'s canonical shape. */
  readonly invitationData: Record<string, unknown>;
  /**
   * From `invitation_settings`. Passed separately rather than nested in the invitation
   * because `docs/PLAN/08` § Where Settings Fields Physically Live keeps them apart, and
   * `P1-14` already treats them as a different concern.
   */
  readonly enabledSections?: readonly string[] | undefined;
  readonly themeOverride?: Readonly<Record<string, unknown>> | undefined;
  readonly mode: RenderMode;
  /**
   * Called for a section that could not render.
   *
   * A callback rather than a log line: this package runs in a browser and under SSR, and
   * a logger here would be a second logging path outside `@wi/logging`'s redaction.
   * `public-invite` logs it server-side; the editor shows it.
   */
  readonly onSectionIssue?: ((issue: SectionRenderIssue) => void) | undefined;
  /**
   * A section threw while rendering. `P2-04`.
   *
   * Separate from `onSectionIssue`, which is about a definition naming a component that
   * does not exist — that is a catalogue problem, knowable before render. This is a
   * runtime failure in a component that does exist, which is a different thing to alert
   * on and usually means corrupt data.
   */
  readonly onSectionError?: ((report: SectionErrorReport) => void) | undefined;
  /**
   * What a failed section shows instead of nothing.
   *
   * The public page passes nothing: a guest who never knew the gallery existed is not
   * served by being told it is broken. The editor passes a placeholder, because there the
   * couple IS the person who needs to know (`P2-05`).
   */
  readonly sectionFallback?: ReactNode;
}
