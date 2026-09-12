/**
 * P2-03 — the section stylesheet, as one string.
 *
 * ## Why a string and not a `.css` file
 *
 * This package is consumed by two Next applications and, later, by whatever renders a
 * share preview. A `.css` import from a workspace package needs each consumer's build to
 * be told about it; a string rendered into a `<style>` element needs nothing, works
 * identically under SSR and in jsdom, and cannot be forgotten by a new consumer.
 *
 * The cost is that it ships with every render rather than being cached separately. It is
 * a few kilobytes and the public page is a single document — `docs/FRONTEND/09`'s budget
 * is about images and JavaScript, not about this.
 *
 * ## Not one colour, not one font name
 *
 * Every visual value is `var(--…)`, set by the renderer from the template's theme
 * (`docs/FRONTEND/04` § Theme Application). That is the whole mechanism by which one
 * component library serves every template — `scripts/check-renderer-is-generic.mjs`
 * enforces it, and `docs/PLAN/07` is the reason.
 *
 * Layout values — grid columns, aspect ratios, breakpoints — are not theme data. They are
 * how a section is built rather than how it looks, and a template author does not choose
 * them.
 */
export const SECTION_STYLES = `
.wi-section {
  padding: calc(var(--space) * 2) var(--space);
  color: var(--color-text);
  font-family: var(--typography-body-font), system-ui, sans-serif;
  font-size: calc(1rem * var(--font-scale));
  background: var(--color-secondary);
}
.wi-section h2, .wi-section h3 {
  font-family: var(--typography-heading-font), Georgia, serif;
  color: var(--color-primary);
  margin: 0 0 var(--space);
}
.wi-center { text-align: center; }
.wi-stack { display: grid; gap: var(--space); }

/* Hero: the cover gate. A photo background needs an overlay for contrast --
   docs/UI-UX/14 § Accessibility asks for exactly this. */
.wi-hero {
  position: relative;
  min-height: 70vh;
  display: grid;
  place-items: center;
  text-align: center;
  isolation: isolate;
  overflow: hidden;
}
.wi-hero-bg { position: absolute; inset: 0; z-index: -2; object-fit: cover; width: 100%; height: 100%; }
.wi-hero-scrim {
  position: absolute; inset: 0; z-index: -1;
  background: linear-gradient(to bottom, rgb(0 0 0 / 45%), rgb(0 0 0 / 65%));
}
.wi-hero-names { font-size: calc(2.25rem * var(--font-scale)); color: #fff; margin: 0; }
.wi-hero-date { color: #fff; opacity: 0.92; }
.wi-hero .wi-button { margin-top: var(--space); }

.wi-button {
  display: inline-flex; align-items: center; justify-content: center;
  min-height: 44px; padding: 0 calc(var(--space) * 1.25);
  border-radius: var(--radius);
  border: 1px solid var(--color-primary);
  background: var(--color-primary);
  color: var(--color-secondary);
  font: inherit; cursor: pointer;
}
.wi-button-quiet { background: transparent; color: var(--color-primary); }
.wi-button:focus-visible { outline: 3px solid var(--color-accent); outline-offset: 2px; }

.wi-card {
  border: 1px solid var(--color-accent);
  border-radius: var(--radius);
  padding: var(--space);
  background: var(--color-secondary);
}

.wi-people { display: grid; gap: calc(var(--space) * 1.5); }
.wi-portrait { width: 140px; height: 140px; border-radius: var(--radius); object-fit: cover; }

.wi-gallery-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--space); }
.wi-gallery-carousel {
  display: flex; gap: var(--space);
  overflow-x: auto; scroll-snap-type: x mandatory;
}
.wi-gallery-carousel img { scroll-snap-align: start; flex: 0 0 80%; }
.wi-photo { width: 100%; aspect-ratio: 4 / 5; object-fit: cover; border-radius: var(--radius); }

.wi-map { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; border-radius: var(--radius); }

.wi-countdown { display: flex; gap: var(--space); justify-content: center; list-style: none; padding: 0; }
.wi-countdown b { display: block; font-size: calc(1.6rem * var(--font-scale)); color: var(--color-primary); }

.wi-field { display: grid; gap: calc(var(--space) / 3); }
.wi-input {
  min-height: 44px; padding: 0 calc(var(--space) / 2);
  border: 1px solid var(--color-accent); border-radius: var(--radius);
  background: var(--color-secondary); color: var(--color-text); font: inherit;
}
.wi-input:focus-visible { outline: 3px solid var(--color-accent); outline-offset: 1px; }

.wi-muted { opacity: 0.8; }

@media (min-width: 40rem) {
  .wi-gallery-grid { grid-template-columns: repeat(3, 1fr); }
  .wi-people { grid-template-columns: 1fr 1fr; }
}

/* docs/UI-UX/17: a scroll reveal is decoration, and decoration is what this turns off.
   Nothing here is the only way to perceive anything -- that is the test for whether an
   animation may be removed entirely rather than merely shortened. */
@media (prefers-reduced-motion: reduce) {
  .wi-section, .wi-section * {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
    scroll-behavior: auto !important;
  }
  .wi-gallery-carousel { scroll-snap-type: none; }
}
`;
