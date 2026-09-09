# 03 - Table: templates, template_versions, template_assets

```sql
CREATE TABLE templates (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                 VARCHAR(80) NOT NULL UNIQUE,
  name                  VARCHAR(100) NOT NULL,
  category              VARCHAR(40)[] NOT NULL DEFAULT '{}',
  is_premium            BOOLEAN NOT NULL DEFAULT false,
  thumbnail_url         VARCHAR(500),
  status                VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','deprecated')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE template_versions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id            UUID NOT NULL REFERENCES templates(id) ON DELETE RESTRICT,
  version                VARCHAR(20) NOT NULL,         -- semver, e.g., '1.2.0'
  sections                JSONB NOT NULL,                -- see PLAN/07 § Section System
  theme                   JSONB NOT NULL,                 -- see PLAN/07 § Theme Variables
  customizable_theme_keys VARCHAR(60)[] NOT NULL DEFAULT '{}',
  changelog               TEXT,
  status                  VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','deprecated')),
  released_at             TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (template_id, version)
);
CREATE INDEX idx_template_versions_template ON template_versions(template_id);

CREATE TABLE template_assets (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_version_id     UUID NOT NULL REFERENCES template_versions(id) ON DELETE CASCADE,
  asset_name               VARCHAR(100) NOT NULL,          -- e.g., 'hero-bg.jpg'
  media_id                  UUID REFERENCES media(id),
  purpose                    VARCHAR(40),                    -- 'background' | 'icon' | 'demo-photo'
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## Example `sections` Column Content (JSONB)
```json
[
  { "section_key": "hero", "component": "HeroClassic", "enabled_by_default": true, "configurable": false, "required_fields": ["couple.groom.nickname","couple.bride.nickname"] },
  { "section_key": "gallery", "component": "GalleryGrid", "enabled_by_default": true, "configurable": true, "max_items": 20, "required_fields": ["gallery.photos"], "layout_options": ["grid-3col","carousel"] }
]
```

## Schema Validation
- The `sections` column is validated against a fixed JSON Schema (defined in application code, not in the DB) before being saved — see BACKEND/03-VALIDATION.md.
- The `(template_id, version)` unique constraint ensures no version is duplicated.
