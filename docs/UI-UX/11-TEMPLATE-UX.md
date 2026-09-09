# 11 - Template (Catalog & Detail) UX

## Catalog Page (`/templates`)
- A responsive grid (2 columns mobile, 3-4 columns desktop) containing TemplateCards.
- Sidebar/dropdown filter: category (multi-select), price (Free/Premium), dominant color (optional, based on color tags in the metadata).
- A debounced search bar, searching by name & category.
- Sort: Newest, Most Popular (based on usage count, if data is available).
- Infinite scroll or pagination (choose one, consistent with other list patterns in the app).

## Template Detail Page (`/templates/:slug`)
- Hero: name, category tags, premium badge, the main "Use This Template" button (sticky on mobile so it's always visible while scrolling).
- A carousel of screenshots per section (Hero, Couple, Gallery, etc.) — giving a realistic impression, NOT just a single thumbnail.
- A secondary "View Live Demo" button → opens the public demo page (dummy data) in a new tab, rendered by the SAME renderer as production (not a separately mocked-up static page) — ensures the user's expectations are accurate.
- Info on which sections the template supports (badge list: Hero, Couple, Event, Gallery, Maps, Gift, RSVP, Guestbook, Closing) so users know its capabilities before choosing.

## "Use This Template" Interaction
- If the user already has another draft invitation: ask "Create a new invitation?" vs. an option to switch templates on the existing invitation (if coming from the Editor context, not the initial catalog).
- If not logged in: save the template choice in temporary state (query param/local state), redirect to login/register, and automatically continue the flow after successful auth (don't lose the user's selection).
