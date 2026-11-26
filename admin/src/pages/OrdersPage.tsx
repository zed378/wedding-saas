import { useState, useEffect, useId, useMemo, useRef } from "react";
import { ApiClient, accessTokenStore } from "@wi/api-client";
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

  const client = useMemo(
    () => new ApiClient({ baseUrl: "", tokenStore: accessTokenStore }),
    [],
  );
  const listRequest = useRef(0);
  const detailRequest = useRef(0);
  const [ordersList, setOrdersList] = useState<AdminOrderSummaryItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [isLoading, setIsLoading] = useState(true);
  const [ordersError, setOrdersError] = useState<string | null>(null);

  // Detail Modal State
  const [selectedOrderDetail, setSelectedOrderDetail] =
    useState<AdminOrderDetailItem | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Raw Log Modal State (Super Admin only)
  const [rawLogData, setRawLogData] = useState<any | null>(null);
  const [isRawLogModalOpen, setIsRawLogModalOpen] = useState(false);
  const [isLoadingRawLog, setIsLoadingRawLog] = useState(false);
  const [rawLogError, setRawLogError] = useState<string | null>(null);

  // Refund Modal State (P5-08)
  const [targetOrderForRefund, setTargetOrderForRefund] = useState<
    AdminOrderSummaryItem | AdminOrderDetailItem | null
  >(null);
  const [isRefundModalOpen, setIsRefundModalOpen] = useState(false);
  const [refundReason, setRefundReason] = useState("");
  const [refundStepUpCode, setRefundStepUpCode] = useState("");
  const [isSubmittingRefund, setIsSubmittingRefund] = useState(false);
  const [refundError, setRefundError] = useState<string | null>(null);
  const [refundSuccessMessage, setRefundSuccessMessage] = useState<
    string | null
  >(null);

  // Fetch orders from API
  const loadOrders = async () => {
    const request = ++listRequest.current;
    setIsLoading(true);
    setOrdersError(null);
    setOrdersList([]);
    try {
      const params = new URLSearchParams();
      if (searchQuery.trim()) params.set("search", searchQuery.trim());
      if (statusFilter !== "all") params.set("status", statusFilter);

      const { data } = await client.get<AdminOrderSummaryItem[]>(
        `/api/v1/admin/orders?${params.toString()}`,
      );
      if (request === listRequest.current) setOrdersList(data);
    } catch {
      if (request === listRequest.current)
        setOrdersError("Daftar pesanan gagal dimuat. Coba lagi.");
    } finally {
      if (request === listRequest.current) setIsLoading(false);
    }
  };

  useEffect(() => {
    loadOrders();
  }, [searchQuery, statusFilter]);

  // Open order detail modal
  const handleOpenDetail = async (orderId: string) => {
    const request = ++detailRequest.current;
    setIsLoadingDetail(true);
    setSelectedOrderDetail(null);
    setIsDetailModalOpen(true);
    setDetailError(null);

    try {
      const { data } = await client.get<AdminOrderDetailItem>(
        `/api/v1/admin/orders/${orderId}`,
      );
      if (request === detailRequest.current) setSelectedOrderDetail(data);
    } catch {
      if (request === detailRequest.current)
        setDetailError("Detail pesanan gagal dimuat. Tutup dan coba lagi.");
    } finally {
      if (request === detailRequest.current) setIsLoadingDetail(false);
    }
  };

  // View Raw Callback Log (Super Admin action)
  const handleViewRawLog = async (paymentId: string) => {
    setIsLoadingRawLog(true);
    setRawLogError(null);
    setRawLogData(null);
    setIsRawLogModalOpen(true);

    try {
      const { data } = await client.get<unknown>(
        `/api/v1/admin/payments/${paymentId}/raw-log`,
      );
      setRawLogData(data);
    } catch (err: any) {
      setRawLogError(err?.message || "Gagal memuat log mentah.");
    } finally {
      setIsLoadingRawLog(false);
    }
  };

  // Open Refund Modal (P5-08)
  const handleOpenRefund = (
    order: AdminOrderSummaryItem | AdminOrderDetailItem,
  ) => {
    setTargetOrderForRefund(order);
    setRefundReason("");
    setRefundStepUpCode("");
    setRefundError(null);
    setRefundSuccessMessage(null);
    setIsRefundModalOpen(true);
  };

  // Process Refund Submission (P5-08)
  const handleConfirmRefund = async () => {
    if (!targetOrderForRefund) return;
    if (refundReason.trim().length < 5) {
      setRefundError("Alasan refund minimal 5 karakter.");
      return;
    }
    if (!/^\d{6}$/.test(refundStepUpCode)) {
      setRefundError("Masukkan kode TOTP 6 digit yang valid.");
      return;
    }

    setIsSubmittingRefund(true);
    setRefundError(null);

    try {
      const verification = await client.post<{ step_up_token: string }>(
        "/api/v1/auth/mfa/step-up",
        { code: refundStepUpCode.trim() },
      );
      if (!verification.data.step_up_token)
        throw new Error("Verifikasi 2FA gagal.");
      setRefundStepUpCode("");
      const { data } = await client.post<{ message: string }>(
        `/api/v1/admin/orders/${targetOrderForRefund.id}/refund`,
        {
          reason: refundReason.trim(),
        },
        { headers: { "X-MFA-Step-Up": verification.data.step_up_token } },
      );

      setRefundSuccessMessage(
        data.message ||
          "Pesanan berhasil direfund dan status undangan dikembalikan ke draft.",
      );

      // Refresh list
      loadOrders();

      // If detail modal was open for this order, update its status
      if (
        selectedOrderDetail &&
        selectedOrderDetail.id === targetOrderForRefund.id
      ) {
        setSelectedOrderDetail({
          ...selectedOrderDetail,
          status: "refunded",
        });
      }
    } catch (err: any) {
      setRefundError(
        err?.message || "Terjadi kesalahan saat memproses refund.",
      );
    } finally {
      setIsSubmittingRefund(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-display font-bold">Pesanan &amp; Pembayaran</h1>
          <p className="mt-1 text-body text-text-muted">
            Pencatatan transaksi paket, rekonsiliasi gateway pembayaran, dan
            investigasi callback Midtrans.
          </p>
        </div>
        <div className="text-sm text-text-muted">
          Total Pesanan:{" "}
          <span className="font-semibold text-text">{ordersList.length}</span>
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
                <th className="py-3 px-4 font-medium">
                  ID Pesanan &amp; Tanggal
                </th>
                <th className="py-3 px-4 font-medium">Pelanggan</th>
                <th className="py-3 px-4 font-medium">Undangan</th>
                <th className="py-3 px-4 font-medium">Jumlah</th>
                <th className="py-3 px-4 font-medium">Status</th>
                <th className="py-3 px-4 font-medium text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <tr>
                  <td colSpan={6} role="status" className="p-4">
                    Memuat pesanan…
                  </td>
                </tr>
              ) : ordersError ? (
                <tr>
                  <td colSpan={6} className="p-4">
                    <p role="alert">{ordersError}</p>
                    <Button onClick={() => void loadOrders()}>Coba lagi</Button>
                  </td>
                </tr>
              ) : ordersList.length === 0 ? (
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
                      <div
                        className="font-mono text-xs font-semibold text-text"
                        title={order.id}
                      >
                        {order.id.slice(0, 8)}...
                      </div>
                      <div className="text-xs text-text-muted">
                        {formatDate(order.createdAt)}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-text">
                        {order.userFullName}
                      </div>
                      <div className="text-xs text-text-muted">
                        {order.userEmail}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-xs">
                      <span className="font-mono text-text">
                        /{order.invitationSlug}
                      </span>
                      <div className="text-xs text-text-muted">
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
                      <div className="flex items-center justify-end gap-2">
                        {order.status === "paid" && (
                          <Button
                            variant="secondary"
                            onClick={() => handleOpenRefund(order)}
                            aria-label={`Refund pesanan ${order.id}`}
                          >
                            Refund
                          </Button>
                        )}
                        <Button
                          variant="secondary"
                          onClick={() => handleOpenDetail(order.id)}
                          aria-label={`Lihat detail pesanan ${order.id}`}
                        >
                          Detail
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

      {/* Order Detail Modal */}
      <Modal
        open={isDetailModalOpen}
        onClose={() => setIsDetailModalOpen(false)}
        title="Detail Transaksi Pesanan &amp; Pembayaran"
        description="Informasi transaksi, rekonsiliasi gateway, dan riwayat notifikasi webhook."
        size="form"
      >
        <div className="space-y-6 pt-2">
          {detailError ? (
            <p role="alert">{detailError}</p>
          ) : isLoadingDetail || !selectedOrderDetail ? (
            <div className="py-8 text-center text-text-muted">
              Memuat data pesanan...
            </div>
          ) : (
            <>
              {/* Fraud Alert Banner if detected */}
              {selectedOrderDetail.hasFraudAlert && (
                <div
                  className="rounded-md border border-red-300 bg-red-50 p-4 text-xs text-red-900 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200"
                  data-testid="fraud-alert-banner"
                >
                  <div className="font-bold flex items-center gap-1.5 text-sm text-red-800 dark:text-red-300">
                    <span>
                      ⚠️ Peringatan Keamanan: Percobaan Manipulasi Callback
                      Terdeteksi
                    </span>
                  </div>
                  <p className="mt-1">
                    Terdeteksi ketidakcocokan tanda tangan (Signature Mismatch)
                    pada riwayat webhook pembayaran pesanan ini. Upaya
                    manipulasi berhasil dicegah dan status pembayaran
                    diverifikasi secara ketat (BR-Payment.2).
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
                  <div className="text-xs text-text-muted">
                    Total Pembayaran
                  </div>
                  <div className="text-base font-bold text-text">
                    {formatCurrency(selectedOrderDetail.amountTotal)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-text-muted">
                    Paket &amp; Tipe
                  </div>
                  <div className="text-text font-medium">
                    {selectedOrderDetail.packageId.toUpperCase()} (
                    {selectedOrderDetail.orderType})
                  </div>
                </div>
                <div>
                  <div className="text-xs text-text-muted">Pelanggan</div>
                  <div className="font-medium text-text">
                    {selectedOrderDetail.user.fullName}
                  </div>
                  <div className="text-xs text-text-muted">
                    {selectedOrderDetail.user.email}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-text-muted">
                    Undangan Pernikahan
                  </div>
                  <div className="text-text font-mono text-xs">
                    /{selectedOrderDetail.invitation.slug}
                  </div>
                  {selectedOrderDetail.invitation.internalName && (
                    <div className="text-xs text-text-muted truncate">
                      {selectedOrderDetail.invitation.internalName}
                    </div>
                  )}
                </div>
                <div>
                  <div className="text-xs text-text-muted">Waktu Dibuat</div>
                  <div className="text-text">
                    {formatDate(selectedOrderDetail.createdAt)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-text-muted">
                    Batas Waktu Pembayaran
                  </div>
                  <div className="text-text">
                    {formatDate(selectedOrderDetail.expiredAt)}
                  </div>
                </div>
                {selectedOrderDetail.invoice && (
                  <div className="col-span-2 pt-2 border-t border-border">
                    <div className="text-xs text-text-muted">
                      Faktur Pembayaran (Invoice)
                    </div>
                    <div className="font-mono text-sm font-semibold text-text">
                      {selectedOrderDetail.invoice.number}
                    </div>
                  </div>
                )}
              </div>

              {/* Payment Attempts */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold text-text">
                    Upaya Pembayaran (Gateway Attempts)
                  </h4>
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
                                <Badge
                                  tone={p.signatureValid ? "success" : "danger"}
                                >
                                  {p.signatureValid
                                    ? "Sig Valid"
                                    : "Sig Mismatch"}
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
                  <h4 className="font-semibold text-text">
                    Linimasa Notifikasi Webhook &amp; Query
                  </h4>
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
                              {n.signatureValid
                                ? "Tanda Tangan Valid"
                                : "Palsu / Mismatch"}
                            </Badge>
                          </div>
                        </div>

                        <div className="mt-1 flex items-center justify-between text-xs text-text-muted">
                          <span>
                            Hasil Proses:{" "}
                            <span className="font-mono text-text">
                              {n.result || "-"}
                            </span>
                          </span>
                          <span>{formatDate(n.receivedAt)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Footer Close & Actions */}
              <div className="flex items-center justify-between pt-4 border-t border-border">
                <div>
                  {selectedOrderDetail.status === "paid" && (
                    <Button
                      variant="danger"
                      onClick={() => {
                        setIsDetailModalOpen(false);
                        handleOpenRefund(selectedOrderDetail);
                      }}
                    >
                      Refund Pesanan
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
            <div className="py-8 text-center text-text-muted">
              Memuat payload mentah...
            </div>
          ) : rawLogError ? (
            <div className="rounded p-4 text-sm text-red-600 bg-red-50 border border-red-200">
              {rawLogError}
            </div>
          ) : rawLogData ? (
            <div className="space-y-3">
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                Peringatan Privasi: Data ini bersifat rahasia dan hanya diakses
                untuk tujuan audit / investigasi teknis.
              </div>
              <pre className="max-h-72 overflow-auto rounded bg-neutral-900 p-4 font-mono text-xs text-green-400">
                {JSON.stringify(rawLogData, null, 2)}
              </pre>
            </div>
          ) : null}

          <div className="flex justify-end pt-2">
            <Button
              variant="secondary"
              onClick={() => setIsRawLogModalOpen(false)}
            >
              Tutup
            </Button>
          </div>
        </div>
      </Modal>

      {/* Refund Confirmation Modal (P5-08) */}
      <Modal
        open={isRefundModalOpen}
        onClose={() => !isSubmittingRefund && setIsRefundModalOpen(false)}
        title="Proses Refund Pesanan (Manual)"
        description={
          targetOrderForRefund
            ? `Pembatalan pesanan ${targetOrderForRefund.id.slice(0, 8)}... untuk ${"userFullName" in targetOrderForRefund ? targetOrderForRefund.userFullName : targetOrderForRefund.user.fullName} (${formatCurrency(targetOrderForRefund.amountTotal)})`
            : "Pembatalan pesanan dan reset status undangan."
        }
        size="confirmation"
      >
        <div className="space-y-4 pt-2">
          {/* Important business rule notice (ADR-019 & BR-5.4) */}
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3.5 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
            <span className="font-bold">
              Perhatian (ADR-019 &amp; Kebijakan Entitlement):
            </span>
            <ul className="mt-1 list-disc pl-4 space-y-0.5">
              <li>
                Status pesanan akan diubah menjadi{" "}
                <strong className="font-semibold">REFUNDED</strong>.
              </li>
              <li>
                Status undangan akan otomatis dikembalikan ke{" "}
                <strong className="font-semibold">DRAFT</strong>.
              </li>
              <li>
                Cache halaman undangan publik akan segera dibersihkan
                (invalidated).
              </li>
            </ul>
          </div>

          <div className="rounded-md border border-blue-300 bg-blue-50 p-3 text-xs text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-200">
            <span className="font-bold">Peringatan Aliran Dana (Manual):</span>{" "}
            Sistem ini hanya membatalkan status di database aplikasi. Anda wajib
            memproses pengembalian dana riil secara manual ke rekening/e-wallet
            pelanggan melalui dashboard Midtrans.
          </div>

          <Textarea
            label="Alasan Refund (Wajib untuk audit log)"
            maxLength={500}
            placeholder="Tuliskan alasan pengembalian dana (minimal 5 karakter)..."
            value={refundReason}
            onChange={(e) => {
              setRefundReason(e.target.value);
              if (refundError) setRefundError(null);
            }}
            disabled={isSubmittingRefund}
          />

          <Input
            label="Kode 2FA / TOTP Authenticator (Step-up Verification)"
            placeholder="6-digit kode TOTP (misal 123456)"
            value={refundStepUpCode}
            inputMode="numeric"
            maxLength={6}
            autoComplete="one-time-code"
            onChange={(e) => {
              setRefundStepUpCode(e.target.value.replace(/\D/g, ""));
              if (refundError) setRefundError(null);
            }}
            disabled={isSubmittingRefund}
          />

          {refundError && (
            <div
              role="alert"
              className="rounded bg-red-50 p-3 text-xs text-red-600 dark:bg-red-950/50 dark:text-red-400"
            >
              {refundError}
            </div>
          )}

          {refundSuccessMessage && (
            <div
              role="status"
              className="rounded bg-green-50 p-3 text-xs text-green-700 dark:bg-green-950/50 dark:text-green-300"
            >
              {refundSuccessMessage}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              variant="secondary"
              onClick={() => setIsRefundModalOpen(false)}
              disabled={isSubmittingRefund}
            >
              Batal
            </Button>
            <Button
              variant="danger"
              onClick={handleConfirmRefund}
              disabled={
                isSubmittingRefund ||
                !!refundSuccessMessage ||
                refundReason.trim().length < 5 ||
                !/^\d{6}$/.test(refundStepUpCode)
              }
            >
              {isSubmittingRefund ? "Memproses..." : "Konfirmasi Refund"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
