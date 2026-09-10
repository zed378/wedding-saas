import { z } from "zod";

import { sectionsSchema, type SectionDefinition } from "./section.schema.js";
import {
  themeKeySchema,
  themeSchema,
  themeKeyResolves,
} from "./theme.schema.js";

/**
 * P0-20 — validating a whole template version before it reaches the database.
 *
 * `docs/DATABASE/03` § Schema Validation requires this "before being saved". The three
 * pieces are validated together rather than separately because one of the rules spans
 * them: every `customizable_theme_keys` entry has to resolve inside *this* version's
 * theme, and neither schema alone can see both.
 */

/** What a caller passes in: the three columns of `template_versions` that carry design. */
export interface TemplateVersionDefinition {
  readonly sections: unknown;
  readonly theme: unknown;
  readonly customizable_theme_keys?: unknown;
}

/** One rejection, shaped for `docs/API/00`'s `details[]`. */
export interface ValidationDetail {
  /** A pointer into the definition, e.g. `sections[1].required_fields[0]`. */
  readonly field: string;
  readonly message: string;
}

export type TemplateVersionValidationResult =
  | {
      readonly ok: true;
      readonly value: {
        readonly sections: readonly SectionDefinition[];
        readonly theme: z.infer<typeof themeSchema>;
        readonly customizable_theme_keys: readonly string[];
      };
    }
  | { readonly ok: false; readonly errors: readonly ValidationDetail[] };

/**
 * Turn a Zod path into the pointer a human reads in an error response.
 *
 * `["sections", 1, "required_fields", 0]` becomes `sections[1].required_fields[0]`.
 * `docs/BACKEND/03` § Error Messages wants `details[]` entries a frontend can display
 * directly; a field of `"sections,1,required_fields,0"` is not that.
 */
function pointer(path: readonly PropertyKey[]): string {
  return path.reduce<string>((acc, segment) => {
    if (typeof segment === "number") return `${acc}[${segment}]`;
    return acc.length === 0 ? String(segment) : `${acc}.${String(segment)}`;
  }, "");
}

function detailsFrom(
  error: z.ZodError,
  prefix: readonly PropertyKey[],
): ValidationDetail[] {
  return error.issues.map((issue) => ({
    field: pointer([...prefix, ...issue.path]),
    message: issue.message,
  }));
}

/**
 * Validate a template version definition.
 *
 * Returns **every** problem rather than the first. An admin fixing one rejection at a
 * time through a round trip per fix is the reason validators get bypassed, and the same
 * reasoning is why `backend/api/src/config/env.schema.ts` exits naming every offending
 * variable at once (`P0-04`).
 */
export function validateTemplateVersion(
  input: TemplateVersionDefinition,
): TemplateVersionValidationResult {
  const errors: ValidationDetail[] = [];

  const sections = sectionsSchema.safeParse(input.sections);
  if (!sections.success)
    errors.push(...detailsFrom(sections.error, ["sections"]));

  const theme = themeSchema.safeParse(input.theme);
  if (!theme.success) errors.push(...detailsFrom(theme.error, ["theme"]));

  const keys = z
    .array(themeKeySchema)
    .default([])
    .safeParse(input.customizable_theme_keys ?? []);
  if (!keys.success) {
    errors.push(...detailsFrom(keys.error, ["customizable_theme_keys"]));
  }

  // The cross-column rule. Only checkable once both sides parsed -- running it against
  // an invalid theme would report every key as unresolvable and bury the real cause.
  if (theme.success && keys.success) {
    keys.data.forEach((key, index) => {
      if (!themeKeyResolves(theme.data, key)) {
        errors.push({
          field: `customizable_theme_keys[${index}]`,
          message:
            `"${key}" does not name a value in this version's theme, so the editor ` +
            `would show a control that changes nothing`,
        });
      }
    });

    const seen = new Set<string>();
    keys.data.forEach((key, index) => {
      if (seen.has(key)) {
        errors.push({
          field: `customizable_theme_keys[${index}]`,
          message: `duplicate theme key "${key}"`,
        });
      }
      seen.add(key);
    });
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      // Non-null assertions are safe here: `errors` is empty, which is only possible
      // when all three parses succeeded.
      sections: sections.data!,
      theme: theme.data!,
      customizable_theme_keys: keys.data!,
    },
  };
}

/**
 * The throwing form, for call sites that treat a bad definition as a programming error
 * rather than as user input -- the seed (`P0-21`) and test factories.
 *
 * The API's admin endpoints must use `validateTemplateVersion` and return the details,
 * not this: an admin pasting JSON deserves the list, not a stack trace.
 */
export class TemplateVersionInvalidError extends Error {
  constructor(readonly details: readonly ValidationDetail[]) {
    super(
      `template version definition is invalid:\n` +
        details.map((d) => `  ${d.field}: ${d.message}`).join("\n"),
    );
    this.name = "TemplateVersionInvalidError";
  }
}

export function assertValidTemplateVersion(
  input: TemplateVersionDefinition,
): Extract<TemplateVersionValidationResult, { ok: true }>["value"] {
  const result = validateTemplateVersion(input);
  if (!result.ok) throw new TemplateVersionInvalidError(result.errors);
  return result.value;
}
