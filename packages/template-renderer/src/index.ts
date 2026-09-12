// @wi/template-renderer
//
// The generic renderer and the section component library. Imported by BOTH web-app (the
// editor preview) and public-invite (the public page) -- the shared import is what
// docs/FRONTEND/04 means by "the same renderer", and it is what makes the preview an
// honest preview rather than a second implementation that drifts.

export { TemplateRenderer } from "./TemplateRenderer.js";
export { SectionBoundary } from "./SectionBoundary.js";
export { COMPONENT_REGISTRY, resolveComponent } from "./registry.js";
export { resolveSectionData, readPath } from "./resolve-data.js";
export { mergeTheme, themeToCustomProperties } from "./theme.js";
export type {
  RenderMode,
  SectionComponent,
  SectionDefinition,
  SectionErrorReport,
  SectionProps,
  SectionRenderIssue,
  TemplateRendererProps,
  TemplateVersionDefinition,
} from "./types.js";
