/**
 * P0-20 — the section keys and the renderer components allowed to fill them.
 *
 * `docs/PLAN/07` § Section System lists the ten sections; `docs/FRONTEND/04` § Component
 * Registry resolves a `component` name to a React component through a lookup table. This
 * file is the *names* half of that table, kept here rather than in the renderer so the
 * API can reject a bad definition without importing React.
 *
 * `packages/template-renderer` owes this file a parity test when it exists (`P0-22` /
 * Phase 2): every name here has a component, and every component is named here.
 *
 * ## This list is append-only
 *
 * `docs/PLAN/07` § Backward Compatibility: a breaking change to a component ships as a
 * **new name** (`GalleryGridV2`), never as an edit, "because older template versions
 * explicitly reference the old component name". Removing a name from this list breaks
 * every invitation locked to a version that used it -- and BR-3.1 means those versions
 * are locked forever, by design.
 *
 * That is R5 in `docs/PLAN/18` ("New template breaks old invitations because a shared
 * component was changed"), written as a rule the validator can enforce rather than as a
 * risk someone remembers.
 */

/**
 * The ten sections. `docs/PLAN/07` § Section System.
 *
 * A **closed set**, which is stricter than the document states outright. The reason is
 * `docs/PLAN/07` § Template Compatibility & Migration: switching templates "matches the
 * `section_key` present in both templates". If keys were free text, two templates that
 * both mean "the gallery" but spell it `gallery` and `photos` would silently drop the
 * user's toggles and their section order on switch -- data preserved, presentation
 * scrambled, no error anywhere. Adding a key is a one-line edit here plus a component.
 *
 * Note that `event` is **one** key. `docs/PLAN/07` draws Akad and Reception beneath it,
 * but those are two rows of `invitation_events` (`docs/PLAN/08`: 1..N events), not two
 * sections.
 */
export const SECTION_KEYS = [
  "hero",
  "couple",
  "quote",
  "event",
  "gallery",
  "maps",
  "gift",
  "rsvp",
  "guestbook",
  "closing",
] as const;

export type SectionKey = (typeof SECTION_KEYS)[number];

/**
 * Component name to the one section it renders.
 *
 * Binding a component to a section key is stricter than `docs/PLAN/07` asks for, and it
 * costs nothing. `{ "section_key": "gallery", "component": "HeroClassic" }` passes a
 * name-only check and renders a hero where the gallery belongs -- a definition that is
 * wrong in a way no type and no name check would catch.
 */
export const COMPONENT_REGISTRY: Readonly<Record<string, SectionKey>> = {
  HeroClassic: "hero",
  CoupleProfile: "couple",
  QuoteBanner: "quote",
  EventCardDouble: "event",
  GalleryGrid: "gallery",
  GalleryCarousel: "gallery",
  MapsStatic: "maps",
  GiftAccountList: "gift",
  RsvpForm: "rsvp",
  GuestbookWall: "guestbook",
  ClosingSimple: "closing",
};

export const COMPONENT_NAMES: readonly string[] =
  Object.keys(COMPONENT_REGISTRY);

/** Is this a registered component, for any section? */
export function isRegisteredComponent(name: string): boolean {
  return Object.hasOwn(COMPONENT_REGISTRY, name);
}

/** The section a component renders, or `undefined` if it is not registered. */
export function componentSection(name: string): SectionKey | undefined {
  return isRegisteredComponent(name) ? COMPONENT_REGISTRY[name] : undefined;
}

/** Every component registered for a section, in registry order. */
export function componentsForSection(section: SectionKey): readonly string[] {
  return COMPONENT_NAMES.filter((n) => COMPONENT_REGISTRY[n] === section);
}
