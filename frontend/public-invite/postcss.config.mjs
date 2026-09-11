/**
 * Tailwind v4 is a PostCSS plugin and needs no config file of its own -- the theme
 * lives in `@wi/ui`'s `tokens.css`, which every app imports. That is the whole point of
 * the CSS-first `@theme` block: one declaration of every colour, size and spacing value,
 * shared by three apps that cannot drift from it.
 */
export default {
  plugins: { "@tailwindcss/postcss": {} },
};
