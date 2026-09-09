# 03 - Form Architecture

## Approach: Schema-Driven Dynamic Forms
Because the fields that need to be shown in the Editor depend on `template_version.sections[].required_fields/optional_fields` (PLAN/07), forms are NOT hard-coded per section, but generated from canonical field metadata.

## Canonical Field Metadata (example)
```ts
const FIELD_REGISTRY: Record<string, FieldMeta> = {
  'couple.groom.full_name': { type: 'text', label: 'Groom\'s Full Name', maxLength: 150 },
  'couple.groom.photo': { type: 'photo', label: 'Groom\'s Photo' },
  'events.*.date': { type: 'date', label: 'Event Date' },
  'gallery.photos': { type: 'photo-multi', label: 'Photo Gallery', maxItems: 20 },
  // ... fully aligned with PLAN/08-INVITATION-DATA-MODEL.md
};
```
The Properties Panel renders a field component based on the `type` in this registry for every `required_fields`/`optional_fields` requested by the active template.

## Validation
- Client-side validation (fast UX, non-authoritative) uses a schema library (e.g., Zod) whose structure aligns with server-side validation (BACKEND/03-VALIDATION.md) — avoiding duplicated logic that could diverge; ideally the schema is shared/generated from a single source if the stack allows it (e.g., a monorepo shared package).
- Completeness validation for publishing (`required_fields`) is also evaluated client-side for a real-time UI checklist, but the final decision remains with the server on `POST /publish` (the BACKEND is the source of truth, per the fail-closed principle in SECURITY).

## Autosave Integration
- Every field change → updates the local editor state → debounce → triggers a `PATCH` API call to the relevant sub-resource (see API/04-INVITATION-API.md) → updates `saveStatus`.
- Photo/media fields don't go through the regular text-PATCH flow — they're uploaded separately (see 05-MEDIA-HANDLING.md), the field only stores the `media_id` reference after the upload finishes.

## Reusable Field Components
`TextField`, `TextareaField`, `DateField`, `TimeField`, `PhotoField`, `PhotoMultiField`, `SelectField`, `MapPickerField`, `ToggleField` — each handles its own local state & emits changes to the editor store.
