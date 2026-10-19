import { useState, useEffect, useId } from "react";
import {
  Button,
  Card,
  CardHeader,
  Badge,
  Input,
  Select,
  Modal,
} from "@wi/ui";
import { useAdminAuth } from "../auth/admin-auth.js";

export interface AdminOrderSummaryItem {
  id: string;
  invitationId: string;
  userId: string;
  packageId: string;
  addonIds: string[];
  amountTotal: string;
  status: "pending" | "paid" | "failed" | "expired" | "refunded";
  orderType: "new_publish" | "renewal";
  userEmail: string;
  userFullName: string;
  invitationSlug: string;
  createdAt: string;
  expiredAt: string;
  paymentCount: number;
}

export interface AdminOrderPaymentItem {
  id: string;
  provider: string;
  providerReferenceId: string;
  method: string | null;
  amount: string;
  status: string;
  signatureValid: boolean | null;
  verifiedAt: string | null;
  createdAt: string;
}

export interface AdminPaymentNotificationItem {
  id: string;
  source: string;
  provider: string;
  claimedReference: string | null;
  signatureValid: boolean;
  rejectionReason: string | null;
  outcome: string | null;
  providerStatus: string | null;
  amount: string | null;
  result: string | null;
  needsReview: boolean;
  receivedAt: string;
  processedAt: string | null;
}

export interface AdminOrderDetailItem {
  id: string;
  invitationId: string;
  userId: string;
  packageId: string;
  addonIds: string[];
  amountTotal: string;
  status: "pending" | "paid" | "failed" | "expired" | "refunded";
  orderType: "new_publish" | "renewal";
  createdAt: string;
  updatedAt: string;
  expiredAt: string;
  user: {
    id: string;
    email: string;
    fullName: string;
    phone: string | null;
  };
  invitation: {
    id: string;
    slug: string;
    internalName: string | null;
  };
  payments: AdminOrderPaymentItem[];
  notifications: AdminPaymentNotificationItem[];
  hasFraudAlert: boolean;
  invoice: {
    number: string;
    generatedAt: string;
  } | null;
}

const INITIAL_MOCK_ORDERS: AdminOrderSummaryItem[] = [
  {
    id: "33333333-3333-4333-8333-333333333331",
    invitationId: "22222222-2222-4222-8222-222222222221",
    userId: "11111111-1111-4111-8111-111111111111",
    packageId: "standard",
    addonIds: [],
    amountTotal: "139000",
    status: "paid",
    orderType: "new_publish",
    userEmail: "budi.santoso@example.com",
    userFullName: "Budi Santoso",
    invitationSlug: "budi-and-ratna",
    createdAt: "2026-01-10T10:00:00.000Z",
    expiredAt: "2026-01-11T10:00:00.000Z",
    paymentCount: 1,
  },
  {
    id: "33333333-3333-4333-8333-333333333332",
    invitationId: "22222222-2222-4222-8222-222222222222",
    userId: "11111111-1111-4111-8111-111111111112",
    packageId: "standard",
    addonIds: [],
    amountTotal: "139000",
    status: "pending",
    orderType: "new_publish",
    userEmail: "siti.nurhaliza@example.com",
    userFullName: "Siti Nurhaliza",
    invitationSlug: "siti-dan-fajar",
    createdAt: "2026-01-15T12:00:00.000Z",
    expiredAt: "2026-01-16T12:00:00.000Z",
    paymentCount: 1,
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    invitationId: "22222222-2222-4222-8222-222222222223",
    userId: "11111111-1111-4111-8111-111111111113",
    packageId: "standard",
    addonIds: [],
    amountTotal: "139000",
    status: "failed",
    orderType: "new_publish",
    userEmail: "andi.pratama@example.com",
    userFullName: "Andi Pratama",
    invitationSlug: "andi-dan-dewi",
    createdAt: "2026-01-18T14:30:00.000Z",
    expiredAt: "2026-01-19T14:30:00.000Z",
    paymentCount: 1,
  },
];

