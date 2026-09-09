# 08 - Invitation Data Model

The core document — the canonical invitation data schema, independent of the template (the template only "selects & displays" a subset of this data). See DATABASE/00-DATA-MODEL.md for the mapping to physical tables.

## Domain Overview
```
User
 └── Invitation
       ├── Couple
       │    ├── Groom (Person)
       │    └── Bride (Person)
       ├── Parents
       │    ├── Groom's Parents
       │    └── Bride's Parents
       ├── Events (Event[])
       │    ├── Akad (Ceremony)
       │    └── Reception
       ├── Locations (attached to Event)
       ├── Gallery (Photo[])
       ├── Bank Accounts (BankAccount[])
       ├── Quote
       ├── RSVP (Rsvp[])
       ├── Guestbook (GuestbookEntry[])
       └── Settings (section toggles, theme override, slug, expiry)
```

## Entity: Person (Bride/Groom — used for both Groom & Bride)
```
Person
├── full_name        string, required
├── nickname          string, required
├── photo             media_ref, optional
├── instagram         string, optional
├── father_name       string, optional
├── mother_name       string, optional
└── child_order       string, optional (e.g., "First child of 2 siblings")
```

## Entity: Event
```
Event
├── type              enum: akad | reception | custom
├── title              string
├── date               date, required
├── start_time         time, required
├── end_time           time, optional
├── venue_name         string, required
├── address            text, required
├── latitude           decimal, optional
├── longitude          decimal, optional
├── maps_url           string, optional (auto-generated from lat/long if empty)
└── description         text, optional
```
An invitation can have 1..N Events (default 2: Akad + Reception, but the architecture supports N custom events, e.g., a post-wedding reception).

## Entity: Photo (Gallery)
```
Photo
├── media_id           ref to the media table
├── caption            string, optional
├── order               int (for reordering)
└── is_cover            boolean (main/hero photo)
```

## Entity: BankAccount
```
BankAccount
├── type               enum: bank | ewallet
├── provider_name      string (e.g., BCA, GoPay)
├── account_number     string
├── account_holder     string
└── order               int
```

## Entity: Rsvp
```
Rsvp
├── guest_name         string, required
├── attendance_status  enum: attending | not_attending | maybe
├── guest_count         int, default 1
├── message             text, optional
└── submitted_at        timestamp
```

## Entity: GuestbookEntry
```
GuestbookEntry
├── guest_name         string, required
├── message             text, required
├── status              enum: pending | approved | rejected
└── submitted_at        timestamp
```

## Entity: Settings
```
Settings
├── slug                string, unique
├── template_id / template_version_id
├── enabled_sections    string[] (subset of the section_key values supported by the template)
├── theme_override      json (subset of customizable_theme_keys)
├── rsvp_enabled        boolean
├── guestbook_enabled   boolean
├── guestbook_moderation boolean
├── expiry_date         date
└── status              enum (see 06-INVITATION-LIFECYCLE.md)
```

### Where Settings Fields Physically Live

`Settings` above is the **domain** grouping — what the user thinks of as one settings screen. It does not map to one table:

| Domain field | Physical location | Why |
|---|---|---|
| `slug`, `expiry_date`, `template_id`, `template_version_id`, `status` | `invitations` (DATABASE/04) | Identity and lifecycle fields. They are queried on the public request path (`WHERE slug = ? AND status = 'published'`) and joined against by orders and jobs; putting them behind a second table would add a join to the hottest query in the product |
| `enabled_sections`, `theme_override`, `rsvp_enabled`, `guestbook_enabled`, `guestbook_moderation`, `seo_indexable` | `invitation_settings` (DATABASE/04) | Presentation and behaviour toggles, read together, changed together |

The API keeps the domain grouping: `PATCH /invitations/:id/settings` accepts `slug` alongside the toggles (API/04) and the service writes to whichever table owns the column. Users should not have to know the schema to change a setting.

## Design Principles
- **Do not hard-code fields into the frontend.** The frontend reads the list of fields to display from `template_definition.sections[].required_fields/optional_fields`, not from hard-coded per-component assumptions.
- Invitation data is the **single source of truth**; the Template is only the presentation layer. Changing the template does NOT change/delete data.
- All free-text fields MUST go through HTML/script sanitization before being stored and before being rendered publicly (see SECURITY/08-API-SECURITY.md — stored XSS prevention).
- `Quote` is a simple entity: `{ text: string, source: string|null }`.

## Validation
- Structural validation (type, length, format) is performed in the backend (BACKEND/03-VALIDATION.md), NOT only in the frontend.
- "Required for publish" validation is different from "required in the DB schema" — a DB column may be nullable, but the `POST /invitations/:id/publish` endpoint validates completeness according to the `required_fields` of the active template (see BR-4.2).
