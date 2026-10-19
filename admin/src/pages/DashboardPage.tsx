import { Card, CardHeader, Badge } from "@wi/ui";

export function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-display font-bold">Ringkasan Sistem</h1>
        <p className="mt-1 text-body text-text-muted">
          Metrik operasional, performa undangan, dan ringkasan aktivitas platform
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader
            title="Total Pengguna"
            description="Semua akun terdaftar"
            actions={<Badge tone="neutral">Users</Badge>}
          />
          <div className="mt-2 text-h1 font-bold text-text">—</div>
          <p className="mt-1 text-body-sm text-text-muted">Diperbarui secara real-time</p>
        </Card>

        <Card>
          <CardHeader
            title="Undangan Aktif"
            description="Status published"
            actions={<Badge tone="primary">Live</Badge>}
          />
          <div className="mt-2 text-h1 font-bold text-text">—</div>
          <p className="mt-1 text-body-sm text-text-muted">Subdomain aktif</p>
        </Card>

        <Card>
          <CardHeader
            title="Pesanan Sukses"
            description="Transaksi lunas"
            actions={<Badge tone="success">Orders</Badge>}
          />
          <div className="mt-2 text-h1 font-bold text-text">—</div>
          <p className="mt-1 text-body-sm text-text-muted">Bulan berjalan</p>
        </Card>

        <Card>
          <CardHeader
            title="Antrean Moderasi"
            description="Buku tamu pending"
            actions={<Badge tone="warning">Queue</Badge>}
          />
          <div className="mt-2 text-h1 font-bold text-text">—</div>
          <p className="mt-1 text-body-sm text-text-muted">Menunggu review</p>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Aktivitas Terbaru"
          description="Aksi administratif dan transaksi terakhir"
        />
        <p className="text-body text-text-muted">
          Metrik KPI lengkap dan visualisasi data akan dihubungkan pada modul operasional Phase 5.
        </p>
      </Card>
    </div>
  );
}