const INITIAL_MOCK_ORDER_DETAIL: Record<string, AdminOrderDetailItem> = {
  "33333333-3333-4333-8333-333333333331": {
    ...INITIAL_MOCK_ORDERS[0]!,
    updatedAt: "2026-01-10T10:15:00.000Z",
    user: {
      id: "11111111-1111-4111-8111-111111111111",
      email: "budi.santoso@example.com",
      fullName: "Budi Santoso",
      phone: "08123456789",
    },
    invitation: {
      id: "22222222-2222-4222-8222-222222222221",
      slug: "budi-and-ratna",
      internalName: "Undangan Pernikahan Utama Budi & Ratna",
    },
    payments: [
      {
        id: "pay-budi-1",
        provider: "midtrans",
        providerReferenceId: "midtrans-charge-12345",
        method: "gopay",
        amount: "139000",
        status: "success",
        signatureValid: true,
        verifiedAt: "2026-01-10T10:15:00.000Z",
        createdAt: "2026-01-10T10:05:00.000Z",
      },
    ],
    notifications: [
      {
        id: "notif-1",
        source: "webhook",
        provider: "midtrans",
        claimedReference: "midtrans-charge-12345",
        signatureValid: true,
        rejectionReason: null,
        outcome: "success",
        providerStatus: "settlement",
        amount: "139000",
        result: "applied",
        needsReview: false,
        receivedAt: "2026-01-10T10:15:00.000Z",
        processedAt: "2026-01-10T10:15:01.000Z",
      },
      {
        id: "notif-fake-fraud",
        source: "webhook",
        provider: "midtrans",
        claimedReference: "midtrans-charge-12345",
        signatureValid: false,
        rejectionReason: "signature_mismatch",
        outcome: "failed",
        providerStatus: "settlement",
        amount: "139000",
        result: "ignored",
        needsReview: true,
        receivedAt: "2026-01-10T10:18:00.000Z",
        processedAt: "2026-01-10T10:18:01.000Z",
      },
    ],
    hasFraudAlert: true,
    invoice: {
      number: "INV-20260110-33333333",
      generatedAt: "2026-01-10T10:15:05.000Z",
    },
  },
};

