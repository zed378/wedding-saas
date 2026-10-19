import { Card, CardHeader, Badge } from "@wi/ui";

export function AuditLogsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-display font-bold">Log Audit Sistem</h1>
        <p className="mt-1 text-body text-text-muted">
          Catatan kronologis perubahan status, aksi staf, dan jejak keamanan sistem
        </p>
      </div>

      <Card>
        <CardHeader
          title="Audit Trail Administratif"
          description="Rekaman immutable dari tabel audit_logs"
          actions={<Badge tone="neutral">P5-10</Badge>}
        />
        <div className="rounded-md border border-border p-6 text-center text-text-muted">
          Viewer log audit immutable dan filter aksi staf diimplementasikan pada tugas P5-10.
        </div>
      </Card>
    </div>
  );
}
