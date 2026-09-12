# 03 - Template API

## Public/Authenticated (read catalog)
```
GET    /api/v1/templates                    ?category=&search=&is_premium=&page=
GET    /api/v1/templates/:slug               Detail of the template + latest published version
GET    /api/v1/templates/:slug/versions/:version   Detail of a specific version (for preview/demo)
```

## Admin (CRUD — see also 09-ADMIN-API.md)
```
POST   /api/v1/admin/templates                        Create a new template (draft)
PATCH  /api/v1/admin/templates/:id                     Update metadata
POST   /api/v1/admin/templates/:id/versions             Create a new version (draft)
PATCH  /api/v1/admin/templates/:id/versions/:vid        Update the version definition (sections, theme)
POST   /api/v1/admin/templates/:id/versions/:vid/publish
POST   /api/v1/admin/templates/:id/versions/:vid/deprecate
DELETE /api/v1/admin/templates/:id                       (only if never used by any invitation)
```

## Example Response — GET /templates/:slug
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "slug": "elegant-rose",
    "name": "Elegant Rose",
    "category": ["modern", "floral"],
    "is_premium": true,
    "thumbnail_url": "https://cdn.../thumb.jpg",
    "supported_sections": ["hero", "couple", "gallery"],
    "current_version": {
      "id": "uuid",
      "version": "1.2.0",
      "sections": [
        { "section_key": "hero", "component": "HeroClassic", "required_fields": ["couple.groom.nickname","couple.bride.nickname"] },
        { "section_key": "gallery", "component": "GalleryGrid", "max_items": 20, "required_fields": ["gallery.photos"] }
      ],
      "theme": { "colors": { "primary": "#8B5E3C" }, "typography": { "heading_font": "Playfair Display" } },
      "customizable_theme_keys": ["colors.primary"],
      "status": "published"
    }
  }
}
```

## Important Rules
- `GET /templates` only returns templates whose version has `status = published` (deprecated/draft versions are hidden from the public catalog) — per BR-3.3.
- The admin endpoint for publishing a new version does NOT change the `template_version_id` already locked by existing invitations (BR-3.1) — old invitations continue to render the old version until the user explicitly upgrades.
- `supported_sections` is the badge list UI-UX/11 § Template Detail Page asks for ("Info on which sections the template supports"). It is **derived** from `current_version.sections`, in the canonical section order from the component registry — not stored separately, because a second copy would be one more thing to keep in step and the two disagreeing would show a "Guestbook" badge on a template with no guestbook. Added by P2-01 (ADR-059).
- `current_version.status` is present so a preview or demo surface can say which version it is showing. On `GET /templates/:slug` it is always `published`; on `GET /templates/:slug/versions/:version` it may be `deprecated`. Added by P2-01 (ADR-059).
- `GET /templates/:slug/versions/:version` serves `published` and `deprecated` versions, never a `draft` one. A deprecated version was released and invitations are locked to it; a draft never was, and serving one would let anyone holding the URL preview unreleased work.
- The three catalog reads do **not** require a session. UI-UX/11 § "Use This Template" specifies that a visitor browses the catalog and is redirected to register only once they choose — so a 401 here would block exactly the people the catalog exists for. They are rate limited per IP on the `general-public` policy (ADR-059).
- The `sections[].required_fields` response schema uses dot-notation referring to the canonical structure in PLAN/08-INVITATION-DATA-MODEL.md, used by the frontend for dynamic validation in the Editor without hard-coding per template.
