"use client";

import { useState, type ReactNode } from "react";

import { ConflictWarning, SaveStatusIndicator } from "./SaveStatus";
import { SectionListPanel } from "./SectionListPanel";
import { PanelBoundary } from "../components/PanelBoundary";

/**
 * P1-22 step 1 — the editor layout. `docs/UI-UX/09` § Editor Layout, `docs/UI-UX/12`.
 *
 * Desktop is the three columns the document specifies: 240px section list, a flexible centre,
 * 320px properties panel. Mobile is **tab switching**, not three stacked columns — `docs/UI-UX/09`
 * says so explicitly, and the reason is that three stacked panels put the preview a full
 * screen-height below the form it is meant to be showing.
 *
 * ## One tree, two layouts
 *
 * The panels are rendered once and shown or hidden by CSS at the breakpoint, rather than
 * mounted twice. Two trees would mean two editor states to keep in step — which is the exact
 * failure `docs/FRONTEND/02` § Principles warns about, arriving through the layout instead of
 * through the store.
 *
 * The tab buttons therefore exist only below the breakpoint, and they are `hidden` rather
 * than absent on desktop so the markup does not change between widths.
 */

export type EditorTab = "sections" | "preview" | "properties";

export interface EditorShellProps {
  readonly title: string;
  readonly preview: ReactNode;
  readonly properties: ReactNode;
  /** Back to the dashboard. */
  readonly dashboardHref: string;
}

const TABS: readonly { readonly id: EditorTab; readonly label: string }[] = [
  { id: "sections", label: "Bagian" },
  { id: "preview", label: "Pratinjau" },
  { id: "properties", label: "Isian" },
];

export function EditorShell({
  title,
  preview,
  properties,
  dashboardHref,
}: EditorShellProps) {
  const [tab, setTab] = useState<EditorTab>("properties");

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <a
            className="focus-ring rounded-md px-2 py-1 text-sm font-medium text-text-muted underline"
            href={dashboardHref}
          >
            Dasbor
          </a>
          <h1 className="truncate text-base font-semibold text-text">
            {title}
          </h1>
        </div>

        {/* The status indicator lives in the header, as `docs/UI-UX/12` specifies: visible
            from every panel, at every width, without scrolling. */}
        <SaveStatusIndicator />
      </header>

      {/*
       * Outside the panels, and that is the point. It lived inside the preview panel first,
       * which meant a user editing on the properties TAB of a phone would never see it — a
       * warning nobody can reach while doing the thing it warns about.
       */}
      <div className="px-4 pt-3">
        <ConflictWarning />
      </div>

      <div className="border-b border-border px-4 py-2 md:hidden">
        {/*
         * Tabs, below the breakpoint only. A `tablist` rather than buttons: the roles are
         * what tell a screen reader that these three switch one region rather than
         * navigating away.
         */}
        <div role="tablist" aria-label="Panel editor" className="flex gap-2">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`tab-${item.id}`}
              aria-selected={tab === item.id}
              aria-controls={`panel-${item.id}`}
              className={
                tab === item.id
                  ? "focus-ring min-h-11 rounded-md bg-primary-600 px-3 text-sm font-medium text-text-inverse"
                  : "focus-ring min-h-11 rounded-md border border-border px-3 text-sm font-medium text-text"
              }
              onClick={() => {
                setTab(item.id);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 md:flex">
        <Panel
          id="sections"
          tab={tab}
          className="border-border md:w-60 md:shrink-0 md:border-r"
        >
          <SectionListPanel />
        </Panel>

        <Panel id="preview" tab={tab} className="md:min-w-0 md:flex-1">
          <div className="h-full overflow-y-auto p-4">
            {/*
             * `docs/FRONTEND/08` § Editor, and `P2-04` step 4: a preview render failure
             * must not remove the properties panel or the user's unsaved data. Without
             * this, one bad render unmounts the whole editor and takes the dirty-field
             * set with it -- losing by a different route exactly what `P1-22` went to
             * some trouble to protect.
             */}
            <PanelBoundary>{preview}</PanelBoundary>
          </div>
        </Panel>

        <Panel
          id="properties"
          tab={tab}
          className="border-border md:w-80 md:shrink-0 md:border-l"
        >
          {/*
           * `id` for the preview's skip link (`P2-05`, `docs/UI-UX/17`). On the panel's
           * scroll container rather than the `Panel` itself, so focusing it also brings
           * the top of the form into view.
           */}
          <div
            id="editor-properties"
            tabIndex={-1}
            className="h-full overflow-y-auto p-4"
          >
            {properties}
          </div>
        </Panel>
      </div>
    </div>
  );
}

/**
 * One panel, hidden by tab below the breakpoint and always shown above it.
 *
 * `hidden` rather than conditional rendering: unmounting a panel on a tab switch would throw
 * away its scroll position and, worse, would unmount a focused input mid-edit on a phone
 * whose keyboard just changed the viewport height.
 */
function Panel({
  id,
  tab,
  className,
  children,
}: {
  readonly id: EditorTab;
  readonly tab: EditorTab;
  readonly className: string;
  readonly children: ReactNode;
}) {
  const active = tab === id;

  return (
    <section
      id={`panel-${id}`}
      role="tabpanel"
      aria-labelledby={`tab-${id}`}
      /*
       * The `hidden` CLASS, not the attribute. This is the whole of a bug the shell
       * shipped with, and the fix took two attempts.
       *
       * `P1-22` wrote `hidden={!active}` with `md:block` to put the panel back above the
       * breakpoint. Tailwind v4's preflight makes that impossible:
       *
       *   [hidden]:where(:not([hidden=until-found])) { display: none !important }
       *
       * so every inactive panel stayed hidden at EVERY width and the three-column desktop
       * layout never worked. Nothing caught it because jsdom evaluates no media queries --
       * exactly the gap `P1-22` recorded and DF-11 was raised to close.
       *
       * `md:block!` was the obvious fix and is also wrong: for **important** declarations
       * the CSS cascade reverses layer order, so preflight's `base` layer beats anything
       * in `utilities`. No utility can win against that rule while it carries
       * `!important`.
       *
       * So: the class. `.hidden{display:none}` and the `md:block` variant are ordinary
       * declarations in the same layer and the variant is emitted second, so it wins
       * above the breakpoint. The class is still `display: none`, so a hidden panel stays
       * out of the accessibility tree on a phone — the property the attribute was chosen
       * for is kept.
       *
       * One consequence: jsdom applies no CSS, so all three panels are in the
       * accessibility tree in unit tests. A query that must mean "the visible panel" has
       * to scope itself to one.
       */
      className={`min-h-0 md:block ${active ? "" : "hidden"} ${className}`}
    >
      {children}
    </section>
  );
}
