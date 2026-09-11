import Link from "next/link";

import { Badge, buttonClassName, Card, CardHeader } from "@wi/ui";

/**
 * P0-22 — the shell's one real page.
 *
 * Deliberately thin. `P1` builds marketing, auth, the dashboard, the editor and
 * checkout; what this proves is the thing the DoD asks for -- that the app builds,
 * serves a page, and renders the design system from the shared package with the shared
 * tokens.
 */
export default function HomePage() {
  return (
    <main id="main" className="mx-auto flex max-w-page flex-col gap-8 p-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-display font-bold">Undangan Digital</h1>
        <p className="text-body-lg text-text-muted">
          Kerangka aplikasi. Fitur dibangun pada Fase 1.
        </p>
      </header>

      <Card>
        <CardHeader
          title="Status"
          description="Apa yang sudah ada di fondasi ini."
          actions={<Badge tone="primary">Fase 0</Badge>}
        />
        <ul className="flex list-disc flex-col gap-1 pl-5 text-body">
          <li>Desain token dan pustaka komponen (@wi/ui)</li>
          <li>Klien API dengan penanganan galat terpusat (@wi/api-client)</li>
          <li>Skema template dan resolver (@wi/schema)</li>
        </ul>
      </Card>

      <div className="flex flex-wrap gap-3">
        {/*
         * A Link, not a Button wrapping a Link. It navigates, so it has to be an
         * anchor -- see buttonClassName() in @wi/ui.
         */}
        <Link href="/workbench" className={buttonClassName()}>
          Lihat komponen
        </Link>
      </div>
    </main>
  );
}
