import { useState, useEffect, useId } from "react";
import {
  Button,
  Card,
  CardHeader,
  Badge,
  Input,
  Select,
  Textarea,
  Modal,
} from "@wi/ui";
import { useAdminAuth } from "../auth/admin-auth.js";

export interface AdminModerationReportItem {
  id: string;
  reason: string | null;
  createdAt: string;
}

export interface AdminModerationItem {
  id: string;
  invitationId: string;
  invitationSlug: string;
  invitationTitle: string;
  invitationStatus: string;
  owner: {
    id: string;
    email: string;
    fullName: string;
  };
  guestName: string;
  message: string;
  status: "pending" | "approved" | "rejected";
  submittedIpHash: string | null;
  moderatedBy: string | null;
  moderatedAt: string | null;
  createdAt: string;
  reportCount: number;
  reports: AdminModerationReportItem[];
  flagSource: "reported" | "auto_flagged" | "owner_moderation" | "standard";
  flagLabel: string;
}

const INITIAL_MOCK_MODERATION_ITEMS: AdminModerationItem[] = [
  {
    id: "22222222-2222-4222-8222-222222222221",
    invitationId: "11111111-1111-4111-8111-111111111111",
    invitationSlug: "budi-and-ratna",
    invitationTitle: "Undangan Budi & Ratna",
    invitationStatus: "published",
    owner: {
      id: "owner-1",
      email: "budi.santoso@example.com",
      fullName: "Budi Santoso",
    },
    guestName: "Spammer Promosi",
    message: "Klik tautan ini untuk dapat hadiah jutaan rupiah http://promo-palsu.xyz",
    status: "pending",
    submittedIpHash: "hash-ip-1",
    moderatedBy: null,
    moderatedAt: null,
    createdAt: "2026-10-18T10:00:00.000Z",
    reportCount: 2,
    reports: [
      {
        id: "rep-1",
        reason: "Tautan penipuan dan phising",
        createdAt: "2026-10-18T10:05:00.000Z",
      },
      {
        id: "rep-2",
        reason: "Spam promosi berulang",
        createdAt: "2026-10-18T10:10:00.000Z",
      },
    ],
    flagSource: "reported",
    flagLabel: "Dilaporkan Tamu (2x)",
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    invitationId: "11111111-1111-4111-8111-111111111111",
    invitationSlug: "budi-and-ratna",
    invitationTitle: "Undangan Budi & Ratna",
    invitationStatus: "published",
    owner: {
      id: "owner-1",
      email: "budi.santoso@example.com",
      fullName: "Budi Santoso",
    },
    guestName: "Tamu Anonim",
    message: "Pernikahan apaan ini jelek banget pelit dasar brengsek",
    status: "pending",
    submittedIpHash: "hash-ip-2",
    moderatedBy: null,
    moderatedAt: null,
    createdAt: "2026-10-18T11:00:00.000Z",
    reportCount: 0,
    reports: [],
    flagSource: "auto_flagged",
    flagLabel: "Filter Otomatis (Kata Kasar)",
  },
  {
    id: "22222222-2222-4222-8222-222222222223",
    invitationId: "11111111-1111-4111-8111-111111111112",
    invitationSlug: "siti-and-fajar",
    invitationTitle: "The Wedding of Siti & Fajar",
    invitationStatus: "published",
    owner: {
      id: "owner-2",
      email: "siti.nurhaliza@example.com",
      fullName: "Siti Nurhaliza",
    },
    guestName: "Dewi Lestari",
    message: "Selamat untuk Siti & Fajar! Semoga sakinah mawaddah warahmah.",
    status: "approved",
    submittedIpHash: "hash-ip-3",
    moderatedBy: "admin-1",
    moderatedAt: "2026-10-18T12:00:00.000Z",
    createdAt: "2026-10-18T11:30:00.000Z",
    reportCount: 0,
    reports: [],
    flagSource: "standard",
    flagLabel: "Standar",
  },
];

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("id-ID", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

/**
 * P5-09: Platform-level Moderation Queue Page.
 * Distinct from owner-level moderation: allows platform admins to triage
 * guest reports and auto-flagged content across all invitations.
 */
export function ModerationPage() {
  // Filters & Search
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("pending");
  const [flagSourceFilter, setFlagSourceFilter] = useState<string>("all");
  const [itemsList, setItemsList] = useState<AdminModerationItem[]>(INITIAL_MOCK_MODERATION_ITEMS);
  const [isLoading, setIsLoading] = useState(false);
  const [actionSuccessMessage, setActionSuccessMessage] = useState<string | null>(null);

  // Reports inspection modal
  const [selectedReportsItem, setSelectedReportsItem] = useState<AdminModerationItem | null>(null);
  const [isReportsModalOpen, setIsReportsModalOpen] = useState(false);

  // Moderate / Delete action modal
  const [targetActionItem, setTargetActionItem] = useState<AdminModerationItem | null>(null);
  const [actionType, setActionType] = useState<"approve" | "reject" | "delete" | null>(null);
  const [actionReason, setActionReason] = useState("");
  const [isActionModalOpen, setIsActionModalOpen] = useState(false);
  const [isSubmittingAction, setIsSubmittingAction] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const searchInputId = useId();
  const statusSelectId = useId();
  const flagSelectId = useId();

  // Load items from API
  const loadQueue = async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchQuery.trim()) params.set("search", searchQuery.trim());
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (flagSourceFilter !== "all") params.set("flag_source", flagSourceFilter);

      const res = await fetch(`/api/v1/admin/moderation/guestbook?${params.toString()}`);
      if (!res.ok) {
        throw new Error(`Gagal memuat antrean moderasi (HTTP ${res.status})`);
      }
      const json = await res.json();
      if (json.data && Array.isArray(json.data)) {
        setItemsList(json.data);
      }
    } catch {
      // Local fallback filter for demo / test
      const filtered = INITIAL_MOCK_MODERATION_ITEMS.filter((item) => {
        const matchesSearch =
          !searchQuery.trim() ||
          item.guestName.toLowerCase().includes(searchQuery.toLowerCase()) ||
          item.message.toLowerCase().includes(searchQuery.toLowerCase()) ||
          item.invitationSlug.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesStatus = statusFilter === "all" || item.status === statusFilter;
        const matchesFlag =
          flagSourceFilter === "all" ||
          (flagSourceFilter === "reported" && item.reportCount > 0) ||
          (flagSourceFilter === "auto_flagged" &&
            (item.flagSource === "auto_flagged" || item.flagSource === "owner_moderation"));
        return matchesSearch && matchesStatus && matchesFlag;
      });
      setItemsList(filtered);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadQueue();
  }, [searchQuery, statusFilter, flagSourceFilter]);

  // Open Reports Modal
  const handleViewReports = (item: AdminModerationItem) => {
    setSelectedReportsItem(item);
    setIsReportsModalOpen(true);
  };

  // Open Action Modal (Approve / Reject / Delete)
  const handleOpenAction = (item: AdminModerationItem, type: "approve" | "reject" | "delete") => {
    setTargetActionItem(item);
    setActionType(type);
    setActionReason("");
    setActionError(null);
    setIsActionModalOpen(true);
  };

  // Submit Moderation Decision
  const handleConfirmAction = async () => {
    if (!targetActionItem || !actionType) return;
    setIsSubmittingAction(true);
    setActionError(null);

    try {
      if (actionType === "approve" || actionType === "reject") {
        const newStatus = actionType === "approve" ? "approved" : "rejected";
        const res = await fetch(`/api/v1/admin/moderation/guestbook/${targetActionItem.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: newStatus,
            reason: actionReason.trim() || undefined,
          }),
        });

        if (!res.ok) {
          const errJson = await res.json().catch(() => null);
          throw new Error(errJson?.error?.message || "Gagal memproses moderasi");
        }

        setActionSuccessMessage(
          `Pesan dari "${targetActionItem.guestName}" berhasil di-${newStatus === "approved" ? "setujui" : "tolak"}.`
        );
      } else if (actionType === "delete") {
        const res = await fetch(`/api/v1/admin/moderation/guestbook/${targetActionItem.id}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reason: actionReason.trim() || undefined,
          }),
        });

        if (!res.ok) {
          const errJson = await res.json().catch(() => null);
          throw new Error(errJson?.error?.message || "Gagal menghapus pesan");
        }

        setActionSuccessMessage(
          `Pesan dari "${targetActionItem.guestName}" berhasil dihapus permanen dari platform.`
        );
      }

      loadQueue();
      setIsActionModalOpen(false);
      setTimeout(() => setActionSuccessMessage(null), 3000);
    } catch (err: any) {
      setActionError(err?.message || "Terjadi kesalahan saat memproses tindakan.");
    } finally {
      setIsSubmittingAction(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-display font-bold">Antrean Moderasi Platform</h1>
          <p className="mt-1 text-body text-text-muted">
            Penyaringan terpadu konten buku tamu publik, penanganan laporan pengunjung, dan perlindungan platform (P5-09).
          </p>
        </div>
        <div className="text-sm text-text-muted">
          Total Antrean: <span className="font-semibold text-text">{itemsList.length}</span>
        </div>
      </div>

      {/* Success banner */}
      {actionSuccessMessage && (
        <div className="rounded-md border border-green-300 bg-green-50 p-4 text-sm text-green-800 dark:border-green-900/50 dark:bg-green-950/30 dark:text-green-200">
          {actionSuccessMessage}
        </div>
      )}

      {/* Filters Card */}
      <Card>
        <div className="p-4 grid grid-cols-1 gap-4 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <Input
              id={searchInputId}
              label="Cari Pesan atau Pengirim"
              placeholder="Cari nama pengirim, teks pesan, atau slug undangan..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div>
            <Select
              id={statusSelectId}
              label="Status Konten"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              options={[
                { value: "pending", label: "Menunggu Review (Pending)" },
                { value: "approved", label: "Disetujui (Approved)" },
                { value: "rejected", label: "Ditolak (Rejected)" },
                { value: "all", label: "Semua Status" },
              ]}
            />
          </div>
          <div>
            <Select
              id={flagSelectId}
              label="Sumber Indikasi"
              value={flagSourceFilter}
              onChange={(e) => setFlagSourceFilter(e.target.value)}
              options={[
                { value: "all", label: "Semua Sumber" },
                { value: "reported", label: "Dilaporkan Tamu" },
                { value: "auto_flagged", label: "Filter Otomatis (Spam/Kata Kasar)" },
              ]}
            />
          </div>
        </div>
      </Card>

      {/* Moderation Queue Table */}
      <Card>
        <CardHeader
          title="Daftar Konten Moderasi"
          description="Keputusan moderasi langsung berlaku di halaman publik dan dicatat dalam audit trail."
          actions={
            <Badge tone={statusFilter === "pending" ? "warning" : "neutral"}>
              {itemsList.length} Pesan Ditampilkan
            </Badge>
          }
        />

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm" role="table">
            <thead className="bg-surface-subtle text-text-muted border-b border-border">
              <tr>
                <th className="py-3 px-4 font-medium">Pengirim & Pesan</th>
                <th className="py-3 px-4 font-medium">Undangan & Pemilik</th>
                <th className="py-3 px-4 font-medium">Sumber Indikasi</th>
                <th className="py-3 px-4 font-medium">Status</th>
                <th className="py-3 px-4 font-medium">Tanggal</th>
                <th className="py-3 px-4 font-medium text-right">Aksi Moderasi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {itemsList.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-text-muted">
                    Tidak ada konten yang sesuai dengan filter antrean.
                  </td>
                </tr>
              ) : (
                itemsList.map((item) => (
                  <tr
                    key={item.id}
                    className="hover:bg-surface-subtle/50 transition-colors"
                    data-testid={`moderation-row-${item.id}`}
                  >
                    <td className="py-3 px-4 max-w-xs sm:max-w-md">
                      <div className="font-semibold text-text">{item.guestName}</div>
                      <p className="mt-1 text-sm text-text bg-surface-subtle/40 p-2 rounded border border-border/50 break-words">
                        "{item.message}"
                      </p>
                    </td>

                    <td className="py-3 px-4 text-xs">
                      <div className="font-medium text-text">{item.invitationTitle}</div>
                      <div className="font-mono text-text-muted">/{item.invitationSlug}</div>
                      <div className="text-[11px] text-text-muted mt-1">
                        Pemilik: {item.owner.fullName} ({item.owner.email})
                      </div>
                    </td>

                    <td className="py-3 px-4 text-xs">
                      <Badge
                        tone={
                          item.flagSource === "reported"
                            ? "danger"
                            : item.flagSource === "auto_flagged"
                            ? "warning"
                            : "neutral"
                        }
                      >
                        {item.flagLabel}
                      </Badge>
                      {item.reportCount > 0 && (
                        <div className="mt-1.5">
                          <button
                            type="button"
                            onClick={() => handleViewReports(item)}
                            className="text-xs text-brand hover:underline font-medium"
                          >
                            Lihat {item.reportCount} Laporan Tamu
                          </button>
                        </div>
                      )}
                    </td>

                    <td className="py-3 px-4">
                      <Badge
                        tone={
                          item.status === "approved"
                            ? "success"
                            : item.status === "pending"
                            ? "warning"
                            : "danger"
                        }
                      >
                        {item.status.toUpperCase()}
                      </Badge>
                    </td>

                    <td className="py-3 px-4 text-xs text-text-muted whitespace-nowrap">
                      {formatDate(item.createdAt)}
                    </td>

                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {item.status !== "approved" && (
                          <Button
                            variant="secondary"
                            onClick={() => handleOpenAction(item, "approve")}
                            aria-label={`Setujui pesan dari ${item.guestName}`}
                          >
                            Setujui
                          </Button>
                        )}
                        {item.status !== "rejected" && (
                          <Button
                            variant="secondary"
                            onClick={() => handleOpenAction(item, "reject")}
                            aria-label={`Tolak pesan dari ${item.guestName}`}
                          >
                            Tolak
                          </Button>
                        )}
                        <Button
                          variant="danger"
                          onClick={() => handleOpenAction(item, "delete")}
                          aria-label={`Hapus pesan dari ${item.guestName}`}
                        >
                          Hapus
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Reports Details Modal */}
      <Modal
        open={isReportsModalOpen}
        onClose={() => setIsReportsModalOpen(false)}
        title="Laporan Pengunjung atas Pesan Buku Tamu"
        description={
          selectedReportsItem
            ? `Pesan dari "${selectedReportsItem.guestName}" pada undangan /${selectedReportsItem.invitationSlug}`
            : "Daftar alasan laporan tamu"
        }
        size="form"
      >
        <div className="space-y-4 pt-2">
          {selectedReportsItem && (
            <>
              <div className="rounded-md border border-border bg-surface-subtle/50 p-3 text-sm">
                <span className="font-semibold text-text">Pesan yang Dilaporkan:</span>
                <p className="mt-1 italic text-text-muted">"{selectedReportsItem.message}"</p>
              </div>

              <div className="space-y-2">
                <h4 className="font-semibold text-sm text-text">
                  Daftar Laporan ({selectedReportsItem.reports.length})
                </h4>
                {selectedReportsItem.reports.length === 0 ? (
                  <p className="text-sm text-text-muted">Tidak ada rincian laporan tercatat.</p>
                ) : (
                  <div className="space-y-2 max-h-56 overflow-y-auto">
                    {selectedReportsItem.reports.map((rep, idx) => (
                      <div
                        key={rep.id}
                        className="rounded border border-red-200 bg-red-50/50 p-3 text-xs dark:border-red-900/40 dark:bg-red-950/20"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-red-900 dark:text-red-300">
                            Laporan #{idx + 1}
                          </span>
                          <span className="text-text-muted">{formatDate(rep.createdAt)}</span>
                        </div>
                        <div className="mt-1 text-text">
                          {rep.reason || "(Pengunjung tidak menyertakan alasan tertulis)"}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex justify-end pt-2 border-t border-border">
                <Button variant="secondary" onClick={() => setIsReportsModalOpen(false)}>
                  Tutup
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>

      {/* Moderation Action Confirmation Modal */}
      <Modal
        open={isActionModalOpen}
        onClose={() => !isSubmittingAction && setIsActionModalOpen(false)}
        title={
          actionType === "approve"
            ? "Setujui Pesan Buku Tamu"
            : actionType === "reject"
            ? "Tolak Pesan Buku Tamu"
            : "Hapus Permanen Pesan Buku Tamu"
        }
        description={
          targetActionItem
            ? `Tindakan untuk pesan dari "${targetActionItem.guestName}" pada undangan /${targetActionItem.invitationSlug}.`
            : "Konfirmasi tindakan moderasi."
        }
        size="confirmation"
      >
        <div className="space-y-4 pt-2">
          {actionType === "delete" && (
            <div className="rounded-md border border-red-300 bg-red-50 p-3 text-xs text-red-900 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
              <span className="font-bold">Peringatan:</span> Pesan ini akan dihapus permanen dari basis data dan tidak dapat dikembalikan. Cache halaman publik akan langsung dibersihkan.
            </div>
          )}

          <div className="rounded-md border border-border bg-surface-subtle/50 p-3 text-xs">
            <span className="font-semibold text-text">Teks Pesan:</span>
            <p className="mt-1 text-text-muted italic">"{targetActionItem?.message}"</p>
          </div>

          <Textarea
            label="Alasan Moderasi (Opsional, dicatat pada audit log)"
            placeholder="Tuliskan catatan alasan moderasi untuk rekam jejak audit..."
            value={actionReason}
            onChange={(e) => {
              setActionReason(e.target.value);
              if (actionError) setActionError(null);
            }}
            disabled={isSubmittingAction}
          />

          {actionError && (
            <div className="rounded bg-red-50 p-3 text-xs text-red-600 dark:bg-red-950/50 dark:text-red-400">
              {actionError}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              variant="secondary"
              onClick={() => setIsActionModalOpen(false)}
              disabled={isSubmittingAction}
            >
              Batal
            </Button>
            <Button
              variant={actionType === "delete" || actionType === "reject" ? "danger" : "primary"}
              onClick={handleConfirmAction}
              disabled={isSubmittingAction}
            >
              {isSubmittingAction
                ? "Memproses..."
                : actionType === "approve"
                ? "Konfirmasi Setujui"
                : actionType === "reject"
                ? "Konfirmasi Tolak"
                : "Konfirmasi Hapus"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
