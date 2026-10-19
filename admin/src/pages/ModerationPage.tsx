import { Card, CardHeader, Badge } from "@wi/ui";

export function ModerationPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-display font-bold">Antrean Moderasi</h1>
        <p className="mt-1 text-body text-text-muted">
          Penyaringan konten buku tamu, laporan pelanggaran, dan perlindungan platform
        </p>
      </div>

      <Card>
        <CardHeader
          title="Moderasi Global"
          description="Pemeriksaan laporan konten publik dan entri buku tamu bermasalah"
          actions={<Badge tone="neutral">P5-09</Badge>}
        />
        <div className="rounded-md border border-border p-6 text-center text-text-muted">
          Antrean moderasi global dan penindakan konten dilaporkan diimplementasikan pada tugas P5-09.
        </div>
      </Card>
    </div>
  );
}
