import { Card, CardHeader, Badge } from "@wi/ui";

export function UsersPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-display font-bold">Manajemen Pengguna</h1>
        <p className="mt-1 text-body text-text-muted">
          Daftar akun pengguna, status verifikasi, dan penangguhan akses
        </p>
      </div>

      <Card>
        <CardHeader
          title="Daftar Pengguna"
          description="Pencarian dan peninjauan akun terdaftar"
          actions={<Badge tone="neutral">P5-03</Badge>}
        />
        <div className="rounded-md border border-border p-6 text-center text-text-muted">
          Modul manajemen pengguna dan penangguhan akun (suspension) diimplementasikan pada tugas P5-03.
        </div>
      </Card>
    </div>
  );
}
