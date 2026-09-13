/**
 * `P2-14` — what a template change will stop showing, computed before the user commits.
 *
 * `docs/UI-UX/05` § Change Template Flow puts the list in a confirmation modal *before* the
 * change: "X fields may not be displayed in this template". `docs/API/04` returns the same
 * lists, but only in the response to the change itself — after the fact. So the dialog
 * applies the server's rule to the target template it has already fetched, and the server's
 * answer is what the editor reports once the change is made.
 *
 * The rule is `docs/API/04`'s, restated rather than reinvented:
 *
 * - `hidden_sections` — what is enabled now and the target template does not define, matched
 *   by `section_key`. The data behind them is kept (BR-4.1).
 * - `dropped_theme_keys` — theme overrides the target does not list as customizable. Unlike
 *   section data these are not retained.
 *
 * No template is named anywhere here: both lists come from the two templates' own data.
 */

export interface TemplateChangePreview {
  readonly hiddenSections: readonly string[];
  readonly droppedThemeKeys: readonly string[];
}

export function previewTemplateChange(input: {
  readonly enabledSections: readonly string[];
  readonly themeOverride: unknown;
  readonly target: {
    readonly sections: readonly { readonly section_key: string }[];
    readonly customizable_theme_keys: readonly string[];
  };
}): TemplateChangePreview {
  const defined = new Set(input.target.sections.map((s) => s.section_key));
  const customizable = new Set(input.target.customizable_theme_keys);

  return {
    hiddenSections: [
      ...new Set(input.enabledSections.filter((key) => !defined.has(key))),
    ],
    droppedThemeKeys: overrideKeys(input.themeOverride).filter(
      (key) => !customizable.has(key),
    ),
  };
}

/**
 * The dotted paths an override sets — `{ colors: { primary: "#fff" } }` is `colors.primary`,
 * which is how `customizable_theme_keys` names them (`P2-02`).
 */
function overrideKeys(value: unknown, prefix = ""): string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return prefix === "" ? [] : [prefix];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(
    ([key, child]) =>
      overrideKeys(child, prefix === "" ? key : `${prefix}.${key}`),
  );
}
