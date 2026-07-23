/**
 * AccountsMind Invoice Suite — Phase 3 server functions.
 *
 * Credit notes / write-offs (audited, never mutate the original invoice
 * silently), CSV export of invoices, CSV import/export for the service
 * catalogue, and the AccountsMind invoice-intelligence scan (deterministic
 * checks over real workspace data — nothing invented, nothing auto-sent).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { formatMoneyCents } from "@/lib/accountsmind/invoice-totals.shared";

async function auditStrict(sb: any, invoiceId: string, action: string, detail: Record<string, unknown>, actorUserId: string | null): Promise<string | null> {
  const { error } = await sb.from("accountsmind_invoice_audit_log").insert({
    invoice_id: invoiceId, action, detail_json: detail, actor_user_id: actorUserId,
  });
  return error ? `Audit log write failed — operation aborted: ${error.message}` : null;
}

// ── Credit notes & write-offs ───────────────────────────────────────────────

async function nextCreditNoteNumber(sb: any): Promise<string> {
  const prefix = `CN-${new Date().getUTCFullYear()}-`;
  const { data } = await sb
    .from("accountsmind_credit_notes")
    .select("credit_note_number")
    .like("credit_note_number", `${prefix}%`)
    .order("credit_note_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  const last = data?.credit_note_number ? parseInt(String(data.credit_note_number).slice(prefix.length), 10) : 0;
  return `${prefix}${String((Number.isFinite(last) ? last : 0) + 1).padStart(4, "0")}`;
}

export const createCreditNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((input) =>
    z
      .object({
        invoiceId: z.string().uuid(),
        amountCents: z.number().int().min(1).max(1_000_000_000),
        reason: z.string().min(3).max(1000),
        kind: z.enum(["credit_note", "write_off"]).default("credit_note"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const sb = supabaseAdmin as any;
    const userId = (context as any).userId ?? null;

    const { data: inv } = await sb
      .from("accountsmind_invoices")
      .select("id,workspace_id,invoice_number,total_cents,amount_paid_cents,credited_cents,currency,status")
      .eq("id", data.invoiceId)
      .maybeSingle();
    if (!inv) return { ok: false as const, error: "Invoice not found." };
    if (inv.status === "draft") return { ok: false as const, error: "Credit notes apply to issued invoices — drafts can simply be edited." };
    if (["cancelled", "void"].includes(inv.status)) return { ok: false as const, error: "Cannot credit a cancelled/void invoice." };

    const total = Number(inv.total_cents ?? 0);
    const paid = Number(inv.amount_paid_cents ?? 0);
    const credited = Number(inv.credited_cents ?? 0);
    const outstanding = Math.max(0, total - paid - credited);
    if (data.kind === "write_off" && data.amountCents > outstanding) {
      return { ok: false as const, error: `Write-off exceeds the outstanding balance (${formatMoneyCents(outstanding, inv.currency)} remaining).` };
    }
    if (data.kind === "credit_note" && credited + data.amountCents > total) {
      return { ok: false as const, error: `Total credits would exceed the invoice total (${formatMoneyCents(total - credited, inv.currency)} remaining creditable).` };
    }

    const auditErr = await auditStrict(
      sb, inv.id, data.kind === "write_off" ? "write_off_issued" : "credit_note_issued",
      { amount_cents: data.amountCents, reason: data.reason }, userId,
    );
    if (auditErr) return { ok: false as const, error: auditErr };

    let cn: any = null;
    for (let attempt = 0; attempt < 5 && !cn; attempt++) {
      const num = await nextCreditNoteNumber(sb);
      const ins = await sb
        .from("accountsmind_credit_notes")
        .insert({
          workspace_id: inv.workspace_id,
          invoice_id: inv.id,
          credit_note_number: num,
          amount_cents: data.amountCents,
          currency: inv.currency,
          reason: data.reason,
          kind: data.kind,
          created_by_user_id: userId,
        })
        .select("*")
        .maybeSingle();
      if (ins.error) {
        if (ins.error.code === "23505") continue;
        return { ok: false as const, error: ins.error.message };
      }
      cn = ins.data;
    }
    if (!cn) return { ok: false as const, error: "Could not reserve a credit note number." };

    // Settled = paid + credited/written-off. Fully settled → paid status.
    const newCredited = credited + data.amountCents;
    const settled = paid + newCredited >= total;
    const patch: Record<string, any> = { credited_cents: newCredited };
    if (settled && !["paid", "refunded"].includes(inv.status)) {
      patch.status = "paid";
      patch.paid_at = new Date().toISOString();
      patch.status_updated_at = new Date().toISOString();
    }
    // Optimistic-concurrency guard: the update must land on the exact row state we
    // validated against (same status AND same credited total). If it touches 0 rows,
    // another mutation raced us — compensate by removing the credit note we created.
    const { data: upRows, error: upErr } = await sb
      .from("accountsmind_invoices")
      .update(patch)
      .eq("id", inv.id)
      .eq("status", inv.status)
      .eq("credited_cents", credited)
      .select("id");
    if (upErr || !upRows?.length) {
      await sb.from("accountsmind_credit_notes").delete().eq("id", cn.id);
      await auditStrict(sb, inv.id, "credit_note_reverted", { credit_note_number: cn.credit_note_number, cause: upErr?.message ?? "concurrent invoice change" }, userId);
      return { ok: false as const, error: upErr?.message ?? "The invoice changed while issuing the credit note — reload and try again." };
    }
    return { ok: true as const, creditNote: cn, statusNow: patch.status ?? inv.status };
  });

export const listCreditNotes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((input) => z.object({ invoiceId: z.string().uuid().nullish() }).parse(input ?? {}))
  .handler(async ({ data }) => {
    const sb = supabaseAdmin as any;
    let q = sb.from("accountsmind_credit_notes").select("*").order("created_at", { ascending: false }).limit(200);
    if (data.invoiceId) q = q.eq("invoice_id", data.invoiceId);
    const { data: rows, error } = await q;
    if (error) return { creditNotes: [], error: error.message };
    return { creditNotes: rows ?? [] };
  });

// ── CSV export (invoices) ───────────────────────────────────────────────────

function csvCell(v: unknown): string {
  let s = String(v ?? "");
  // Neutralize spreadsheet formula injection (=, +, -, @, tab/CR-led values).
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const exportInvoicesCsv = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((input) => z.object({ status: z.string().max(30).nullish(), workspaceId: z.string().uuid().nullish() }).parse(input ?? {}))
  .handler(async ({ data }) => {
    const sb = supabaseAdmin as any;
    let q = sb
      .from("accountsmind_invoices")
      .select("invoice_number,client_name,workspace_id,status,source,currency,subtotal_cents,tax_cents,discount_cents,total_cents,amount_paid_cents,credited_cents,issue_date,due_date,paid_at,sent_at,invoice_month,created_at")
      .order("created_at", { ascending: false })
      .limit(2000);
    if (data.status) q = q.eq("status", data.status);
    if (data.workspaceId) q = q.eq("workspace_id", data.workspaceId);
    const { data: rows, error } = await q;
    if (error) return { ok: false as const, error: error.message };

    const header = ["Invoice number","Client","Status","Source","Currency","Subtotal","Tax","Discount","Total","Paid","Credited","Balance","Issue date","Due date","Paid at","Sent at","Billing month","Created"];
    const lines = [header.join(",")];
    for (const r of rows ?? []) {
      const bal = Number(r.total_cents ?? 0) - Number(r.amount_paid_cents ?? 0) - Number(r.credited_cents ?? 0);
      lines.push([
        r.invoice_number, r.client_name, r.status, r.source ?? "created", r.currency,
        (Number(r.subtotal_cents ?? 0) / 100).toFixed(2),
        (Number(r.tax_cents ?? 0) / 100).toFixed(2),
        (Number(r.discount_cents ?? 0) / 100).toFixed(2),
        (Number(r.total_cents ?? 0) / 100).toFixed(2),
        (Number(r.amount_paid_cents ?? 0) / 100).toFixed(2),
        (Number(r.credited_cents ?? 0) / 100).toFixed(2),
        (bal / 100).toFixed(2),
        r.issue_date ?? "", r.due_date ?? "", r.paid_at ?? "", r.sent_at ?? "", r.invoice_month ?? "", r.created_at ?? "",
      ].map(csvCell).join(","));
    }
    return { ok: true as const, csv: lines.join("\n"), count: (rows ?? []).length };
  });

// ── CSV import/export (service catalogue) ───────────────────────────────────

export const exportServicesCsv = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .handler(async () => {
    const sb = supabaseAdmin as any;
    const { data: rows, error } = await sb.from("accountsmind_services").select("*").order("name").limit(1000);
    if (error) return { ok: false as const, error: error.message };
    const header = ["Name","SKU","Category","Unit","Unit price","Currency","Tax rate %","Tax inclusive","Recurring","Billing frequency","Public description","Internal description","Archived"];
    const lines = [header.join(",")];
    for (const r of rows ?? []) {
      lines.push([
        r.name, r.sku, r.category, r.unit,
        (Number(r.unit_price_cents ?? 0) / 100).toFixed(2),
        r.currency, r.tax_rate_percent, r.tax_inclusive, r.recurring, r.billing_frequency,
        r.public_description, r.internal_description, r.archived,
      ].map(csvCell).join(","));
    }
    return { ok: true as const, csv: lines.join("\n"), count: (rows ?? []).length };
  });

const serviceCsvRow = z.object({
  name: z.string().min(1).max(200),
  sku: z.string().max(60).default(""),
  category: z.string().max(100).default(""),
  unit: z.string().max(30).default("each"),
  unitPriceCents: z.number().int().min(0).max(1_000_000_000),
  currency: z.string().min(3).max(8).default("GBP"),
  taxRatePercent: z.number().min(0).max(100).default(20),
});

export const importServicesCsv = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((input) => z.object({ rows: z.array(serviceCsvRow).min(1).max(500) }).parse(input))
  .handler(async ({ data, context }) => {
    const sb = supabaseAdmin as any;
    const userId = (context as any).userId ?? null;
    const { data: existing } = await sb.from("accountsmind_services").select("id,name,sku").limit(1000);
    const byKey = new Map<string, any>();
    for (const s of existing ?? []) byKey.set(((s.sku || s.name) as string).toLowerCase(), s);

    let created = 0, updated = 0;
    const failed: Array<{ name: string; error: string }> = [];
    for (const row of data.rows) {
      const key = (row.sku || row.name).toLowerCase();
      const patch = {
        name: row.name, sku: row.sku, category: row.category, unit: row.unit,
        unit_price_cents: row.unitPriceCents, currency: row.currency,
        tax_rate_percent: row.taxRatePercent, updated_at: new Date().toISOString(),
      };
      const match = byKey.get(key);
      if (match) {
        const { error } = await sb.from("accountsmind_services").update(patch).eq("id", match.id);
        if (error) failed.push({ name: row.name, error: error.message }); else updated++;
      } else {
        const { error } = await sb.from("accountsmind_services").insert({ ...patch, created_by_user_id: userId });
        if (error) failed.push({ name: row.name, error: error.message }); else created++;
      }
    }
    return { ok: true as const, created, updated, failed };
  });

// ── AccountsMind invoice intelligence (deterministic scan) ──────────────────

export const getInvoiceInsights = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .handler(async () => {
    const sb = supabaseAdmin as any;
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const in7 = new Date(now.getTime() + 7 * 86400000).toISOString().slice(0, 10);
    const month = now.toISOString().slice(0, 7);

    const [invRes, profRes, settingsRes] = await Promise.all([
      sb.from("accountsmind_invoices")
        .select("id,invoice_number,client_name,workspace_id,status,total_cents,subtotal_cents,tax_cents,discount_cents,amount_paid_cents,credited_cents,due_date,invoice_month,currency,created_at")
        .not("status", "in", "(cancelled,void)")
        .order("created_at", { ascending: false })
        .limit(1000),
      sb.from("client_billing_profiles").select("workspace_id,status").in("status", ["active", "trialing"]),
      sb.from("accountsmind_invoice_settings").select("from_vat_number,from_address,from_name").eq("id", 1).maybeSingle(),
    ]);
    const invoices: any[] = invRes.data ?? [];

    type Insight = { severity: "high" | "medium" | "low"; kind: string; title: string; detail: string; invoiceId?: string };
    const insights: Insight[] = [];
    const OPEN = ["ready", "unpaid", "sent", "viewed", "partially_paid", "overdue"];

    // Overdue + due soon
    for (const inv of invoices) {
      if (!OPEN.includes(inv.status) || !inv.due_date) continue;
      const bal = Number(inv.total_cents ?? 0) - Number(inv.amount_paid_cents ?? 0) - Number(inv.credited_cents ?? 0);
      if (bal <= 0) continue;
      if (inv.due_date < today) {
        insights.push({
          severity: "high", kind: "overdue", invoiceId: inv.id,
          title: `${inv.invoice_number} is overdue`,
          detail: `${inv.client_name} owes ${formatMoneyCents(bal, inv.currency)} — was due ${inv.due_date}. Consider sending a payment reminder.`,
        });
      } else if (inv.due_date <= in7) {
        insights.push({
          severity: "medium", kind: "due_soon", invoiceId: inv.id,
          title: `${inv.invoice_number} is due within 7 days`,
          detail: `${inv.client_name} — ${formatMoneyCents(bal, inv.currency)} due ${inv.due_date}.`,
        });
      }
    }

    // Duplicate invoice numbers
    const numCount = new Map<string, number>();
    for (const inv of invoices) numCount.set(inv.invoice_number, (numCount.get(inv.invoice_number) ?? 0) + 1);
    for (const [num, count] of numCount) {
      if (count > 1) insights.push({ severity: "high", kind: "duplicate_number", title: `Duplicate invoice number ${num}`, detail: `${count} invoices share the number ${num} — renumber to keep records audit-safe.` });
    }

    // Totals that do not reconcile
    for (const inv of invoices) {
      const expect = Number(inv.subtotal_cents ?? 0) + Number(inv.tax_cents ?? 0) - Number(inv.discount_cents ?? 0);
      if (expect !== Number(inv.total_cents ?? 0)) {
        insights.push({
          severity: "high", kind: "unreconciled_total", invoiceId: inv.id,
          title: `${inv.invoice_number} totals do not reconcile`,
          detail: `Subtotal + tax − discount = ${formatMoneyCents(expect, inv.currency)} but the stored total is ${formatMoneyCents(Number(inv.total_cents ?? 0), inv.currency)}.`,
        });
      }
    }

    // Missing VAT info while charging VAT
    const chargesVat = invoices.some((i) => Number(i.tax_cents ?? 0) > 0);
    if (chargesVat && !String(settingsRes.data?.from_vat_number ?? "").trim()) {
      insights.push({ severity: "medium", kind: "missing_vat", title: "VAT charged but no VAT number on file", detail: "Invoices include VAT but Business Details has no VAT number — add it in the Business Details tab." });
    }

    // Active clients with no invoice this month
    const invoicedWs = new Set(invoices.filter((i) => i.invoice_month === month).map((i) => i.workspace_id));
    const activeWs: string[] = [...new Set((profRes.data ?? []).map((p: any) => p.workspace_id))] as string[];
    const unbilled = activeWs.filter((w) => !invoicedWs.has(w));
    if (unbilled.length) {
      const { data: wss } = await sb.from("workspaces").select("id,name").in("id", unbilled.slice(0, 50));
      for (const w of wss ?? []) {
        insights.push({ severity: "low", kind: "uninvoiced_client", title: `${w.name} has no invoice for ${month}`, detail: "Active billing profile but no invoice created this month — consider creating one or setting up a recurring schedule." });
      }
    }

    // Stale drafts (>14 days old)
    const cutoff = new Date(now.getTime() - 14 * 86400000).toISOString();
    for (const inv of invoices) {
      if (inv.status === "draft" && inv.created_at < cutoff) {
        insights.push({ severity: "low", kind: "stale_draft", invoiceId: inv.id, title: `Draft ${inv.invoice_number} is over 2 weeks old`, detail: `${inv.client_name} — issue it or delete it to keep the pipeline clean.` });
      }
    }

    const order = { high: 0, medium: 1, low: 2 } as const;
    insights.sort((a, b) => order[a.severity] - order[b.severity]);
    return { insights: insights.slice(0, 60), scannedInvoices: invoices.length, generatedAt: now.toISOString() };
  });

// ── PDF-overlay template editing ────────────────────────────────────────────

const overlayFieldSchema = z.object({
  tag: z.string().min(1).max(60),
  page: z.number().int().min(0).max(20).default(0),
  xPct: z.number().min(0).max(100),
  yPct: z.number().min(0).max(100),
  widthPct: z.number().min(1).max(100).default(30),
  fontSize: z.number().min(5).max(48).default(10),
  bold: z.boolean().default(false),
  align: z.enum(["left", "center", "right"]).default("left"),
  lineSpacing: z.number().min(0.8).max(3).default(1.2),
  color: z.string().regex(/^#?[0-9a-fA-F]{6}$/).nullish(),
});

export const saveTemplateOverlayFields = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((input) =>
    z.object({ templateId: z.string().uuid(), fields: z.array(overlayFieldSchema).max(120) }).parse(input),
  )
  .handler(async ({ data }) => {
    const sb = supabaseAdmin as any;
    const { data: tpl } = await sb.from("accountsmind_invoice_templates").select("id,template_type").eq("id", data.templateId).maybeSingle();
    if (!tpl) return { ok: false as const, error: "Template not found." };
    if (tpl.template_type !== "pdf_overlay") return { ok: false as const, error: "Field layout only applies to PDF overlay templates." };
    const { error } = await sb
      .from("accountsmind_invoice_templates")
      .update({ fields_json: data.fields })
      .eq("id", data.templateId);
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });

export const getTemplateFileUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((input) => z.object({ templateId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const sb = supabaseAdmin as any;
    const { data: tpl } = await sb.from("accountsmind_invoice_templates").select("storage_path,file_name").eq("id", data.templateId).maybeSingle();
    if (!tpl?.storage_path) return { ok: false as const, error: "Template file not found." };
    const { data: signed, error } = await sb.storage.from("accountsmind-invoices").createSignedUrl(tpl.storage_path, 600);
    if (error || !signed?.signedUrl) return { ok: false as const, error: error?.message ?? "Could not sign URL." };
    return { ok: true as const, url: signed.signedUrl, fileName: tpl.file_name };
  });
