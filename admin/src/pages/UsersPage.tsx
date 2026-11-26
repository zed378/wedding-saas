import { useState, useEffect, useId, useRef } from "react";
import { accessTokenStore } from "@wi/api-client";
import { StepUpModal } from "../components/StepUpModal";
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

export interface AdminUserSummaryItem {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  role: "user" | "admin" | "super_admin";
  status: "active" | "suspended";
  emailVerified: boolean;
  createdAt: string;
  updatedAt: string;
  invitationCount: number;
  orderCount: number;
}

export interface AdminUserInvitationItem {
  id: string;
  slug: string;
  internalName: string | null;
  status: "draft" | "published" | "archived" | "suspended";
  templateId: string;
  templateVersionId: string | null;
  publishedAt: string | null;
  createdAt: string;
}

export interface AdminUserOrderItem {
  id: string;
  packageId: string;
  amountTotal: string;
  status: "pending" | "paid" | "failed" | "expired" | "refunded";
  createdAt: string;
}

export interface AdminUserDetailItem extends AdminUserSummaryItem {
  invitations: AdminUserInvitationItem[];
  orders: AdminUserOrderItem[];
}

function formatCurrency(amount: string | number): string {
  const numeric =
    typeof amount === "string" ? Number.parseInt(amount, 10) : amount;
  if (Number.isNaN(numeric)) return "Rp 0";
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(numeric);
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  try {
    return new Intl.DateTimeFormat("id-ID", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function UsersPage() {
  const searchInputId = useId();
  const statusSelectId = useId();

  const [usersList, setUsersList] = useState<AdminUserSummaryItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [isLoading, setIsLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Detail Modal State
  const [selectedUserDetail, setSelectedUserDetail] =
    useState<AdminUserDetailItem | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  // Suspend / Unsuspend Modal State
  const [targetUser, setTargetUser] = useState<AdminUserSummaryItem | null>(
    null,
  );
  const [isSuspendModalOpen, setIsSuspendModalOpen] = useState(false);
  const [isStepUpOpen, setIsStepUpOpen] = useState(false);
  const [isUnsuspendModalOpen, setIsUnsuspendModalOpen] = useState(false);
  const [actionReason, setActionReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [isSubmittingAction, setIsSubmittingAction] = useState(false);

  const requestVersion = useRef(0);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Fetch users from API
  const loadUsers = async () => {
    const version = ++requestVersion.current;
    setIsLoading(true);
    setFetchError(null);
    try {
      const params = new URLSearchParams();
      if (searchQuery.trim()) params.set("search", searchQuery.trim());
      if (statusFilter !== "all") params.set("status", statusFilter);

      const res = await fetch(`/api/v1/admin/users?${params.toString()}`, {
        headers: { Authorization: `Bearer ${accessTokenStore.get() ?? ""}` },
        credentials: "include",
      });
      if (!res.ok) {
        throw new Error(`Gagal memuat pengguna (HTTP ${res.status})`);
      }
      const json = await res.json();
      if (json.success !== true || !Array.isArray(json.data))
        throw new Error("Respons daftar pengguna tidak valid.");
      if (version === requestVersion.current) setUsersList(json.data);
    } catch (error) {
      if (version === requestVersion.current) {
        setUsersList([]);
        setFetchError(
          error instanceof Error ? error.message : "Gagal memuat pengguna.",
        );
      }
    } finally {
      if (version === requestVersion.current) setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadUsers();
    return () => {
      requestVersion.current++;
    };
  }, [searchQuery, statusFilter]);

  // Open detail modal
  const handleOpenDetail = async (user: AdminUserSummaryItem) => {
    setIsLoadingDetail(true);
    setDetailError(null);
    setSelectedUserDetail(null);
    setIsDetailModalOpen(true);

    try {
      const res = await fetch(`/api/v1/admin/users/${user.id}`, {
        headers: { Authorization: `Bearer ${accessTokenStore.get() ?? ""}` },
        credentials: "include",
      });
      if (!res.ok) {
        throw new Error(`Gagal memuat detail pengguna (HTTP ${res.status})`);
      }
      const json = await res.json();
      if (json.success !== true || !json.data)
        throw new Error("Respons detail pengguna tidak valid.");
      setSelectedUserDetail(json.data);
    } catch (error) {
      setDetailError(
        error instanceof Error
          ? error.message
          : "Gagal memuat detail pengguna.",
      );
    } finally {
      setIsLoadingDetail(false);
    }
  };

  // Open Suspend modal
  const handleOpenSuspend = (user: AdminUserSummaryItem) => {
    setTargetUser(user);
    setActionReason("");
    setActionError(null);
    setIsSuspendModalOpen(true);
  };

  // Open Unsuspend modal
  const handleOpenUnsuspend = (user: AdminUserSummaryItem) => {
    setTargetUser(user);
    setActionReason("");
    setActionError(null);
    setIsUnsuspendModalOpen(true);
  };

  // Submit Suspend
  const handleConfirmSuspend = async (stepUpToken: string) => {
    if (!targetUser) return;
    setActionError(null);
    if (actionReason.trim().length < 5) {
      setActionError(
        "Alasan penangguhan wajib diisi minimal 5 karakter untuk audit.",
      );
      return;
    }

    setIsSubmittingAction(true);
    try {
      const res = await fetch(`/api/v1/admin/users/${targetUser.id}/suspend`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessTokenStore.get() ?? ""}`,
          "X-MFA-Step-Up": stepUpToken,
        },
        body: JSON.stringify({ reason: actionReason.trim() }),
      });

      if (!res.ok) {
        const errorJson = await res.json().catch(() => ({}));
        throw new Error(
          errorJson?.error?.message ||
            `Gagal menangguhkan akun (HTTP ${res.status})`,
        );
      }

      const result = await res.json();
      if (result.success !== true)
        throw new Error(result.error?.message || "Perubahan akun ditolak.");

      // Update state locally
      setUsersList((prev) =>
        prev.map((u) =>
          u.id === targetUser.id ? { ...u, status: "suspended" } : u,
        ),
      );
      if (selectedUserDetail?.id === targetUser.id) {
        setSelectedUserDetail((prev) =>
          prev ? { ...prev, status: "suspended" } : null,
        );
      }
      setIsSuspendModalOpen(false);
    } catch (err: any) {
      setActionError(
        err?.message || "Terjadi kesalahan saat memproses penangguhan.",
      );
    } finally {
      setIsSubmittingAction(false);
    }
  };

  // Submit Unsuspend
  const handleConfirmUnsuspend = async () => {
    if (!targetUser) return;
    setActionError(null);
    if (actionReason.trim().length < 5) {
      setActionError(
        "Alasan pengaktifan kembali wajib diisi minimal 5 karakter untuk audit.",
      );
      return;
    }

    setIsSubmittingAction(true);
    try {
      const res = await fetch(
        `/api/v1/admin/users/${targetUser.id}/unsuspend`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessTokenStore.get() ?? ""}`,
          },
          body: JSON.stringify({ reason: actionReason.trim() }),
        },
      );

      if (!res.ok) {
        const errorJson = await res.json().catch(() => ({}));
        throw new Error(
          errorJson?.error?.message ||
            `Gagal mengaktifkan kembali akun (HTTP ${res.status})`,
        );
      }

      const result = await res.json();
      if (result.success !== true)
        throw new Error(result.error?.message || "Perubahan akun ditolak.");

      // Update state locally
      setUsersList((prev) =>
        prev.map((u) =>
          u.id === targetUser.id ? { ...u, status: "active" } : u,
        ),
      );
      if (selectedUserDetail?.id === targetUser.id) {
        setSelectedUserDetail((prev) =>
          prev ? { ...prev, status: "active" } : null,
        );
      }
      setIsUnsuspendModalOpen(false);
    } catch (err: any) {
      setActionError(
        err?.message || "Terjadi kesalahan saat mengaktifkan kembali akun.",
      );
    } finally {
      setIsSubmittingAction(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-display font-bold">Manajemen Pengguna</h1>
          <p className="mt-1 text-body text-text-muted">
            Pencarian akun pengguna, peninjauan undangan & pesanan, serta
            manajemen penangguhan akses.
          </p>
        </div>
        <div className="text-sm text-text-muted">
          Total Pengguna:{" "}
          <span className="font-semibold text-text">{usersList.length}</span>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <Card>
        <div className="p-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <Input
              id={searchInputId}
              label="Cari Pengguna"
              placeholder="Cari berdasarkan email atau nama..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div>
            <Select
              id={statusSelectId}
              label="Status Akun"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              options={[
                { value: "all", label: "Semua Status" },
                { value: "active", label: "Aktif" },
                { value: "suspended", label: "Ditangguhkan" },
              ]}
            />
          </div>
        </div>
      </Card>

      {fetchError && <p role="alert">{fetchError}</p>}
      {isLoading && <p role="status">Memuat pengguna...</p>}

      {/* Users Table */}
      <Card>
        <CardHeader
          title="Daftar Pengguna Terdaftar"
          description="Akses detail akun, riwayat pesanan, dan kontrol status suspensi"
          actions={
            <Badge tone="neutral">
              {usersList.length} Pengguna Ditampilkan
            </Badge>
          }
        />

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm" role="table">
            <thead className="bg-surface-subtle text-text-muted border-b border-border">
              <tr>
                <th className="py-3 px-4 font-medium">Pengguna</th>
                <th className="py-3 px-4 font-medium">Peran</th>
                <th className="py-3 px-4 font-medium">Status</th>
                <th className="py-3 px-4 font-medium">Statistik</th>
                <th className="py-3 px-4 font-medium">Terdaftar</th>
                <th className="py-3 px-4 font-medium text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {usersList.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-text-muted">
                    Tidak ada pengguna yang sesuai dengan kriteria pencarian.
                  </td>
                </tr>
              ) : (
                usersList.map((user) => (
                  <tr
                    key={user.id}
                    className="hover:bg-surface-subtle/50 transition-colors"
                    data-testid={`user-row-${user.id}`}
                  >
                    <td className="py-3 px-4">
                      <div className="font-semibold text-text">
                        {user.fullName}
                      </div>
                      <div className="text-xs text-text-muted flex items-center gap-1.5">
                        <span>{user.email}</span>
                        {user.emailVerified ? (
                          <span
                            className="inline-block text-xs text-tone-success-fg font-medium"
                            title="Email Terverifikasi"
                          >
                            ✓ Terverifikasi
                          </span>
                        ) : (
                          <span
                            className="inline-block text-xs text-tone-warning-fg font-medium"
                            title="Belum Verifikasi"
                          >
                            Belum Verifikasi
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <Badge
                        tone={
                          user.role === "super_admin" || user.role === "admin"
                            ? "primary"
                            : "neutral"
                        }
                      >
                        {user.role}
                      </Badge>
                    </td>
                    <td className="py-3 px-4">
                      <Badge
                        tone={user.status === "active" ? "success" : "danger"}
                      >
                        {user.status === "active" ? "Aktif" : "Ditangguhkan"}
                      </Badge>
                    </td>
                    <td className="py-3 px-4">
                      <div className="text-xs text-text-muted space-y-0.5">
                        <div>
                          <span className="font-medium text-text">
                            {user.invitationCount}
                          </span>{" "}
                          Undangan
                        </div>
                        <div>
                          <span className="font-medium text-text">
                            {user.orderCount}
                          </span>{" "}
                          Pesanan
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-xs text-text-muted">
                      {formatDate(user.createdAt)}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="secondary"
                          onClick={() => handleOpenDetail(user)}
                          aria-label={`Lihat detail ${user.fullName}`}
                        >
                          Detail
                        </Button>
                        {user.status === "active" ? (
                          <Button
                            variant="danger"
                            onClick={() => handleOpenSuspend(user)}
                            aria-label={`Tangguhkan ${user.fullName}`}
                          >
                            Tangguhkan
                          </Button>
                        ) : (
                          <Button
                            variant="secondary"
                            onClick={() => handleOpenUnsuspend(user)}
                            aria-label={`Aktifkan kembali ${user.fullName}`}
                          >
                            Aktifkan Kembali
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* User Detail Modal */}
      <Modal
        open={isDetailModalOpen}
        onClose={() => setIsDetailModalOpen(false)}
        title="Detail Pengguna & Aktivitas"
        description="Informasi akun pengguna, daftar undangan pernikahan, dan riwayat transaksi pesanan."
        size="form"
      >
        <div className="space-y-6 pt-2">
          {detailError ? (
            <p role="alert">{detailError}</p>
          ) : isLoadingDetail || !selectedUserDetail ? (
            <div className="py-8 text-center text-text-muted">
              Memuat detail akun...
            </div>
          ) : (
            <>
              {/* Account Overview Cards */}
              <div className="grid grid-cols-2 gap-4 rounded-lg border border-border bg-surface-subtle/30 p-4 text-sm">
                <div>
                  <div className="text-xs text-text-muted">Nama Lengkap</div>
                  <div className="font-semibold text-text">
                    {selectedUserDetail.fullName}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-text-muted">Email</div>
                  <div className="font-medium text-text">
                    {selectedUserDetail.email}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-text-muted">Nomor Telepon</div>
                  <div className="text-text">
                    {selectedUserDetail.phone || "-"}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-text-muted">Status Akun</div>
                  <div className="mt-0.5">
                    <Badge
                      tone={
                        selectedUserDetail.status === "active"
                          ? "success"
                          : "danger"
                      }
                    >
                      {selectedUserDetail.status === "active"
                        ? "Aktif"
                        : "Ditangguhkan"}
                    </Badge>
                  </div>
                </div>
                <div>
                  <div className="text-xs text-text-muted">Terdaftar Sejak</div>
                  <div className="text-text">
                    {formatDate(selectedUserDetail.createdAt)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-text-muted">ID Pengguna</div>
                  <div
                    className="font-mono text-xs text-text-muted truncate"
                    title={selectedUserDetail.id}
                  >
                    {selectedUserDetail.id}
                  </div>
                </div>
              </div>

              {/* Associated Invitations */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold text-text">
                    Daftar Undangan Pernikahan
                  </h4>
                  <Badge tone="neutral">
                    {selectedUserDetail.invitations.length} Undangan
                  </Badge>
                </div>
                {selectedUserDetail.invitations.length === 0 ? (
                  <div className="rounded border border-dashed border-border p-4 text-center text-sm text-text-muted">
                    Pengguna belum membuat undangan apapun.
                  </div>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {selectedUserDetail.invitations.map((inv) => (
                      <div
                        key={inv.id}
                        className="flex items-center justify-between rounded-md border border-border p-3 text-sm bg-surface"
                      >
                        <div>
                          <div className="font-medium text-text">
                            {inv.internalName || inv.slug}
                          </div>
                          <div className="text-xs text-text-muted">
                            Slug: <span className="font-mono">/{inv.slug}</span>{" "}
                            • Templat: {inv.templateId}
                          </div>
                        </div>
                        <div className="text-right">
                          <Badge
                            tone={
                              inv.status === "published"
                                ? "success"
                                : inv.status === "draft"
                                  ? "neutral"
                                  : "warning"
                            }
                          >
                            {inv.status}
                          </Badge>
                          <div className="mt-1 text-xs text-text-muted">
                            {formatDate(inv.createdAt)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Order History */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold text-text">
                    Riwayat Transaksi Pesanan
                  </h4>
                  <Badge tone="neutral">
                    {selectedUserDetail.orders.length} Pesanan
                  </Badge>
                </div>
                {selectedUserDetail.orders.length === 0 ? (
                  <div className="rounded border border-dashed border-border p-4 text-center text-sm text-text-muted">
                    Belum ada riwayat pesanan dari akun ini.
                  </div>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {selectedUserDetail.orders.map((ord) => (
                      <div
                        key={ord.id}
                        className="flex items-center justify-between rounded-md border border-border p-3 text-sm bg-surface"
                      >
                        <div>
                          <div className="font-medium text-text">
                            Paket {ord.packageId.toUpperCase()}
                          </div>
                          <div className="text-xs text-text-muted">
                            ID: <span className="font-mono">{ord.id}</span>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-semibold text-text">
                            {formatCurrency(ord.amountTotal)}
                          </div>
                          <div className="mt-0.5">
                            <Badge
                              tone={
                                ord.status === "paid" ? "success" : "neutral"
                              }
                            >
                              {ord.status}
                            </Badge>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Modal Actions */}
              <div className="flex items-center justify-between pt-4 border-t border-border">
                <div>
                  {selectedUserDetail.status === "active" ? (
                    <Button
                      variant="danger"
                      onClick={() => {
                        setIsDetailModalOpen(false);
                        handleOpenSuspend(selectedUserDetail);
                      }}
                    >
                      Tangguhkan Akun
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setIsDetailModalOpen(false);
                        handleOpenUnsuspend(selectedUserDetail);
                      }}
                    >
                      Aktifkan Kembali Akun
                    </Button>
                  )}
                </div>
                <Button
                  variant="secondary"
                  onClick={() => setIsDetailModalOpen(false)}
                >
                  Tutup
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>

      {/* Suspend Confirmation Modal */}
      <Modal
        open={isSuspendModalOpen}
        onClose={() => !isSubmittingAction && setIsSuspendModalOpen(false)}
        title="Tangguhkan Akun Pengguna"
        description={
          targetUser
            ? `Tangguhkan akses login untuk ${targetUser.fullName} (${targetUser.email}).`
            : "Tangguhkan akses login pengguna."
        }
        size="confirmation"
      >
        <div className="space-y-4 pt-2">
          {/* Important business rule notice */}
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3.5 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
            <span className="font-bold">Perhatian:</span> Menangguhkan akun akan
            menghentikan akses login pengguna. Undangan yang sudah terbit tetap
            aktif dan dapat diakses tamu (BR-Admin.6).
          </div>

          <Textarea
            label="Alasan Penangguhan (Wajib untuk audit)"
            placeholder="Tuliskan alasan penangguhan akun pengguna secara spesifik (minimal 5 karakter)..."
            value={actionReason}
            onChange={(e) => {
              setActionReason(e.target.value);
              if (actionError) setActionError(null);
            }}
            rows={3}
            required
            helperText="Alasan akan dicatat pada log audit administratif platform."
            error={actionError || undefined}
          />

          <div className="flex items-center justify-end gap-3 pt-3">
            <Button
              variant="secondary"
              onClick={() => setIsSuspendModalOpen(false)}
              disabled={isSubmittingAction}
            >
              Batal
            </Button>
            <Button
              variant="danger"
              onClick={() => setIsStepUpOpen(true)}
              disabled={isSubmittingAction || actionReason.trim().length < 5}
            >
              {isSubmittingAction
                ? "Menangguhkan..."
                : "Konfirmasi Penangguhan"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Unsuspend Confirmation Modal */}
      {isStepUpOpen && (
        <StepUpModal
          open
          onClose={() => setIsStepUpOpen(false)}
          actionTitle="Penangguhan Akun"
          onSuccess={(token) => void handleConfirmSuspend(token)}
        />
      )}
      <Modal
        open={isUnsuspendModalOpen}
        onClose={() => !isSubmittingAction && setIsUnsuspendModalOpen(false)}
        title="Aktifkan Kembali Akun Pengguna"
        description={
          targetUser
            ? `Pulihkan akses login untuk ${targetUser.fullName} (${targetUser.email}).`
            : "Pulihkan akses login pengguna."
        }
        size="confirmation"
      >
        <div className="space-y-4 pt-2">
          <p className="text-sm text-text-muted">
            Pengguna akan dapat kembali melakukan autentikasi login dan
            mengelola undangan mereka pada platform.
          </p>

          <Textarea
            label="Alasan Pengaktifan Kembali (Wajib untuk audit)"
            placeholder="Tuliskan alasan pengaktifan akun (misal: verifikasi identitas tiket support berhasil)..."
            value={actionReason}
            onChange={(e) => {
              setActionReason(e.target.value);
              if (actionError) setActionError(null);
            }}
            rows={3}
            required
            helperText="Alasan akan dicatat pada log audit administratif platform."
            error={actionError || undefined}
          />

          <div className="flex items-center justify-end gap-3 pt-3">
            <Button
              variant="secondary"
              onClick={() => setIsUnsuspendModalOpen(false)}
              disabled={isSubmittingAction}
            >
              Batal
            </Button>
            <Button
              variant="primary"
              onClick={handleConfirmUnsuspend}
              disabled={isSubmittingAction || actionReason.trim().length < 5}
            >
              {isSubmittingAction
                ? "Memproses..."
                : "Konfirmasi Aktifkan Kembali"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
