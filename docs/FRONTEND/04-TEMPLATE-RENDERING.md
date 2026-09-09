# 04 - Template Rendering (Generic Renderer)

The technical core of the "data-driven template" principle (PLAN/07). This renderer is used TOGETHER by: the Live Preview (Editor), the Public Invitation page, and the Demo page (catalog).

## Renderer Architecture
```
<TemplateRenderer
  templateVersion={templateVersionData}   // sections[], theme
  invitationData={invitationData}          // structure per PLAN/08
  mode="live" | "public" | "demo"
/>
```

## Render Flow
1. Iterate over `templateVersion.sections` in order.
2. For each section: skip it if `enabled_sections` (from `invitation_settings`) doesn't include that `section_key` (unless `configurable: false`, in which case the section must always show).
3. Resolve the `component` name (e.g., `"GalleryGrid"`) to the actual React component via a registry (`COMPONENT_REGISTRY['GalleryGrid']`).
4. Extract the relevant data subset from `invitationData` per the section's `required_fields`/`optional_fields` (a dot-notation resolver, e.g., `gallery.photos`).
5. Render the component with props: `data`, `theme` (merged from `templateVersion.theme` + `invitation_settings.theme_override`), `layoutVariant`.

## Component Registry
```ts
const COMPONENT_REGISTRY: Record<string, React.ComponentType<SectionProps>> = {
  HeroClassic: HeroClassicSection,
  GalleryGrid: GalleryGridSection,
  GalleryCarousel: GalleryCarouselSection,
  EventCardDouble: EventCardDoubleSection,
  // ... a new component per breaking-change version: GalleryGridV2, etc. (PLAN/07 § Backward Compatibility)
};
```

## Per-Section Error Boundary
- Each section is wrapped in its own individual error boundary (see 08-ERROR-BOUNDARIES.md) — if one section fails to render (corrupt data/missing component), other sections still render normally, instead of crashing the entire page.

## Theme Application
- Theme variables (color, font) are applied via CSS variables at the TemplateRenderer's root, consumed by components via `var(--color-primary)` etc. — allowing overrides without re-rendering the entire tree.

## Mode Differences
| Mode | Difference |
|---|---|
| `live` (editor preview) | Data from local state (not necessarily saved yet), no analytics tracking, no actual RSVP submission |
| `public` | Data from the public API, RSVP/guestbook functionally active, active analytics view counter |
| `demo` | Dummy data from the template, no active submission interaction (disabled/dummy handler) |
