import { Card, CardHeader, Badge } from "@wi/ui";

export function OrdersPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-display font-bold">Pesanan & Pembayaran</h1>
        <p className="mt-1 text-body text-text-muted">
          Pencatatan transaksi paket, rekonsiliasi gateway pembayaran, dan pengembalian dana
        </p>
      </div>

      <Card>
        <CardHeader
          title="Daftar Pesanan"
          description="Monitoring status transaksi Midtrans dan audit pembayaran"
          actions={<Badge tone="neutral">P5-07 / P5-08</Badge>}
        />
        <div className="rounded-md border border-border p-6 text-center text-text-muted">
          Daftar pesanan, status pembayaran server-side, dan alur pengembalian dana manual diimplementasikan pada tugas P5-07 dan P5-08.
        </div>
      </Card>
    </div>
  );
}