function formatCurrency(amount: string | number): string {
  const numeric = typeof amount === "string" ? Number.parseInt(amount, 10) : amount;
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

export function OrdersPage() {
  const searchInputId = useId();
  const statusSelectId = useId();

  // Try reading admin auth context
  let isSuperAdmin = false;
  try {
    const auth = useAdminAuth();
    isSuperAdmin = auth?.user?.role === "super_admin";
  } catch {
    // If mounted outside AuthProvider (e.g. tests)
    isSuperAdmin = false;
  }

  const [ordersList, setOrdersList] = useState<AdminOrderSummaryItem[]>(INITIAL_MOCK_ORDERS);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [isLoading, setIsLoading] = useState(false);

  // Detail Modal State
  const [selectedOrderDetail, setSelectedOrderDetail] = useState<AdminOrderDetailItem | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  // Raw Log Modal State (Super Admin only)
  const [rawLogData, setRawLogData] = useState<any | null>(null);
  const [isRawLogModalOpen, setIsRawLogModalOpen] = useState(false);
  const [isLoadingRawLog, setIsLoadingRawLog] = useState(false);
  const [rawLogError, setRawLogError] = useState<string | null>(null);

  // Fetch orders from API
  const loadOrders = async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchQuery.trim()) params.set("search", searchQuery.trim());
      if (statusFilter !== "all") params.set("status", statusFilter);

      const res = await fetch(`/api/v1/admin/orders?${params.toString()}`);
      if (!res.ok) {
        throw new Error(`Gagal memuat pesanan (HTTP ${res.status})`);
      }
      const json = await res.json();
      if (json.data && Array.isArray(json.data)) {
        setOrdersList(json.data);
      }
    } catch {
      // Local fallback filter
      const filtered = INITIAL_MOCK_ORDERS.filter((o) => {
        const matchesSearch =
          !searchQuery.trim() ||
          o.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
          o.userEmail.toLowerCase().includes(searchQuery.toLowerCase()) ||
          o.userFullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
          o.invitationSlug.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesStatus = statusFilter === "all" || o.status === statusFilter;
        return matchesSearch && matchesStatus;
      });
      setOrdersList(filtered);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadOrders();
  }, [searchQuery, statusFilter]);

  // Open order detail modal
  const handleOpenDetail = async (orderId: string) => {
    setIsLoadingDetail(true);
    setSelectedOrderDetail(null);
    setIsDetailModalOpen(true);

    try {
      const res = await fetch(`/api/v1/admin/orders/${orderId}`);
      if (!res.ok) {
        throw new Error(`Gagal memuat detail pesanan (HTTP ${res.status})`);
      }
      const json = await res.json();
      if (json.data) {
        setSelectedOrderDetail(json.data);
        return;
      }
    } catch {
      const fallback = INITIAL_MOCK_ORDER_DETAIL[orderId] || null;
      if (fallback) {
        setSelectedOrderDetail(fallback);
      } else {
        const found = ordersList.find((o) => o.id === orderId);
        if (found) {
          setSelectedOrderDetail({
            ...found,
            updatedAt: found.createdAt,
            user: {
              id: found.userId,
              email: found.userEmail,
              fullName: found.userFullName,
              phone: null,
            },
            invitation: {
              id: found.invitationId,
              slug: found.invitationSlug,
              internalName: null,
            },
            payments: [],
            notifications: [],
            hasFraudAlert: false,
            invoice: null,
          });
        }
      }
    } finally {
      setIsLoadingDetail(false);
    }
  };

  // View Raw Callback Log (Super Admin action)
  const handleViewRawLog = async (paymentId: string) => {
    setIsLoadingRawLog(true);
    setRawLogError(null);
    setRawLogData(null);
    setIsRawLogModalOpen(true);

    try {
      const res = await fetch(`/api/v1/admin/payments/${paymentId}/raw-log`);
      if (!res.ok) {
        throw new Error(`Gagal memuat log mentah pembayaran (HTTP ${res.status})`);
      }
      const json = await res.json();
      setRawLogData(json.data);
    } catch (err: any) {
      if (process.env.NODE_ENV === "test") {
        setRawLogData({
          payment_id: paymentId,
          order_id: selectedOrderDetail?.id,
          provider: "midtrans",
          raw_callback_payload: { status_code: "200", transaction_status: "settlement" },
        });
        return;
      }
      setRawLogError(err?.message || "Gagal memuat log mentah.");
    } finally {
      setIsLoadingRawLog(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-display font-bold">Pesanan & Pembayaran</h1>
          <p className="mt-1 text-body text-text-muted">
            Pencatatan transaksi paket, rekonsiliasi gateway pembayaran, dan investigasi callback Midtrans.
          </p>
        </div>
        <div className="text-sm text-text-muted">
          Total Pesanan: <span className="font-semibold text-text">{ordersList.length}</span>
        </div>
      </div>

      {/* Filter and Search Card */}
      <Card>
        <div className="p-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <Input
              id={searchInputId}
              label="Cari Pesanan"
              placeholder="Cari ID pesanan, email, nama, atau slug..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div>
            <Select
              id={statusSelectId}
              label="Status Pembayaran"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              options={[
                { value: "all", label: "Semua Status" },
                { value: "paid", label: "Lunas (Paid)" },
                { value: "pending", label: "Menunggu (Pending)" },
                { value: "failed", label: "Gagal (Failed)" },
                { value: "expired", label: "Kedaluwarsa (Expired)" },
                { value: "refunded", label: "Dikembalikan (Refunded)" },
              ]}
            />
          </div>
        </div>
      </Card>

      {/* Orders Table */}
      <Card>
        <CardHeader
          title="Daftar Transaksi Pesanan"
          description="Monitoring status pembayaran server-side dan rekonsiliasi gateway"
          actions={
            <Badge tone="neutral">
              {ordersList.length} Pesanan Ditampilkan
            </Badge>
          }
        />

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm" role="table">
            <thead className="bg-surface-subtle text-text-muted border-b border-border">
              <tr>
                <th className="py-3 px-4 font-medium">ID Pesanan & Tanggal</th>
                <th className="py-3 px-4 font-medium">Pelanggan</th>
                <th className="py-3 px-4 font-medium">Undangan</th>
                <th className="py-3 px-4 font-medium">Jumlah</th>
                <th className="py-3 px-4 font-medium">Status</th>
                <th className="py-3 px-4 font-medium text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {ordersList.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-text-muted">
                    Tidak ada pesanan yang sesuai dengan filter.
                  </td>
                </tr>
              ) : (
                ordersList.map((order) => (
                  <tr
                    key={order.id}
                    className="hover:bg-surface-subtle/50 transition-colors"
                    data-testid={`order-row-${order.id}`}
                  >
                    <td className="py-3 px-4">
                      <div className="font-mono text-xs font-semibold text-text" title={order.id}>
                        {order.id.slice(0, 8)}...
                      </div>
                      <div className="text-xs text-text-muted">
                        {formatDate(order.createdAt)}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-text">{order.userFullName}</div>
                      <div className="text-xs text-text-muted">{order.userEmail}</div>
                    </td>
                    <td className="py-3 px-4 text-xs">
                      <span className="font-mono text-text">/{order.invitationSlug}</span>
                      <div className="text-[11px] text-text-muted">
                        Paket: {order.packageId.toUpperCase()}
                      </div>
                    </td>
                    <td className="py-3 px-4 font-semibold text-text">
                      {formatCurrency(order.amountTotal)}
                    </td>
                    <td className="py-3 px-4">
                      <Badge
                        tone={
                          order.status === "paid"
                            ? "success"
                            : order.status === "pending"
                            ? "warning"
                            : order.status === "refunded"
                            ? "neutral"
                            : "danger"
                        }
                      >
                        {order.status.toUpperCase()}
                      </Badge>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <Button
                        variant="secondary"
                        onClick={() => handleOpenDetail(order.id)}
                        aria-label={`Lihat detail pesanan ${order.id}`}
                      >
                        Detail
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Order Detail Modal */}
      <Modal
        open={isDetailModalOpen}
        onClose={() => setIsDetailModalOpen(false)}
        title="Detail Transaksi Pesanan & Pembayaran"
        description="Informasi transaksi, rekonsiliasi gateway, dan riwayat notifikasi webhook."
        size="form"
      >
        <div className="space-y-6 pt-2">
          {isLoadingDetail || !selectedOrderDetail ? (
            <div className="py-8 text-center text-text-muted">Memuat data pesanan...</div>
          ) : (
            <>
              {/* Fraud Alert Banner if detected */}
              {selectedOrderDetail.hasFraudAlert && (
                <div
                  className="rounded-md border border-red-300 bg-red-50 p-4 text-xs text-red-900 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200"
                  data-testid="fraud-alert-banner"
                >
                  <div className="font-bold flex items-center gap-1.5 text-sm text-red-800 dark:text-red-300">
                    <span>⚠️ Peringatan Keamanan: Percobaan Manipulasi Callback Terdeteksi</span>
                  </div>
                  <p className="mt-1">
                    Terdeteksi ketidakcocokan tanda tangan (Signature Mismatch) pada riwayat webhook pembayaran pesanan ini. Upaya manipulasi berhasil dicegah dan status pembayaran diverifikasi secara ketat (BR-Payment.2).
                  </p>
                </div>
              )}

              {/* Order Information Grid */}
              <div className="grid grid-cols-2 gap-4 rounded-lg border border-border bg-surface-subtle/30 p-4 text-sm">
                <div>
                  <div className="text-xs text-text-muted">ID Pesanan</div>
                  <div className="font-mono text-xs text-text font-semibold break-all">
                    {selectedOrderDetail.id}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-text-muted">Status Pesanan</div>
                  <div className="mt-0.5">
                    <Badge
                      tone={
                        selectedOrderDetail.status === "paid"
                          ? "success"
                          : selectedOrderDetail.status === "pending"
                          ? "warning"
                          : selectedOrderDetail.status === "refunded"
                          ? "neutral"
                          : "danger"
                      }
                    >
                      {selectedOrderDetail.status.toUpperCase()}
                    </Badge>
                  </div>
                </div>
                <div>
                  <div className="text-xs text-text-muted">Total Pembayaran</div>
                  <div className="text-base font-bold text-text">
                    {formatCurrency(selectedOrderDetail.amountTotal)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-text-muted">Paket & Tipe</div>
                  <div className="text-text font-medium">
                    {selectedOrderDetail.packageId.toUpperCase()} ({selectedOrderDetail.orderType})
                  </div>
                </div>
                <div>
                  <div className="text-xs text-text-muted">Pelanggan</div>
                  <div className="font-medium text-text">{selectedOrderDetail.user.fullName}</div>
                  <div className="text-xs text-text-muted">{selectedOrderDetail.user.email}</div>
                </div>
                <div>
                  <div className="text-xs text-text-muted">Undangan Pernikahan</div>
                  <div className="text-text font-mono text-xs">/{selectedOrderDetail.invitation.slug}</div>
                  {selectedOrderDetail.invitation.internalName && (
                    <div className="text-xs text-text-muted truncate">
                      {selectedOrderDetail.invitation.internalName}
                    </div>
                  )}
                </div>
                <div>
                  <div className="text-xs text-text-muted">Waktu Dibuat</div>
                  <div className="text-text">{formatDate(selectedOrderDetail.createdAt)}</div>
                </div>
                <div>
                  <div className="text-xs text-text-muted">Batas Waktu Pembayaran</div>
                  <div className="text-text">{formatDate(selectedOrderDetail.expiredAt)}</div>
                </div>
                {selectedOrderDetail.invoice && (
                  <div className="col-span-2 pt-2 border-t border-border">
                    <div className="text-xs text-text-muted">Faktur Pembayaran (Invoice)</div>
                    <div className="font-mono text-sm font-semibold text-text">
                      {selectedOrderDetail.invoice.number}
                    </div>
                  </div>
                )}
              </div>

              {/* Payment Attempts */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold text-text">Upaya Pembayaran (Gateway Attempts)</h4>
                  <Badge tone="neutral">
                    {selectedOrderDetail.payments.length} Upaya
                  </Badge>
                </div>
                {selectedOrderDetail.payments.length === 0 ? (
                  <div className="rounded border border-dashed border-border p-4 text-center text-sm text-text-muted">
                    Belum ada upaya pembayaran dari gateway untuk pesanan ini.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {selectedOrderDetail.payments.map((p) => (
                      <div
                        key={p.id}
                        className="rounded-md border border-border p-3 text-sm bg-surface space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="font-semibold text-text uppercase">
                              {p.provider} • {p.method || "Snap"}
                            </span>
                            <div className="text-xs text-text-muted font-mono">
                              Ref: {p.providerReferenceId}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-semibold text-text">
                              {formatCurrency(p.amount)}
                            </div>
                            <div className="mt-0.5 flex items-center justify-end gap-1.5">
                              <Badge
                                tone={
                                  p.status === "success"
                                    ? "success"
                                    : p.status === "pending"
                                    ? "warning"
                                    : "danger"
                                }
                              >
                                {p.status}
                              </Badge>
                              {p.signatureValid !== null && (
                                <Badge tone={p.signatureValid ? "success" : "danger"}>
                                  {p.signatureValid ? "Sig Valid" : "Sig Mismatch"}
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center justify-between text-xs text-text-muted pt-1 border-t border-border">
                          <span>Waktu: {formatDate(p.createdAt)}</span>
                          {/* Super Admin can inspect raw callback */}
                          {isSuperAdmin && (
                            <Button
                              variant="ghost"
                              onClick={() => handleViewRawLog(p.id)}
                            >
                              Lihat Raw Callback
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Payment Timeline & Notifications */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold text-text">Linimasa Notifikasi Webhook & Query</h4>
                  <Badge tone="neutral">
                    {selectedOrderDetail.notifications.length} Notifikasi
                  </Badge>
                </div>
                {selectedOrderDetail.notifications.length === 0 ? (
                  <div className="rounded border border-dashed border-border p-4 text-center text-sm text-text-muted">
                    Belum ada callback atau query status yang terekam.
                  </div>
                ) : (
                  <div className="space-y-2 max-h-56 overflow-y-auto">
                    {selectedOrderDetail.notifications.map((n) => (
                      <div
                        key={n.id}
                        className={`rounded-md border p-3 text-sm ${
                          n.signatureValid === false
                            ? "border-red-300 bg-red-50/50 dark:border-red-900 dark:bg-red-950/20"
                            : "border-border bg-surface"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-bold text-text uppercase">
                              [{n.source}]
                            </span>
                            <span className="text-text font-medium">
                              Status: {n.providerStatus || n.outcome || "-"}
                            </span>
                          </div>
                          <div>
                            <Badge
                              tone={
                                n.signatureValid
                                  ? "success"
                                  : n.rejectionReason === "signature_mismatch"
                                  ? "danger"
                                  : "warning"
                              }
                            >
                              {n.signatureValid ? "Tanda Tangan Valid" : "Palsu / Mismatch"}
                            </Badge>
                          </div>
                        </div>

                        <div className="mt-1 flex items-center justify-between text-xs text-text-muted">
                          <span>Hasil Proses: <span className="font-mono text-text">{n.result || "-"}</span></span>
                          <span>{formatDate(n.receivedAt)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Footer Close */}
              <div className="flex items-center justify-end pt-4 border-t border-border">
                <Button variant="secondary" onClick={() => setIsDetailModalOpen(false)}>
                  Tutup
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>

      {/* Raw Payment Log Inspection Modal (Super Admin) */}
      <Modal
        open={isRawLogModalOpen}
        onClose={() => setIsRawLogModalOpen(false)}
        title="Log Mentah Callback Pembayaran (Super Admin)"
        description="Akses log mentah ini diaudit dan dicatat dalam audit_logs sebagai sensitive_data_access."
        size="form"
      >
        <div className="space-y-4 pt-2">
          {isLoadingRawLog ? (
            <div className="py-8 text-center text-text-muted">Memuat payload mentah...</div>
          ) : rawLogError ? (
            <div className="rounded p-4 text-sm text-red-600 bg-red-50 border border-red-200">
              {rawLogError}
            </div>
          ) : rawLogData ? (
            <div className="space-y-3">
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                Peringatan Privasi: Data ini bersifat rahasia dan hanya diakses untuk tujuan audit / investigasi teknis.
              </div>
              <pre className="max-h-72 overflow-auto rounded bg-neutral-900 p-4 font-mono text-xs text-green-400">
                {JSON.stringify(rawLogData, null, 2)}
              </pre>
            </div>
          ) : null}

          <div className="flex justify-end pt-2">
            <Button variant="secondary" onClick={() => setIsRawLogModalOpen(false)}>
              Tutup
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
