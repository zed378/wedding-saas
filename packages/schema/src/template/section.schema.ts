import { z } from "zod";

import {
  isCanonicalFieldPath,
  suggestFieldPaths,
} from "../invitation/field-registry.js";
import {
  COMPONENT_NAMES,
  SECTION_KEYS,
  componentSection,
  componentsForSection,
  isRegisteredComponent,
  type SectionKey,
} from "./component-registry.js";
import { CSS_TOKEN } from "./theme.schema.js";

/**
 * P0-20 — `template_versions.sections`.
 *
 * `docs/DATABASE/03` § Schema Validation: "The `sections` column is validated against a
 * fixed JSON Schema (defined in application code, not in the DB) before being saved."
 * This is that schema, expressed in Zod so one definition serves the API's validation,
 * the admin editor's form and the generated TypeScript types (ADR-014).
 *
 * The shape comes from `docs/PLAN/07` § Section System. Everything beyond the shape --
 * the registry checks and the six cross-field rules below -- exists because each one
 * describes a definition that is structurally valid and renders wrongly, which is the
 * expensive kind of wrong.
 */

/** A layout variant name. Reaches CSS, so it is constrained like a theme token. */
const layoutVariantSchema = z
  .string()
  .min(1)
  .max(40)
  .regex(CSS_TOKEN, "must be a lowercase token like grid-3col");

/**
 * A field path, checked against the canonical registry.
 *
 * DoD item 1: "A section definition with an unknown field path is rejected with a
 * message naming the path." The message names it and suggests the near misses, because
 * the realistic cause is a typo and the realistic reader is looking at ten paths.
 */
const fieldPathSchema = z.string().superRefine((path, ctx) => {
  if (isCanonicalFieldPath(path)) return;

  const suggestions = suggestFieldPaths(path);
  ctx.addIssue({
    code: "custom",
    message:
      `unknown field path "${path}" — it is not in the canonical registry ` +
      `(docs/PLAN/08)` +
      (suggestions.length > 0
        ? `. Did you mean ${suggestions.join(", ")}?`
        : ""),
  });
});

/** The raw shape, before the cross-field rules. */
const sectionShape = z
  .object({
    section_key: z.enum(SECTION_KEYS),
    component: z.string().min(1).max(60),
    enabled_by_default: z.boolean(),
    configurable: z.boolean(),
    max_items: z.int().min(1).max(500).optional(),
    required_fields: z.array(fieldPathSchema).default([]),
    optional_fields: z.array(fieldPathSchema).default([]),
    layout_variant: layoutVariantSchema.optional(),
    layout_options: z.array(layoutVariantSchema).optional(),
  })
  .strict();

export const sectionSchema = sectionShape.superRefine((section, ctx) => {
  // --- DoD item 2: the component must exist ---------------------------------
  if (!isRegisteredComponent(section.component)) {
    ctx.addIssue({
      code: "custom",
      path: ["component"],
      message:
        `unknown component "${section.component}" — no renderer provides it. ` +
        `Registered: ${COMPONENT_NAMES.join(", ")}`,
    });
  } else {
    // ... and it must be the component for THIS section. A real component under the
    // wrong key passes a name-only check and renders a hero where a gallery belongs.
    const owner = componentSection(section.component);
    if (owner !== section.section_key) {
      const allowed = componentsForSection(section.section_key);
      ctx.addIssue({
        code: "custom",
        path: ["component"],
        message:
          `component "${section.component}" renders the "${owner}" section, not ` +
          `"${section.section_key}". For "${section.section_key}" use: ` +
          (allowed.length > 0 ? allowed.join(", ") : "(none registered)"),
      });
    }
  }

  // --- A field cannot be both required and optional -------------------------
  // They mean opposite things at publish time (BR-4.2 blocks on one and not the other),
  // so a path in both is a definition with no single answer.
  const both = section.required_fields.filter((f) =>
    section.optional_fields.includes(f),
  );
  for (const path of both) {
    ctx.addIssue({
      code: "custom",
      path: ["required_fields"],
      message: `"${path}" is listed as both required and optional`,
    });
  }

  // --- An always-on section cannot default to off ---------------------------
  // docs/FRONTEND/04 step 2 renders a section unconditionally when
  // `configurable: false`. Together with `enabled_by_default: false` that describes a
  // section which is both always shown and off by default.
  if (!section.configurable && !section.enabled_by_default) {
    ctx.addIssue({
      code: "custom",
      path: ["enabled_by_default"],
      message:
        "a non-configurable section is always rendered (docs/FRONTEND/04 step 2), " +
        "so enabled_by_default: false can never take effect",
    });
  }

  // --- layout_variant must be one of the offered options --------------------
  if (
    section.layout_variant !== undefined &&
    section.layout_options !== undefined &&
    !section.layout_options.includes(section.layout_variant)
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["layout_variant"],
      message:
        `default layout "${section.layout_variant}" is not among layout_options ` +
        `(${section.layout_options.join(", ")})`,
    });
  }

  // --- layout_options must be a real choice ---------------------------------
  if (section.layout_options !== undefined) {
    if (section.layout_options.length < 2) {
      ctx.addIssue({
        code: "custom",
        path: ["layout_options"],
        message:
          "layout_options offers the user a choice, so it needs at least two entries " +
          "— omit it entirely to fix the layout",
      });
    }
    const seen = new Set<string>();
    for (const option of section.layout_options) {
      if (seen.has(option)) {
        ctx.addIssue({
          code: "custom",
          path: ["layout_options"],
          message: `duplicate layout option "${option}"`,
        });
      }
      seen.add(option);
    }
  }
});

export type SectionDefinition = z.infer<typeof sectionSchema>;

/**
 * The whole `sections` array.
 *
 * Order is meaningful: `docs/FRONTEND/04` step 1 renders in array order, so this is the
 * template's layout and not merely a set.
 */
export const sectionsSchema = z
  .array(sectionSchema)
  .min(1, "a template version must define at least one section")
  .superRefine((sections, ctx) => {
    // --- section_key must be unique -----------------------------------------
    // `invitation_settings.enabled_sections` is a list of keys (docs/PLAN/08), so two
    // entries sharing a key make a toggle ambiguous and template switching -- which
    // matches on `section_key` (docs/PLAN/07) -- non-deterministic.
    const seen = new Map<SectionKey, number>();
    sections.forEach((section, index) => {
      const first = seen.get(section.section_key);
      if (first !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: [index, "section_key"],
          message:
            `duplicate section_key "${section.section_key}" (also at index ${first}) ` +
            `— enabled_sections and template switching both key on it`,
        });
      } else {
        seen.set(section.section_key, index);
      }
    });
  });
