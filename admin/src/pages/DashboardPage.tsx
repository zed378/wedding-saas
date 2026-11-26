import { useEffect, useState } from "react";
import { ApiClient, accessTokenStore } from "@wi/api-client";
import { Button, Card, CardHeader } from "@wi/ui";
import {
  conversion,
  rupiah,
  type DashboardSummary,
} from "./dashboard-model.js";

function Bars({
  title,
  data,
  valueLabel,
}: {
  title: string;
  data: Array<{ label: string; value: bigint; display: string }>;
  valueLabel: string;
}) {
  const maximum = data.reduce(
    (current, datum) => (datum.value > current ? datum.value : current),
    1n,
  );
  return (
    <figure>
      <figcaption className="mb-3 font-semibold">{title}</figcaption>
      <svg
        viewBox="0 0 660 200"
        role="img"
        aria-label={title}
        className="w-full"
      >
        <line
          x1="35"
          y1="166"
          x2="650"
          y2="166"
          stroke="currentColor"
          opacity=".3"
        />
        <text x="26" y="170" textAnchor="end" fill="currentColor" fontSize="12">
          0
        </text>
        {data.map((d, i) => {
          const slot = 610 / data.length,
            height = Number((d.value * 14_000n) / maximum) / 100;
          return (
            <g key={d.label}>
              <rect
                x={40 + i * slot}
                y={166 - height}
                width={Math.max(2, slot - 7)}
                height={height}
                fill="currentColor"
                className="text-primary"
              >
                <title>
                  {d.label}: {d.display}
                </title>
              </rect>
              {(data.length <= 6 || i % 7 === 0 || i === data.length - 1) && (
                <text
                  x={40 + i * slot}
                  y="190"
                  fill="currentColor"
                  fontSize="11"
                >
                  {d.label.slice(-5)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <details className="mt-2 text-body-sm">
        <summary>Lihat data {title.toLowerCase()}</summary>
        <table className="mt-2 w-full text-left tabular-nums">
          <thead>
            <tr>
              <th scope="col">Periode (UTC)</th>
              <th scope="col">{valueLabel}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.label}>
                <th scope="row">{d.label}</th>
                <td>{d.display}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

export function DashboardPage() {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const client = new ApiClient({
      baseUrl:
        window.location.hostname === "localhost"
          ? "http://localhost:3000"
          : window.location.origin,
      tokenStore: accessTokenStore,
    });
    setError(false);
    const fetchSummary = async () => {
      try {
        const result = await client.get<DashboardSummary>(
          "/api/v1/admin/dashboard/summary",
          { signal: controller.signal },
        );
        if (!controller.signal.aborted) setData(result.data);
      } catch {
        if (!controller.signal.aborted) setError(true);
      }
    };
    void fetchSummary();
    const interval = window.setInterval(() => {
      void fetchSummary();
    }, 60_000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [refresh]);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-display font-bold">Ringkasan Sistem</h1>
          <p className="text-text-muted">
            Metrik operasional platform. Periode harian dan bulanan memakai UTC.
          </p>
        </div>
        <Button variant="secondary" onClick={() => setRefresh((n) => n + 1)}>
          Muat ulang
        </Button>
      </div>
      {error && (
        <div role="alert">
          Ringkasan gagal dimuat. Coba muat ulang.
          {data && " Data terakhir masih ditampilkan."}
        </div>
      )}
      {!data && !error && <p role="status">Memuat ringkasan…</p>}
      {data && (
        <>
          <p className="text-body-sm text-text-muted">
            Diperbarui:{" "}
            {new Date(data.generated_at).toLocaleString("id-ID", {
              timeZone: "UTC",
            })}{" "}
            UTC. Cache maksimal 30 detik; disegarkan tiap menit.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              ["Total Pengguna", String(data.total_users)],
              ["Total Undangan", String(data.total_invitations)],
              ["Pesanan Lunas", String(data.paid_orders)],
              ["Pendapatan Tersimpan", rupiah(data.total_revenue)],
              ["Pendapatan Hari Ini", rupiah(data.daily_revenue)],
              ["Pendapatan Bulan Ini", rupiah(data.monthly_revenue)],
            ].map(([label, value]) => (
              <Card key={label}>
                <CardHeader title={label!} />
                <p className="mt-2 break-words text-h2 font-bold tabular-nums">
                  {value}
                </p>
              </Card>
            ))}
          </div>
          <p className="text-body-sm text-text-muted">
            Pendapatan = orders.amount_total berstatus paid, berdasarkan tanggal
            pesanan dibuat (created_at), bukan tanggal penyelesaian pembayaran.
            Refunded tidak dihitung; sebelum biaya penyedia pembayaran.
          </p>
          <Card>
            <CardHeader
              title="Undangan per Status"
              description="Undangan yang dihapus tidak dihitung."
            />
            {data.invitations_by_status.length === 0 ? (
              <p>Belum ada undangan.</p>
            ) : (
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {data.invitations_by_status.map((s) => (
                  <div key={s.status}>
                    <dt>{s.status}</dt>
                    <dd className="text-h2 tabular-nums">{s.count}</dd>
                  </div>
                ))}
              </dl>
            )}
          </Card>
          <Card>
            <CardHeader
              title="Funnel Draft → Paid → Published"
              description="Kumulatif undangan yang belum dihapus."
            />
            <ol className="grid gap-4 sm:grid-cols-3">
              {[
                ["Dibuat (draft awal)", data.funnel.created],
                ["Pernah lunas", data.funnel.ever_paid],
                ["Pernah terbit dan membeli", data.funnel.paid_and_published],
              ].map(([label, count]) => (
                <li key={label as string}>
                  <p>{label}</p>
                  <p className="text-h2 tabular-nums">
                    {count}{" "}
                    <span className="text-body-sm">
                      ({conversion(count as number, data.funnel.created)} dari
                      dibuat)
                    </span>
                  </p>
                </li>
              ))}
            </ol>
            <p className="mt-3 text-body-sm text-text-muted">
              Pernah lunas mencakup paid dan refunded; tahap terbit hanya
              undangan tersebut yang punya published_at. Uji coba tanpa
              pembelian tidak dihitung. Ini bukan atribusi urutan pembayaran dan
              publikasi.
            </p>
          </Card>
          <div className="grid gap-6 lg:grid-cols-3">
            <Card>
              <Bars
                title="Pesanan 30 Hari Terakhir"
                valueLabel="Pesanan"
                data={data.orders_by_day.map((d) => ({
                  label: d.date,
                  value: BigInt(d.count),
                  display: String(d.count),
                }))}
              />
              <p className="text-body-sm">
                Semua status, berdasarkan tanggal dibuat.
              </p>
            </Card>
            <Card>
              <Bars
                title="Pendapatan 30 Hari Terakhir"
                valueLabel="Pendapatan"
                data={data.orders_by_day.map((d) => ({
                  label: d.date,
                  value: BigInt(d.revenue),
                  display: rupiah(d.revenue),
                }))}
              />
              <p className="text-body-sm">
                Pesanan berstatus paid, berdasarkan tanggal dibuat.
              </p>
            </Card>
            <Card>
              <Bars
                title="Pendapatan 6 Bulan Terakhir"
                valueLabel="Pendapatan"
                data={data.revenue_by_month.map((d) => ({
                  label: d.month,
                  value: BigInt(d.revenue),
                  display: rupiah(d.revenue),
                }))}
              />
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
