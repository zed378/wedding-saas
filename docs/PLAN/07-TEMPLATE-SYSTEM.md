# 07 - Template System

A template is a **versioned, data-driven presentation layer** on top of the Invitation domain — NOT a collection of hard-coded HTML pages per theme. This is the single most critical document for the product's architecture.

## Core Principles
1. One generic renderer codebase reads the `template_definition` (JSON/schema) + `invitation_data`, then renders section by section.
2. Templates MUST NOT have their own application logic (no per-template backend code). Visual differences between templates = differences in component sets + theme variables + layout config — all data, not code.
3. Templates are versioned (`template_versions`). An invitation locks onto one specific version when selected (BR-3.1 in 02-BUSINESS-RULES.md).

## Template Metadata
```json
{
  "template_id": "uuid",
  "slug": "elegant-rose",
  "name": "Elegant Rose",
  "category": ["modern", "floral"],
  "is_premium": true,
  "thumbnail_url": "...",
  "status": "published" // draft | published | deprecated
}
```

## Template Version
```json
{
  "template_version_id": "uuid",
  "template_id": "uuid",
  "version": "1.2.0",
  "released_at": "2026-01-10",
  "changelog": "...",
  "sections": [ /* see Section System */ ],
  "theme": { /* see Theme Variables */ },
  "status": "published" // draft | published | deprecated
}
```

## Section System
Each template version defines the supported section order & configuration:
```
Template
 ├── Hero
 ├── Couple
 ├── Quote
 ├── Event
 │    ├── Akad (Ceremony)
 │    └── Reception
 ├── Gallery
 ├── Maps
 ├── Gift
 ├── RSVP
 ├── Guestbook
 └── Closing
```

Definition per section:
```json
{
  "section_key": "gallery",
  "component": "GalleryGrid",       // component name in the renderer library
  "enabled_by_default": true,
  "configurable": true,             // user can toggle on/off
  "max_items": 20,
  "required_fields": ["photos"],
  "optional_fields": ["caption"],
  "layout_variant": "grid-3col"     // layout choice within the same component
}
```

## Required vs Optional Fields
- `required_fields`: publish is blocked if these are empty (see BR-4.2).
- `optional_fields`: may be empty, the component hides sub-elements if empty (e.g., gallery caption).
- Field mapping refers to the canonical schema in 08-INVITATION-DATA-MODEL.md — templates do NOT define a new data structure, only select which subset of fields to use and how to display them.

## Theme Variables
```json
{
  "colors": { "primary": "#8B5E3C", "secondary": "#F4EDE4", "accent": "#C9A876", "text": "#2B2B2B" },
  "typography": { "heading_font": "Playfair Display", "body_font": "Lato", "scale": "default" },
  "spacing": "comfortable", // compact | comfortable | spacious
  "border_radius": "rounded"
}
```
Users can override a limited subset (e.g., `primary` color) — the customization boundary is defined per template (`customizable_theme_keys`).

## Layout & Component Configuration
- Each section may have more than one `layout_variant` (e.g., gallery grid vs carousel), selectable by the user if the template allows it (`layout_options: ["grid-3col","carousel"]`).
- The component library is shared across templates (the `GalleryGrid` component is used by many templates with different themes).

## Template Compatibility & Migration
- When a user switches templates (see the rule in 02-BUSINESS-RULES.md), the system matches the `section_key` present in both templates. Sections with the same `section_key` are automatically mapped to data. Unrecognized sections are hidden, not deleted (backward-safe).

## Demo Data

The catalogue's public demo (UI-UX/11) and the admin's template preview both need realistic invitation content. That content is a **seeded invitation owned by a system account**, not a separate fixture format: it lives in the same tables as any other invitation, and the demo renders through the production renderer reading the production public API shape.

The alternative — a JSON fixture rendered by a demo-only path — was rejected because it drifts. A demo that renders through a second code path stops resembling the product the moment either side changes, and UI-UX/11 is explicit that the demo must set accurate expectations before a user commits to a template.

The demo invitation is never publicly listed, is excluded from admin dashboard counts, and is refreshed by the same seed command that installs the reference template.

## Template Preview & Publishing (Admin flow)
1. Admin creates a draft template (uploads assets, defines the schema via an internal CMS/editor).
2. Admin previews it with the seeded demo invitation above.
3. Admin publishes the version → visible in the catalog for new invitations.
4. Admin can deprecate an old version: it no longer appears in the catalog for new invitations, but is still rendered for existing invitations that had already locked onto that version (BR-3.3).

## Backward Compatibility
- A breaking change to the renderer (e.g., the `GalleryGrid` component gets a total redesign) MUST be implemented as a new component (`GalleryGridV2`), not by modifying the old component — because older template versions explicitly reference the old component name.
