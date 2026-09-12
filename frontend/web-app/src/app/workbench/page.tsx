import type { Metadata } from "next";

import {
  AvatarStory,
  BadgeStory,
  ButtonStory,
  CardStory,
  DropzoneStory,
  FieldStory,
  OverlayStory,
  SkeletonStory,
  StepperStory,
  TableStory,
  TabsStory,
} from "./stories";
import { EditorLayoutStory } from "./editor-layout-story";

/**
 * P0-22 — the workbench route.
 *
 * Every component in every state, on one page, so `e2e/tests/workbench.e2e.ts` can run
 * axe over each `[data-story]` section in a real browser -- which is the only place
 * `color-contrast` can run at all, because jsdom has no layout engine.
 *
 * A component that is not rendered here is a component the browser accessibility pass
 * never sees. That is the one rule this page has.
 */
export const metadata: Metadata = {
  title: "Workbench",
  robots: { index: false, follow: false },
};

export default function WorkbenchPage() {
  return (
    <main id="main" className="mx-auto flex max-w-page flex-col gap-10 p-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-display font-bold">Workbench</h1>
        <p className="text-body-lg text-text-muted">
          Setiap komponen @wi/ui dalam setiap keadaan. Halaman ini diaudit
          dengan axe pada setiap bagian.
        </p>
      </header>

      <EditorLayoutStory />
      <ButtonStory />
      <FieldStory />
      <DropzoneStory />
      <BadgeStory />
      <CardStory />
      <TabsStory />
      <TableStory />
      <StepperStory />
      <SkeletonStory />
      <AvatarStory />
      <OverlayStory />
    </main>
  );
}
