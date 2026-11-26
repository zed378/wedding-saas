import { useEffect, useMemo, useState } from "react";
import { ApiClient, accessTokenStore } from "@wi/api-client";
import { Button, Card, Input } from "@wi/ui";
export interface InvitationSummary {
  id: string;
  slug: string | null;
  status: string;
  owner_email: string | null;
  owner_name: string | null;
  template_name: string | null;
  version: string | null;
  expiry_date: string | null;
}
export interface InvitationDetail {
  id: string;
  slug: string | null;
  status: string;
  owner: { email: string | null; full_name: string | null };
  template_version: { id: string; name: string | null; version: string | null };
  published_at: string | null;
  expiry_date: string | null;
  order_history: Array<{
    id: string;
    status: string;
    amount_total: string;
    created_at: string;
  }>;
  validation_summary: {
    ready: boolean;
    missing_required_fields: number;
    incomplete_sections: readonly string[];
  };
  status_history: Array<{
    from_status: string | null;
    to_status: string;
    changed_at: string;
  }>;
}
const date = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" }).format(
        new Date(value),
      )
    : "Belum tersedia";
export function InvitationsPage() {
  const client = useMemo(
    () =>
      new ApiClient({
        baseUrl:
          window.location.hostname === "localhost"
            ? "http://localhost:3000"
            : window.location.origin,
        tokenStore: accessTokenStore,
      }),
    [],
  );
  const [slug, setSlug] = useState("");
  const [user, setUser] = useState("");
  const [query, setQuery] = useState({
    search_slug: "",
    search_user: "",
    page: 1,
  });
  const [rows, setRows] = useState<InvitationSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState("");
  const [detail, setDetail] = useState<InvitationDetail | null>(null);
  const [detailError, setDetailError] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailAttempt, setDetailAttempt] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError("");
    setRows([]);
    client
      .get<InvitationSummary[]>("/api/v1/admin/invitations", {
        query: { ...query, limit: 20 },
        signal: abort.signal,
      })
      .then((result) => {
        if (!abort.signal.aborted) {
          setRows(result.data);
          setTotal(result.meta?.total ?? 0);
        }
      })
      .catch(() => {
        if (!abort.signal.aborted)
          setError("Daftar undangan gagal dimuat. Coba lagi.");
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [client, query]);
  useEffect(() => {
    if (!selected) return;
    const abort = new AbortController();
    setDetail(null);
    setDetailError("");
    setDetailLoading(true);
    client
      .get<InvitationDetail>(`/api/v1/admin/invitations/${selected}`, {
        signal: abort.signal,
      })
      .then((result) => {
        if (!abort.signal.aborted) setDetail(result.data);
      })
      .catch(() => {
        if (!abort.signal.aborted)
          setDetailError("Detail undangan gagal dimuat.");
      })
      .finally(() => {
        if (!abort.signal.aborted) setDetailLoading(false);
      });
    return () => abort.abort();
  }, [client, selected, detailAttempt]);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Ringkasan undangan</h1>
      <p>
        Informasi operasional untuk dukungan. Setiap pencarian dan pembacaan
        detail dicatat dalam audit.
      </p>
      <Card>
        <form
          className="flex flex-wrap items-end gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setSelected("");
            setDetail(null);
            setQuery({
              search_slug: slug.trim(),
              search_user: user.trim(),
              page: 1,
            });
          }}
        >
          <div>
            <Input
              label="Slug undangan"
              id="invitation-slug"
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
              maxLength={50}
            />
          </div>
          <div>
            <Input
              label="Nama atau email pemilik"
              id="invitation-user"
              value={user}
              onChange={(event) => setUser(event.target.value)}
              maxLength={100}
            />
          </div>
          <Button type="submit">Cari undangan</Button>
        </form>
      </Card>
      {loading ? (
        <p role="status">Memuat undangan…</p>
      ) : error ? (
        <div role="alert">
          <p>{error}</p>
          <Button onClick={() => setQuery({ ...query })}>Coba lagi</Button>
        </div>
      ) : (
        <Card>
          <p>{total} undangan ditemukan</p>
          {!rows.length ? (
            <p>Tidak ada undangan yang sesuai.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Hasil pencarian undangan</caption>
                <thead>
                  <tr>
                    <th className="p-3">Slug</th>
                    <th className="p-3">Pemilik</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Template</th>
                    <th className="p-3">Masa berlaku</th>
                    <th className="p-3">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-t">
                      <td className="p-3">
                        {row.slug ?? "Belum memiliki slug"}
                      </td>
                      <td className="p-3">
                        {row.owner_name}
                        <br />
                        {row.owner_email}
                      </td>
                      <td className="p-3">{row.status}</td>
                      <td className="p-3">
                        {row.template_name} {row.version}
                      </td>
                      <td className="p-3">{date(row.expiry_date)}</td>
                      <td className="p-3">
                        <Button
                          variant="secondary"
                          onClick={() => setSelected(row.id)}
                          aria-label={`Lihat detail ${row.slug ?? row.id}`}
                        >
                          Lihat detail
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <nav
            aria-label="Halaman hasil undangan"
            className="mt-4 flex items-center gap-3"
          >
            <Button
              variant="secondary"
              disabled={query.page === 1}
              onClick={() => setQuery({ ...query, page: query.page - 1 })}
            >
              Sebelumnya
            </Button>
            <span>Halaman {query.page}</span>
            <Button
              variant="secondary"
              disabled={query.page * 20 >= total}
              onClick={() => setQuery({ ...query, page: query.page + 1 })}
            >
              Berikutnya
            </Button>
          </nav>
        </Card>
      )}
      {selected && (
        <section aria-label="Detail undangan">
          <h2 className="text-xl font-semibold">Detail operasional</h2>
          {detailLoading && <p role="status">Memuat detail…</p>}
          {detailError && (
            <div role="alert">
              <p>{detailError}</p>
              <Button
                onClick={() => setDetailAttempt((attempt) => attempt + 1)}
              >
                Coba lagi
              </Button>
            </div>
          )}
          {detail && (
            <Card>
              <h3 className="text-lg font-semibold">
                {detail.slug ?? detail.id}
              </h3>
              <dl className="grid gap-3 py-4 sm:grid-cols-2">
                <div>
                  <dt>Status</dt>
                  <dd>{detail.status}</dd>
                </div>
                <div>
                  <dt>Pemilik</dt>
                  <dd>
                    {detail.owner.full_name} · {detail.owner.email}
                  </dd>
                </div>
                <div>
                  <dt>Versi template</dt>
                  <dd>
                    {detail.template_version.name}{" "}
                    {detail.template_version.version}
                  </dd>
                </div>
                <div>
                  <dt>Terbit</dt>
                  <dd>{date(detail.published_at)}</dd>
                </div>
                <div>
                  <dt>Masa berlaku</dt>
                  <dd>{date(detail.expiry_date)}</dd>
                </div>
              </dl>
              <h3 className="font-semibold">Kelengkapan konten wajib</h3>
              <p>
                {detail.validation_summary.ready
                  ? "Konten wajib sudah lengkap."
                  : `${detail.validation_summary.missing_required_fields} bidang wajib belum lengkap.`}
              </p>
              {detail.validation_summary.incomplete_sections.length > 0 && (
                <p>
                  Bagian belum lengkap:{" "}
                  {detail.validation_summary.incomplete_sections.join(", ")}
                </p>
              )}
              <p className="mb-4 text-sm">
                Ringkasan ini memeriksa kelengkapan konten. Syarat pembayaran
                dan slug diperiksa terpisah saat publikasi.
              </p>
              <h3 className="font-semibold">Riwayat pesanan</h3>
              {detail.order_history.length ? (
                <ul>
                  {detail.order_history.map((order) => (
                    <li key={order.id}>
                      {order.id} · {order.status} ·{" "}
                      {new Intl.NumberFormat("id-ID", {
                        style: "currency",
                        currency: "IDR",
                        maximumFractionDigits: 0,
                      }).format(Number(order.amount_total))}{" "}
                      · {date(order.created_at)}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>Belum ada pesanan.</p>
              )}
              <h3 className="mt-4 font-semibold">Riwayat status</h3>
              {detail.status_history.length ? (
                <ol>
                  {detail.status_history.map((change, index) => (
                    <li key={index}>
                      {change.from_status ?? "Awal"} → {change.to_status} ·{" "}
                      {date(change.changed_at)}
                    </li>
                  ))}
                </ol>
              ) : (
                <p>Belum ada perubahan status.</p>
              )}
            </Card>
          )}
        </section>
      )}
    </div>
  );
}
