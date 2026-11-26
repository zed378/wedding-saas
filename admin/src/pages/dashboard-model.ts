export interface DashboardSummary {
  generated_at: string;
  timezone: "UTC";
  revenue_basis: "paid_orders_amount_total_by_created_at_excluding_refunds";
  total_users: number;
  total_invitations: number;
  paid_orders: number;
  total_revenue: string;
  daily_revenue: string;
  monthly_revenue: string;
  invitations_by_status: Array<{ status: string; count: number }>;
  orders_by_day: Array<{ date: string; count: number; revenue: string }>;
  revenue_by_month: Array<{ month: string; revenue: string }>;
  funnel: { created: number; ever_paid: number; paid_and_published: number };
}

export const rupiah = (value: string) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(BigInt(value));

export const conversion = (count: number, created: number) =>
  created === 0 ? "0%" : `${((count / created) * 100).toFixed(1)}%`;
