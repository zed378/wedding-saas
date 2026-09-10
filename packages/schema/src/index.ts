/**
 * `@wi/schema` — the shapes the backend and the frontends must agree on.
 *
 * `P0-20` populated it: the canonical field-path registry from `docs/PLAN/08`, the
 * component and section registries from `docs/PLAN/07`, the Zod schemas that validate
 * `template_versions.sections` and `.theme` before a write (`docs/DATABASE/03`), and the
 * dot-notation resolver used by publish validation (`docs/BACKEND/03`) and by the
 * renderer (`docs/FRONTEND/04`).
 *
 * Everything here is a pure function over a plain object. No database, no clock, no
 * network — which is what lets the same code decide "is this field filled" in the
 * editor's keystroke validation, in the publish endpoint and in the server-rendered
 * public page, instead of three implementations reaching three answers.
 */

export const PACKAGE_NAME = "@wi/schema" as const;

/** Bumped when a shape in this package changes in a way consumers must react to. */
export const SCHEMA_CONTRACT_VERSION = 1 as const;

// --- The canonical invitation vocabulary (docs/PLAN/08) ----------------------
export {
  INVITATION_FIELDS,
  INVITATION_FIELD_PATHS,
  isCanonicalFieldPath,
  fieldDefinition,
  suggestFieldPaths,
  type FieldDefinition,
  type FieldKind,
} from "./invitation/field-registry.js";

export type {
  InvitationData,
  PersonData,
  EventData,
  PhotoData,
  GiftAccountData,
  QuoteData,
} from "./invitation/invitation-data.js";

// --- The template vocabulary (docs/PLAN/07) ----------------------------------
export {
  SECTION_KEYS,
  COMPONENT_REGISTRY,
  COMPONENT_NAMES,
  isRegisteredComponent,
  componentSection,
  componentsForSection,
  type SectionKey,
} from "./template/component-registry.js";

export {
  sectionSchema,
  sectionsSchema,
  type SectionDefinition,
} from "./template/section.schema.js";

export {
  themeSchema,
  themeKeySchema,
  themeKeyResolves,
  type Theme,
} from "./template/theme.schema.js";

export {
  validateTemplateVersion,
  assertValidTemplateVersion,
  TemplateVersionInvalidError,
  type TemplateVersionDefinition,
  type TemplateVersionValidationResult,
  type ValidationDetail,
} from "./template/template-version.js";

// --- The resolver (docs/BACKEND/03, docs/FRONTEND/04) ------------------------
export {
  resolvePath,
  isEmpty,
  isPathMissing,
  WILDCARD,
} from "./resolver/resolve-path.js";

export {
  isSectionEnabled,
  collectMissingRequiredFields,
  missingFieldPaths,
  type MissingRequiredField,
} from "./resolver/completeness.js";
