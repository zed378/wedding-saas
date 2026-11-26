import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ApiClient } from "@wi/api-client";
import { Button, Card, CardHeader } from "@wi/ui";

interface AuditItem {
  id: string;
  admin_id: string;
  admin_email: string | null;
  action: string;
  resource_type: string;
  resource_id: string;
  reason: string | null;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
  created_at: string;
}

interface AuditPage {
  items: AuditItem[];
  total: number;
  page: number;
  total_pages: number;
}

const fieldClass =
  "mt-1 w-full rounded-md border border-border bg-surface p-2 text-text";
const valueText = (value: unknown) =>
  value === undefined ? "—" : JSON.stringify(value, null, 2);

export function AuditLogsPage() {
  const client = useMemo(
    () =>
      new ApiClient({
        baseUrl:
          window.location.hostname === "localhost"
            ? "http://localhost:3000"
            : "",
      }),
    [],
  );
  const [filters, setFilters] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<AuditPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<AuditItem | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState("");
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setSelected(null);
    client
      .get<AuditPage>(
        `/api/v1/admin/audit-logs?${filters}&page=${page}&limit=20`,
      )
      .then(({ data }) => {
        if (active) setResult(data);
      })
      .catch(() => {
        if (active)
          setError("Log audit gagal dimuat. Periksa sesi dan coba lagi.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client, filters, page, refresh]);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const query = new URLSearchParams();
    for (const name of [
      "admin_id",
      "resource_type",
      "resource_id",
      "date_from",
      "date_to",
    ]) {
      const value = String(values.get(name) ?? "").trim();
      if (value)
        query.set(
          name,
          name.startsWith("date_") ? new Date(value).toISOString() : value,
        );
    }
    setFilters(query.toString());
    setPage(1);
    setRefresh((value) => value + 1);
    setExportMessage("");
  }

  async function exportLogs() {
    setExporting(true);
    setExportMessage("");
    try {
      const { data } = await client.get<{
        export_id: string;
        items: AuditItem[];
        total: number;
      }>(`/api/v1/admin/audit-logs/export?${filters}`);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `audit-${data.export_id}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setExportMessage(
        `${data.total} catatan diekspor. Akses ekspor dicatat dalam audit.`,
      );
    } catch {
      setExportMessage(
        "Ekspor gagal. Maksimum 10.000 catatan; persempit filter atau periksa sesi lalu coba lagi.",
      );
    } finally {
      setExporting(false);
    }
  }

  const changedFields = selected
    ? [
        ...new Set([
          ...Object.keys(selected.before_state ?? {}),
          ...Object.keys(selected.after_state ?? {}),
        ]),
      ].filter(
        (key) =>
          JSON.stringify(selected.before_state?.[key]) !==
          JSON.stringify(selected.after_state?.[key]),
      )
    : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-display font-bold">Log Audit Sistem</h1>
        <p className="mt-1 text-body text-text-muted">
          Catatan hanya dapat ditambahkan, tidak dapat diubah atau dihapus.
          Retensi minimum 2 tahun.
        </p>
      </div>
      <Card>
        <CardHeader
          title="Filter investigasi"
          description="Tanggal menggunakan zona waktu perangkat. Ekspor mencakup semua hasil filter, maksimum 10.000 catatan."
        />
        <form onSubmit={applyFilters} className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <label>
              ID pelaku
              <input
                name="admin_id"
                className={fieldClass}
                placeholder="UUID admin atau pemilik"
              />
            </label>
            <label>
              Jenis sumber daya
              <input
                name="resource_type"
                className={fieldClass}
                maxLength={40}
                placeholder="user, order, invitation"
              />
            </label>
            <label>
              ID sumber daya
              <input
                name="resource_id"
                className={fieldClass}
                placeholder="UUID sumber daya"
              />
            </label>
            <label>
              Dari tanggal
              <input
                name="date_from"
                type="datetime-local"
                className={fieldClass}
              />
            </label>
            <label>
              Sampai tanggal
              <input
                name="date_to"
                type="datetime-local"
                className={fieldClass}
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button type="submit">Terapkan filter</Button>
            <Button
              type="button"
              variant="secondary"
              disabled={exporting || loading || !!error}
              onClick={exportLogs}
            >
              {exporting ? "Mengekspor…" : "Ekspor JSON"}
            </Button>
          </div>
        </form>
        {exportMessage && (
          <p role="status" className="mt-4">
            {exportMessage}
          </p>
        )}
      </Card>
      <Card>
        <CardHeader
          title="Audit trail"
          description="Termasuk tindakan admin dan perubahan sensitif oleh pemilik sumber daya."
        />
        {loading ? (
          <p role="status">Memuat log audit…</p>
        ) : error ? (
          <div role="alert">
            <p>{error}</p>
            <Button onClick={() => setRefresh((value) => value + 1)}>
              Coba lagi
            </Button>
          </div>
        ) : result?.items.length ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-body-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th scope="col" className="p-3">
                      Waktu
                    </th>
                    <th scope="col" className="p-3">
                      Pelaku
                    </th>
                    <th scope="col" className="p-3">
                      Aksi
                    </th>
                    <th scope="col" className="p-3">
                      Sumber daya
                    </th>
                    <th scope="col" className="p-3">
                      Detail
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((item) => (
                    <tr key={item.id} className="border-b border-border">
                      <td className="p-3">
                        <time dateTime={item.created_at}>
                          {new Date(item.created_at).toLocaleString("id-ID")}
                        </time>
                      </td>
                      <td className="p-3">
                        {item.admin_email ?? item.admin_id}
                      </td>
                      <td className="p-3">{item.action}</td>
                      <td className="p-3">
                        <span className="block">{item.resource_type}</span>
                        <code>{item.resource_id}</code>
                      </td>
                      <td className="p-3">
                        <Button
                          variant="secondary"
                          onClick={() => setSelected(item)}
                          aria-label={`Lihat perubahan ${item.action} ${item.id}`}
                        >
                          Lihat perubahan
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <nav
              aria-label="Halaman log audit"
              className="mt-4 flex items-center justify-between gap-3"
            >
              <Button
                variant="secondary"
                disabled={page <= 1}
                onClick={() => setPage((value) => value - 1)}
              >
                Sebelumnya
              </Button>
              <span>
                Halaman {result.page} dari {result.total_pages} · {result.total}{" "}
                catatan
              </span>
              <Button
                variant="secondary"
                disabled={page >= result.total_pages}
                onClick={() => setPage((value) => value + 1)}
              >
                Berikutnya
              </Button>
            </nav>
          </>
        ) : (
          <p>Tidak ada log yang cocok dengan filter.</p>
        )}
      </Card>
      {selected && (
        <Card>
          <CardHeader
            title={`Perubahan: ${selected.action}`}
            description={selected.reason ?? "Tidak ada alasan tercatat"}
          />
          {changedFields.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-body-sm">
                <thead>
                  <tr>
                    <th scope="col" className="p-3">
                      Bidang berubah
                    </th>
                    <th scope="col" className="p-3">
                      Sebelum
                    </th>
                    <th scope="col" className="p-3">
                      Sesudah
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {changedFields.map((key) => (
                    <tr key={key} className="border-t border-border">
                      <th scope="row" className="p-3 align-top">
                        {key}
                      </th>
                      <td className="p-3 align-top">
                        <pre className="whitespace-pre-wrap break-all">
                          {valueText(selected.before_state?.[key])}
                        </pre>
                      </td>
                      <td className="p-3 align-top">
                        <pre className="whitespace-pre-wrap break-all">
                          {valueText(selected.after_state?.[key])}
                        </pre>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>Tidak ada perubahan bidang yang tercatat.</p>
          )}
          <details className="mt-4">
            <summary>Snapshot lengkap</summary>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <h3>Sebelum</h3>
                <pre className="overflow-auto whitespace-pre-wrap break-all">
                  {valueText(selected.before_state)}
                </pre>
              </div>
              <div>
                <h3>Sesudah</h3>
                <pre className="overflow-auto whitespace-pre-wrap break-all">
                  {valueText(selected.after_state)}
                </pre>
              </div>
            </div>
          </details>
          <Button variant="secondary" onClick={() => setSelected(null)}>
            Tutup detail
          </Button>
        </Card>
      )}
    </div>
  );
}
