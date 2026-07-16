/**
 * Invoice sales summary — plain async helper (NOT a server fn) so HiveMind,
 * GrowthMind and AccountsMind server code can all consume paid-invoice sales
 * figures. Reads accountsmind_invoices via the admin client; callers are
 * responsible for their own auth/workspace gating.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type InvoiceSalesSummary = {
  currency: string;
  invoiceCount: number;
  paidCount: number;
  outstandingCount: number;
  overdueCount: number;
  totalInvoicedCents: number;
  paidSalesCents: number;
  outstandingCents: number;
  overdueCents: number;
  paidThisMonthCents: number;
  latestPaidAt: string | null;
};

const OPEN_STATUSES = ["unpaid", "sent", "overdue"];

export async function getInvoiceSalesSummary(workspaceId?: string): Promise<InvoiceSalesSummary> {
  // Page through all rows — PostgREST caps a single select at 1000 rows, which
  // would silently under-report totals once invoice volume grows.
  const PAGE = 1000;
  const rows: any[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = (supabaseAdmin as any)
      .from("accountsmind_invoices")
      .select("status,total_cents,currency,due_date,paid_at,created_at")
      .neq("storage_path", "pending")
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (workspaceId) q = q.eq("workspace_id", workspaceId);
    const { data, error } = await q;
    if (error) break;
    const batch: any[] = data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const todayStr = now.toISOString().slice(0, 10);

  const summary: InvoiceSalesSummary = {
    currency: rows[0]?.currency ?? "GBP",
    invoiceCount: 0,
    paidCount: 0,
    outstandingCount: 0,
    overdueCount: 0,
    totalInvoicedCents: 0,
    paidSalesCents: 0,
    outstandingCents: 0,
    overdueCents: 0,
    paidThisMonthCents: 0,
    latestPaidAt: null,
  };

  for (const r of rows) {
    const cents = Number(r.total_cents ?? 0);
    const status = String(r.status ?? "unpaid");
    if (status === "cancelled") continue;
    summary.invoiceCount += 1;
    summary.totalInvoicedCents += cents;
    if (status === "paid") {
      summary.paidCount += 1;
      summary.paidSalesCents += cents;
      if (r.paid_at && r.paid_at >= monthStart) summary.paidThisMonthCents += cents;
      if (r.paid_at && (!summary.latestPaidAt || r.paid_at > summary.latestPaidAt)) {
        summary.latestPaidAt = r.paid_at;
      }
    } else if (OPEN_STATUSES.includes(status)) {
      summary.outstandingCount += 1;
      summary.outstandingCents += cents;
      const isOverdue = status === "overdue" || (r.due_date && r.due_date < todayStr);
      if (isOverdue) {
        summary.overdueCount += 1;
        summary.overdueCents += cents;
      }
    }
  }
  return summary;
}
