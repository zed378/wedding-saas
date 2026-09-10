import { z } from "zod";

/**
 * P0-20 — `template_versions.theme` and its customization boundary.
 *
 * `docs/PLAN/07` § Theme Variables gives the shape; `docs/DATABASE/03` stores it as
 * `JSONB` and puts `customizable_theme_keys` in a **separate column**; `docs/API/03`
 * returns the two as siblings with keys like `"colors.primary"`.
 *
 * (`docs/PLAN/07` mentions `customizable_theme_keys` in prose beside the theme block,
 * which reads as though it lives inside it. Two documents against one, and the physical
 * schema is the tiebreak: it is a column. `validateTemplateVersion` takes it separately
 * and cross-checks it against the theme it accompanies.)
 */

/** `#rgb` or `#rrggbb`. Lowercase or uppercase, nothing else. */
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * A CSS-safe token: what may appear in `spacing`, `border_radius`, `scale` and a layout
 * variant.
 *
 * The renderer turns theme values into CSS custom properties (`docs/FRONTEND/04` §
 * Theme Application). Nothing in a template definition comes from an end user -- these
 * are admin-authored documents -- so this is not the primary defence. It is the cheap
 * one: a definition cannot carry a payload that waits for a renderer that interpolates
 * carelessly, and the constraint costs a regex.
 */
const CSS_TOKEN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

const colorsSchema = z
  .object({
    primary: z.string().regex(HEX_COLOR, "must be a hex colour like #8B5E3C"),
    secondary: z.string().regex(HEX_COLOR, "must be a hex colour like #F4EDE4"),
    accent: z.string().regex(HEX_COLOR, "must be a hex colour like #C9A876"),
    text: z.string().regex(HEX_COLOR, "must be a hex colour like #2B2B2B"),
  })
  // All four are required. A component reading `var(--color-accent)` against a theme
  // that omitted `accent` renders invisible text, and it shows up only on whichever
  // section happened to use that variable -- on one template, in production.
  .strict();

const typographySchema = z
  .object({
    // A font *name*, not a CSS declaration: letters, digits, spaces and a few joiners.
    // "Playfair Display" is fine; a `;` is not.
    heading_font: z
      .string()
      .min(1)
      .max(60)
      .regex(/^[A-Za-z0-9 '+_-]+$/, "must be a plain font family name"),
    body_font: z
      .string()
      .min(1)
      .max(60)
      .regex(/^[A-Za-z0-9 '+_-]+$/, "must be a plain font family name"),
    // docs/PLAN/07 shows only "default". The other two are this task's decision --
    // see ADR-037 and OQ-20. Widening an enum later is free; narrowing it is a
    // migration over stored JSONB, which is why it is enumerated at all.
    scale: z.enum(["compact", "default", "large"]),
  })
  .strict();

export const themeSchema = z
  .object({
    colors: colorsSchema,
    typography: typographySchema,
    // docs/PLAN/07 names all three.
    spacing: z.enum(["compact", "comfortable", "spacious"]),
    // docs/PLAN/07 gives only the example "rounded" -- see ADR-037 and OQ-20.
    border_radius: z.enum(["none", "subtle", "rounded", "full"]),
  })
  .strict();

export type Theme = z.infer<typeof themeSchema>;

/**
 * A `customizable_theme_keys` entry: a dot path into the theme, e.g. `colors.primary`.
 *
 * `docs/DATABASE/03` caps the column at `VARCHAR(60)`, so the schema does too -- a value
 * that validates in the application and is then truncated or rejected by the database is
 * the worst of both.
 */
export const themeKeySchema = z
  .string()
  .min(1)
  .max(60)
  .regex(
    /^[a-z_]+(?:\.[a-z_]+)*$/,
    "must be a dot path into the theme, like colors.primary",
  );

/**
 * Does this key name something that actually exists in this theme?
 *
 * A key that resolves to nothing means the editor offers the user a control that changes
 * nothing when they use it. That is worse than not offering it, and it is invisible to
 * everyone except the user who tries.
 */
export function themeKeyResolves(theme: unknown, key: string): boolean {
  let current: unknown = theme;
  for (const segment of key.split(".")) {
    if (current === null || typeof current !== "object") return false;
    if (!Object.hasOwn(current, segment)) return false;
    current = (current as Record<string, unknown>)[segment];
  }
  // A theme *group* (`colors`) is not customizable -- only a leaf is. Allowing a group
  // would let a theme override replace the whole object, including keys the template
  // never meant to expose.
  return current !== null && typeof current !== "object";
}

export { CSS_TOKEN, HEX_COLOR };
