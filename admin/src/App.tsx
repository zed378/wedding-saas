import { Badge, Card, CardHeader } from "@wi/ui";

/**
 * P0-22 — the admin shell.
 *
 * Deliberately one screen. `P5` builds the admin panel; what this proves is that the
 * third surface builds, serves a page, and renders the same design system from the same
 * tokens as the other two.
 */
export function App() {
  return (
    <main
      id="main"
      className="mx-auto flex max-w-page flex-col gap-8 p-6 text-text"
    >
      <header className="flex flex-col gap-2">
        <h1 className="text-display font-bold">Admin</h1>
        <p className="text-body-lg text-text-muted">
          Kerangka panel admin. Fitur dibangun pada Fase 5.
        </p>
      </header>

      <Card>
        <CardHeader
          title="Batas kepercayaan terpisah"
          description="Hostname sendiri, sesi sendiri (docs/SECURITY/02)."
          actions={<Badge tone="primary">Fase 0</Badge>}
        />
        <p className="text-body">
          Panel ini memakai sistem desain yang sama dengan aplikasi, tetapi
          tidak berbagi sesi dengannya.
        </p>
      </Card>
    </main>
  );
}
