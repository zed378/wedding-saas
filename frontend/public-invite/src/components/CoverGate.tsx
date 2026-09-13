"use client";

import { useRef, useState, type ReactNode } from "react";

/**
 * `P2-10` step 5 — the cover gate. `docs/UI-UX/14` § Section Order 1.
 *
 * *"an 'Open Invitation' button (if there's an opening animation/cover-gate for dramatic
 * effect & to trigger music autoplay with a user gesture — a modern browser
 * requirement)."*
 *
 * ## Why this is not in the hero section
 *
 * `P2-03` put a gate button inside `HeroClassic`, and it did not gate anything: the button
 * hid **itself** on click while every section below it stayed rendered and scrollable. A
 * section cannot gate its siblings — it has no access to them — so the control has to live
 * where the whole invitation does, which is here. The hero's button was removed rather
 * than left as a second, non-functional one.
 *
 * ## Closed by default, and safe without JavaScript
 *
 * The gate renders closed on the server, so the first paint is one readable screen rather
 * than a page mid-scroll. That creates an obvious hazard: with JavaScript unavailable the
 * button cannot work, and a guest would be stuck looking at a cover with a dead control.
 *
 * The `<noscript>` stylesheet below is the answer. Without JavaScript the clip is removed
 * and the button is hidden, so the page is simply the full invitation — no gate, no dead
 * button. With JavaScript the gate behaves as documented.
 *
 * **The content is never removed from the DOM**, only visually contained. A sharing bot
 * reads the HTML (`docs/FRONTEND/07`) and a screen reader reads the document, so hiding
 * the invitation from either of them to achieve a visual effect would be the wrong trade
 * entirely.
 *
 * ## The gesture
 *
 * A real click on a real `<button>` is what a browser accepts as the user gesture that
 * permits audio to start. There is no music section in the catalogue yet — `SECTION_KEYS`
 * has no `music` — so nothing consumes that gesture today; the control exists for the
 * reason `docs/UI-UX/14` gives first, which is that the opening screen should be one
 * screen.
 */
export function CoverGate({ children }: { readonly children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const content = useRef<HTMLDivElement | null>(null);

  return (
    <>
      {/*
       * The stylesheet as markup on the `<noscript>` itself, not as a JSX child.
       *
       * A `<style>` element passed as a child renders on the server and comes out **empty**
       * on the client: the contents of a `noscript` are inert text once scripting is on, so
       * React has nothing to hydrate and jsdom reports no content at all. Setting the
       * element's HTML directly produces the same bytes in both places, which is also what
       * lets a test assert the rule exists.
       */}
      <noscript
        dangerouslySetInnerHTML={{
          __html:
            "<style>" +
            "[data-cover-gate]{max-height:none!important;overflow:visible!important}" +
            "[data-cover-gate-control]{display:none!important}" +
            "</style>",
        }}
      />

      <div
        ref={content}
        data-cover-gate="true"
        data-open={open ? "true" : "false"}
        // Focusable programmatically, never by tabbing. `-1` is what lets the click
        // handler move focus here without inserting a stop in the tab order that a guest
        // would have to pass through on the way into the invitation.
        tabIndex={-1}
        // Clipped, not hidden. `max-h-dvh` plus `overflow-hidden` shows exactly the cover
        // screen; releasing it lets the document grow to its natural height.
        className={
          open ? "" : "max-h-dvh overflow-hidden *:pointer-events-none"
        }
      >
        {children}
      </div>

      {!open && (
        <div
          data-cover-gate-control="true"
          className="sticky bottom-0 z-10 flex justify-center bg-linear-to-t from-white via-white/90 to-transparent px-4 pt-10 pb-8"
        >
          <button
            type="button"
            className="min-h-11 rounded-full bg-neutral-900 px-6 py-2 text-sm font-medium text-white focus-visible:ring-2 focus-visible:ring-neutral-500 focus-visible:ring-offset-2 focus-visible:outline-none"
            onClick={() => {
              setOpen(true);
              /*
               * Focus the invitation so a keyboard or screen-reader user continues from
               * where the content begins. Without this, activating the button leaves focus
               * on an element that has just been removed, and the browser drops focus to
               * the top of the document — which is the one place the guest has already
               * read.
               */
              requestAnimationFrame(() => {
                content.current?.focus();
              });
            }}
          >
            Buka Undangan
          </button>
        </div>
      )}
    </>
  );
}
