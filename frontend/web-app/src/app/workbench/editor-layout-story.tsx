"use client";

import { Story } from "./stories";

/**
 * P2-05, DF-11 — the editor's three-column layout, in a real browser.
 *
 * ## Why this story exists
 *
 * `P1-22` shipped the editor shell with a note that its desktop layout was untested, and
 * said why: **jsdom evaluates no media queries**, so every one of the editor's component
 * tests asserts the mobile arrangement — three panels collapsed into tabs — and the
 * `md:` three-column layout has never been executed by anything. `P1-25` inherited the
 * gap, could not discharge it because no user could reach an editor route, and recorded
 * it as DF-11.
 *
 * It is discharged here rather than at `/editor/:id` because reaching that route needs a
 * session, an invitation and a published template, and a Playwright test that sets all
 * three up is a test about fixtures. What DF-11 actually asks is whether **three panels
 * are simultaneously visible at a desktop viewport**, and that is a CSS question about
 * the shell.
 *
 * ## What it is not
 *
 * Not the real editor. These are three plain panels carrying the same Tailwind classes
 * the shell applies, so the browser evaluates the same breakpoints against the same
 * widths. It proves the layout; it does not prove the editor's behaviour, which is what
 * `editor-shell.spec.tsx` and `live-preview.spec.tsx` are for.
 *
 * That limitation is the reason this file says so at length rather than looking like a
 * finished demo. A future reader deciding whether DF-11 is really closed should be able to
 * see exactly what was and was not checked.
 */
export function EditorLayoutStory() {
  return (
    <Story
      name="editor-layout"
      title="Editor — tata letak tiga kolom"
      description="Di atas breakpoint md, ketiga panel terlihat bersamaan. Di bawahnya, panel menjadi tab."
    >
      {/* The same structure and the same classes as `EditorShell`'s panel row. */}
      <div
        data-editor-layout="true"
        className="min-h-0 flex-1 md:flex"
        style={{ minHeight: "12rem" }}
      >
        {/*
         * The `hidden` CLASS plus `md:block`, mirroring `EditorShell`'s `Panel` exactly.
         *
         * Not the `hidden` attribute: Tailwind v4's preflight gives that
         * `display:none!important`, and for important declarations the cascade reverses
         * layer order -- so no utility in the `utilities` layer can override it, not even
         * `md:block!`. That is the bug DF-11 uncovered in the shell, and this story is
         * what executes the fix in a browser.
         */}
        <div
          data-panel="sections"
          className="hidden border-border md:block md:w-60 md:shrink-0 md:border-r"
        >
          <div className="p-4 text-sm text-text-muted">Daftar bagian</div>
        </div>

        <div
          data-panel="preview"
          className="hidden md:block md:min-w-0 md:flex-1"
        >
          <div className="p-4 text-sm text-text-muted">Pratinjau</div>
        </div>

        <div
          data-panel="properties"
          className="hidden border-border md:block md:w-80 md:shrink-0 md:border-l"
        >
          <div className="p-4 text-sm text-text-muted">Isian</div>
        </div>
      </div>
    </Story>
  );
}
