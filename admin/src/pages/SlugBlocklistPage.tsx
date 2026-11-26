import { useEffect, useState, type FormEvent } from "react";
import { ApiClient, accessTokenStore } from "@wi/api-client";
import { Button, Card, CardHeader, Input, Select } from "@wi/ui";

interface Entry {
  id: string;
  term: string;
  match_type: string;
  category: string;
  reason: string | null;
}
interface Match {
  id: string;
  slug: string;
  status: string;
}
const client = new ApiClient({ baseUrl: "", tokenStore: accessTokenStore });
const path = "/api/v1/admin/slug-blocklist";

export function SlugBlocklistPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [id, setId] = useState<string | null>(null);
  const [term, setTerm] = useState("");
  const [matchType, setMatchType] = useState("exact");
  const [category, setCategory] = useState("reserved");
  const [reason, setReason] = useState("");
  const [candidate, setCandidate] = useState("");
  const [testResult, setTestResult] = useState("");
  const [matches, setMatches] = useState<Match[]>([]);
  const [matchCount, setMatchCount] = useState<number | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError("");
    void client
      .get<Entry[]>(path, {
        query: { page, per_page: 20 },
        signal: abort.signal,
      })
      .then((result) => {
        if (!abort.signal.aborted) {
          setEntries(result.data);
          setTotal(result.meta?.total ?? 0);
          const lastPage = Math.max(
            1,
            Math.ceil((result.meta?.total ?? 0) / 20),
          );
          if (page > lastPage) setPage(lastPage);
        }
      })
      .catch(() => {
        if (!abort.signal.aborted) {
          setEntries([]);
          setError("Daftar gagal dimuat. Coba lagi.");
        }
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [page, reload]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await client.request<{
        existing_matches: Match[];
        existing_match_count: number;
      }>(id ? `${path}/${id}` : path, {
        method: id ? "PATCH" : "POST",
        body: { term, match_type: matchType, category, reason },
      });
      setMatches(result.data.existing_matches);
      setMatchCount(result.data.existing_match_count);
      setId(null);
      setTerm("");
      setReason("");
      setReload((value) => value + 1);
    } catch {
      setError(
        "Perubahan gagal. Periksa duplikasi kata dan reservasi rute; lalu coba lagi.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!id) return;
    setBusy(true);
    setError("");
    try {
      await client.request(`${path}/${id}`, {
        method: "DELETE",
        body: { reason },
      });
      setId(null);
      setTerm("");
      setReason("");
      setMatches([]);
      setMatchCount(null);
      setReload((value) => value + 1);
    } catch {
      setError(
        "Kata gagal dihapus. Reservasi rute publik wajib dipertahankan.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function test(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setTestResult("");
    setError("");
    try {
      const result = await client.post<{
        blocked: boolean;
        valid_format: boolean;
        matching_term: string | null;
      }>(`${path}/test`, { slug: candidate });
      setTestResult(
        !result.data.valid_format
          ? "Format slug tidak valid."
          : result.data.blocked
            ? `Diblokir oleh kata: ${result.data.matching_term}`
            : "Lolos blocklist. Ketersediaan slug diperiksa saat digunakan.",
      );
    } catch {
      setError("Pemeriksaan gagal. Coba lagi.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6">
      <h1 className="text-heading-2 text-text-primary">Blocklist slug</h1>
      <p className="text-text-secondary">
        Kata persis berlaku untuk seluruh slug. Substring juga memeriksa variasi
        leetspeak. Undangan yang sudah ada tetap aktif.
      </p>
      {error && (
        <div role="alert">
          <p>{error}</p>
          <Button
            variant="secondary"
            onClick={() => setReload((value) => value + 1)}
          >
            Muat ulang
          </Button>
        </div>
      )}
      <Card>
        <CardHeader title="Periksa calon slug" />
        <form onSubmit={test} className="space-y-3">
          <Input
            label="Calon slug"
            disabled={busy}
            value={candidate}
            onChange={(event) => {
              setCandidate(event.target.value);
              setTestResult("");
            }}
            required
            minLength={3}
            maxLength={50}
          />
          <Button type="submit" disabled={busy}>
            Periksa slug
          </Button>
          <p role="status">{testResult}</p>
        </form>
      </Card>
      <Card>
        <CardHeader title={id ? "Ubah atau hapus kata" : "Tambahkan kata"} />
        <form onSubmit={save} className="space-y-3">
          <Input
            label="Kata"
            disabled={busy}
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            required
            maxLength={60}
            pattern="[a-zA-Z0-9-]+"
          />
          <Select
            label="Jenis pencocokan"
            disabled={busy}
            value={matchType}
            onChange={(event) => setMatchType(event.target.value)}
            options={[
              { value: "exact", label: "Persis" },
              { value: "substring", label: "Substring" },
            ]}
          />
          <Select
            label="Kategori"
            disabled={busy}
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            options={[
              { value: "reserved", label: "Reservasi" },
              { value: "profanity", label: "Kata kasar" },
              { value: "brand", label: "Merek" },
              { value: "other", label: "Lainnya" },
            ]}
          />
          <Input
            label="Alasan perubahan"
            disabled={busy}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            minLength={5}
            maxLength={500}
            required
          />
          <div className="flex gap-3">
            <Button type="submit" disabled={busy}>
              Simpan kata
            </Button>
            {id && (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy || reason.trim().length < 5}
                  onClick={() => void remove()}
                >
                  Hapus kata terpilih
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    setId(null);
                    setTerm("");
                    setReason("");
                  }}
                >
                  Batal
                </Button>
              </>
            )}
          </div>
        </form>
      </Card>
      {matchCount !== null && (
        <Card>
          <CardHeader title="Slug yang sudah ada" />
          <p role="status">
            {matchCount} slug cocok; menampilkan paling banyak 100. Status
            undangan tidak berubah.
          </p>
          <ul>
            {matches.map((match) => (
              <li key={match.id}>
                {match.slug} — {match.status}
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card>
        <CardHeader title="Daftar kata" />
        {loading ? (
          <p role="status">Memuat daftar…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-body-sm">
              <thead>
                <tr>
                  <th scope="col">Kata</th>
                  <th scope="col">Pencocokan</th>
                  <th scope="col">Kategori</th>
                  <th scope="col">Tindakan</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <th scope="row">{entry.term}</th>
                    <td>{entry.match_type}</td>
                    <td>{entry.category}</td>
                    <td>
                      <Button
                        variant="secondary"
                        disabled={busy}
                        onClick={() => {
                          setId(entry.id);
                          setTerm(entry.term);
                          setMatchType(entry.match_type);
                          setCategory(entry.category);
                          setReason("");
                        }}
                      >
                        Pilih {entry.term}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {entries.length === 0 && <p>Belum ada kata.</p>}
          </div>
        )}
        <div className="mt-4 flex items-center gap-3">
          <Button
            variant="secondary"
            disabled={page === 1 || loading}
            onClick={() => setPage((value) => value - 1)}
          >
            Sebelumnya
          </Button>
          <span>
            Halaman {page} · {total} kata
          </span>
          <Button
            variant="secondary"
            disabled={page * 20 >= total || loading}
            onClick={() => setPage((value) => value + 1)}
          >
            Berikutnya
          </Button>
        </div>
      </Card>
    </div>
  );
}
