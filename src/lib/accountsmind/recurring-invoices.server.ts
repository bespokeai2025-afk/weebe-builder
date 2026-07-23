/**
 * Recurring invoice generator (Phase 2).
 *
 * Draft-first by design: each active schedule creates ONE draft invoice per
 * month (on/after its day_of_month) — nothing is ever auto-sent. Called from
 * runAccountsMindTick so it runs hourly in dev (Vite plugin) and in prod via
 * the campaign-executor cron with zero extra wiring.
 *
 * Relative imports only — this module is reachable from vite-config-loaded
 * code paths where "@/" aliases are unavailable.
 */
import { computeInvoiceTotals, type TaxMode } from "./invoice-totals.shared";

export interface RecurringTickResult {
  scanned: number;
  generated: number;
  failed: Array<{ scheduleId: string; error: string }>;
}

async function nextInvoiceNumber(sb: any): Promise<string> {
  const { data: s } = await sb
    .from("accountsmind_invoice_settings")
    .select("number_prefix,number_include_year,number_pad_width")
    .eq("id", 1)
    .maybeSingle();
  const prefixBase = String(s?.number_prefix ?? "INV").trim() || "INV";
  const year = new Date().getUTCFullYear();
  const prefix = s?.number_include_year === false ? `${prefixBase}-` : `${prefixBase}-${year}-`;
  const pad = Math.min(8, Math.max(1, Number(s?.number_pad_width ?? 4)));
  const { data } = await sb
    .from("accountsmind_invoices")
    .select("invoice_number")
    .like("invoice_number", `${prefix}%`)
    .order("invoice_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  const last = data?.invoice_number ? parseInt(String(data.invoice_number).slice(prefix.length), 10) : 0;
  return `${prefix}${String((Number.isFinite(last) ? last : 0) + 1).padStart(pad, "0")}`;
}

export async function runRecurringInvoicesTick(sb: any): Promise<RecurringTickResult> {
  const result: RecurringTickResult = { scanned: 0, generated: 0, failed: [] };
  const now = new Date();
  const month = now.toISOString().slice(0, 7); // YYYY-MM
  const dayOfMonth = now.getUTCDate();

  const { data: schedules, error } = await sb
    .from("accountsmind_recurring_invoices")
    .select("*")
    .eq("active", true)
    .limit(200);
  if (error || !schedules?.length) return result;

  for (const sched of schedules) {
    result.scanned++;
    try {
      if (sched.last_generated_month === month) continue;
      if (dayOfMonth < Number(sched.day_of_month ?? 1)) continue;

      // CAS claim on last_generated_month so concurrent ticks generate once.
      const { data: claimed } = await sb
        .from("accountsmind_recurring_invoices")
        .update({ last_generated_month: month, updated_at: now.toISOString() })
        .eq("id", sched.id)
        .eq("active", true)
        .filter("last_generated_month", sched.last_generated_month === null ? "is" : "eq", sched.last_generated_month)
        .select("id")
        .maybeSingle();
      if (!claimed) continue;

      const { data: ws } = await sb.from("workspaces").select("id,name").eq("id", sched.workspace_id).maybeSingle();
      if (!ws) throw new Error("workspace not found");

      const items = Array.isArray(sched.items_json) ? sched.items_json : [];
      if (items.length === 0) throw new Error("schedule has no line items");
      const taxMode: TaxMode = sched.tax_mode === "inclusive" ? "inclusive" : "exclusive";
      const totals = computeInvoiceTotals(items, { taxMode });

      const issueDate = now.toISOString().slice(0, 10);
      const due = new Date(now.getTime() + Number(sched.due_days ?? 30) * 86400000).toISOString().slice(0, 10);

      let inserted: any = null;
      for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
        const num = await nextInvoiceNumber(sb);
        const ins = await sb
          .from("accountsmind_invoices")
          .insert({
            workspace_id: sched.workspace_id,
            invoice_month: month,
            invoice_number: num,
            client_name: ws.name || "Client",
            currency: sched.currency || "GBP",
            subtotal_cents: totals.subtotal_cents,
            tax_rate_percent: totals.tax_breakdown.length === 1 ? totals.tax_breakdown[0].rate_percent : 0,
            tax_cents: totals.tax_cents,
            discount_cents: totals.discount_cents,
            total_cents: totals.total_cents,
            line_items_json: totals.lines,
            data_json: { tax_mode: taxMode, tax_breakdown: totals.tax_breakdown, recurring_name: sched.name },
            issue_date: issueDate,
            due_date: due,
            payment_terms: sched.payment_terms ?? "",
            customer_notes: sched.customer_notes ?? "",
            payment_profile_id: sched.payment_profile_id ?? null,
            template_id: sched.template_id ?? null,
            status: "draft",
            storage_path: "draft",
            source: "recurring",
            recurring_id: sched.id,
            generated_by_user_id: sched.created_by_user_id ?? null,
          })
          .select("id,invoice_number")
          .maybeSingle();
        if (ins.error) {
          if (ins.error.code === "23505") continue;
          throw new Error(ins.error.message);
        }
        inserted = ins.data;
      }
      if (!inserted) throw new Error("could not reserve an invoice number");

      await sb.from("accountsmind_invoice_audit_log").insert({
        invoice_id: inserted.id,
        action: "recurring_generated",
        detail_json: { schedule_id: sched.id, schedule_name: sched.name, month, invoice_number: inserted.invoice_number },
        actor_user_id: null,
      });
      result.generated++;
    } catch (err: any) {
      result.failed.push({ scheduleId: sched.id, error: err?.message ?? "unknown" });
      // Release the claim so a later tick can retry this month.
      await sb
        .from("accountsmind_recurring_invoices")
        .update({ last_generated_month: sched.last_generated_month ?? null })
        .eq("id", sched.id)
        .eq("last_generated_month", month);
    }
  }
  return result;
}
