import { Card, CardHeader, Badge } from "@wi/ui";

export function TemplatesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-display font-bold">Katalog Templat</h1>
        <p className="mt-1 text-body text-text-muted">
          Manajemen katalog templat, skema versi, dan status publikasi
        </p>
      </div>

      <Card>
        <CardHeader
          title="Manajemen Templat & Versi"
          description="Rilis dan penonaktifan templat undangan"
          actions={<Badge tone="neutral">P5-04 / P5-05</Badge>}
        />
        <div className="rounded-md border border-border p-6 text-center text-text-muted">
          Penyuntingan metadata templat, manajemen versi JSONB, dan validasi skema diimplementasikan pada tugas P5-04 dan P5-05.
        </div>
      </Card>
    </div>
  );
}
