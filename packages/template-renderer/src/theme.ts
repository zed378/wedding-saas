/**
 * P2-02 step 3 — theme as CSS custom properties. `docs/FRONTEND/04` § Theme Application.
 *
 * The document is specific about the mechanism and the reason: variables are applied "at
 * the TemplateRenderer's root, consumed by components via `var(--color-primary)` —
 * allowing overrides without re-rendering the entire tree". A component that took colours
 * as props would re-render on every theme change; one that reads a custom property does
 * not re-render at all, because the change happens in CSS.
 *
 * It is also what makes `CLAUDE.md`'s first rule hold. A section component with a colour
 * in it is a component that belongs to one template. A section component reading
 * `var(--color-primary)` is the same component under every template, which is the whole
 * claim the template system makes.
 */

export type ThemeObject = Record<string, unknown>;

/**
 * Merge the template's theme with the invitation's overrides, then flatten to custom
 * properties.
 *
 * ## An override is only honoured if the template permits it
 *
 * `customizable_theme_keys` is the template's own list of what a user may change.
 * `P1-14` already refuses to *store* an override outside that list, so this is the second
 * layer — and it is worth having, because the two protect different things. `P1-14` stops
 * a bad value entering the database; this stops one already there (from an earlier
 * template, before a change of template narrowed the list) from taking effect.
 *
 * That case is real: `P1-15` deliberately keeps section data across a template change and
 * drops theme overrides (ADR-054), but an override stored under a key the *new* template
 * does not list would otherwise still apply.
 */
export function mergeTheme(
  templateTheme: ThemeObject,
  override: Readonly<Record<string, unknown>> | undefined,
  customizableKeys: readonly string[],
): ThemeObject {
  if (override === undefined) return templateTheme;

  const allowed = new Set(customizableKeys);
  const merged = structuredClone(templateTheme);

  for (const [key, value] of Object.entries(override)) {
    if (!allowed.has(key)) continue;
    setDotted(merged, key, value);
  }

  return merged;
}

/**
 * Flatten a theme object into CSS custom properties.
 *
 * `{ colors: { primary: "#b76e79" } }` becomes `{ "--color-primary": "#b76e79" }`.
 *
 * The singular in `--color-primary` is not a typo and not a choice made here: it is what
 * `docs/FRONTEND/04` writes, and what `packages/ui/src/tokens.css` already uses. Two
 * spellings of the same variable is the kind of mismatch that produces a component
 * styled correctly in the workbench and unstyled on the page.
 */
export function themeToCustomProperties(
  theme: ThemeObject,
): Record<string, string> {
  const properties: Record<string, string> = {};

  Object.assign(properties, derivedProperties(theme));

  for (const [group, value] of Object.entries(theme)) {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      for (const [name, inner] of Object.entries(
        value as Record<string, unknown>,
      )) {
        const property = `--${singular(group)}-${kebab(name)}`;
        const rendered = renderValue(inner);
        if (rendered !== undefined) properties[property] = rendered;
      }
      continue;
    }

    // A scalar at the top level -- `spacing`, `border_radius`.
    const rendered = renderValue(value);
    if (rendered !== undefined) properties[`--${kebab(group)}`] = rendered;
  }

  return properties;
}

/**
 * The scales `docs/PLAN/07`'s theme expresses as words rather than measurements.
 *
 * `spacing` is `compact | comfortable | spacious` and `border_radius` is
 * `none | subtle | rounded | full` — a template author picks a feel, not a pixel count.
 * Something has to turn those into CSS, and it belongs here rather than in a component:
 * a component that knew `"comfortable"` meant `1.25rem` would be a component that had to
 * be edited to change the scale, for every template at once.
 *
 * These numbers are the **renderer's** design decisions and apply to every template
 * equally, which is what keeps them out of the per-template data.
 */
const SPACING_SCALE: Readonly<Record<string, string>> = {
  compact: "0.75rem",
  comfortable: "1.25rem",
  spacious: "2rem",
};

const RADIUS_SCALE: Readonly<Record<string, string>> = {
  none: "0",
  subtle: "4px",
  rounded: "12px",
  full: "999px",
};

const FONT_SCALE: Readonly<Record<string, string>> = {
  compact: "0.9",
  default: "1",
  large: "1.15",
};

/**
 * Turn the word-valued tokens into usable CSS, alongside the literal ones.
 *
 * An unrecognised word falls back to the middle of its scale rather than to nothing: a
 * theme that somehow carried `spacing: "roomy"` should render slightly wrong, not
 * collapse to zero-width. `P0-20` validates the enum before storage, so this is the
 * second layer.
 */
function derivedProperties(theme: ThemeObject): Record<string, string> {
  const typography = theme["typography"];
  const scale =
    typography !== null &&
    typeof typography === "object" &&
    typeof (typography as Record<string, unknown>)["scale"] === "string"
      ? ((typography as Record<string, unknown>)["scale"] as string)
      : "default";

  return {
    "--space":
      SPACING_SCALE[String(theme["spacing"])] ?? SPACING_SCALE["comfortable"]!,
    "--radius":
      RADIUS_SCALE[String(theme["border_radius"])] ?? RADIUS_SCALE["rounded"]!,
    "--font-scale": FONT_SCALE[scale] ?? FONT_SCALE["default"]!,
  };
}

/**
 * Only strings and numbers become properties.
 *
 * A custom property's value is emitted into a `style` attribute, so what may appear there
 * is worth being deliberate about. React sets these through the CSSOM rather than by
 * building a string, so a value cannot close the attribute or start a new declaration —
 * the browser treats the whole thing as one value. An object or an array is silently
 * dropped instead of stringifying to `[object Object]`, which would be a visible bug in
 * the page rather than an invisible one.
 */
function renderValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

/** `colors` -> `color`, `typography` -> `typography`. */
function singular(group: string): string {
  return group === "colors" ? "color" : kebab(group);
}

function kebab(name: string): string {
  return name.replace(/_/g, "-");
}

function setDotted(target: ThemeObject, path: string, value: unknown): void {
  const segments = path.split(".");
  let current: Record<string, unknown> = target;

  for (let i = 0; i < segments.length - 1; i += 1) {
    const key = segments[i]!;
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      return;
    }
    const next = current[key];
    if (next === null || typeof next !== "object" || Array.isArray(next)) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }

  const last = segments[segments.length - 1]!;
  if (last === "__proto__" || last === "constructor" || last === "prototype") {
    return;
  }
  current[last] = value;
}
