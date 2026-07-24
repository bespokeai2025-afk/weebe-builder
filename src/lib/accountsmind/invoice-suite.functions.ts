/**
 * AccountsMind Invoice Suite (Phase 1).
 *
 * Extends the original invoice generator with: a full business billing
 * profile, secure payment profiles (masked in list responses), a reusable
 * service catalogue with client-specific pricing, draft invoices with
 * server-recomputed decimal-safe totals, payment recording (full/partial),
 * an audited status lifecycle, duplication, and a filterable invoice list.
 *
 * All tables are server-write-only (RLS on, zero policies) — every access
 * path goes through requirePlatformAdmin, mirroring invoices.functions.ts.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  computeInvoiceTotals,
  formatMoneyCents,
  maskAccountValue,
  INVOICE_UNITS,
  INVOICE_LIFECYCLE_STATUSES,
  ISSUED_STATUSES,
  STATUS_TRANSITIONS,
  type TaxMode,
} from "@/lib/accountsmind/invoice-totals.shared";

const BUCKET = "accountsmind-invoices";

async function writeAudit(
  sb: any,
  invoiceId: string | null,
  action: string,
  detail: Record<string, unknown>,
  actorUserId: string | null,
): Promise<void> {
  try {
    const { error } = await sb.from("accountsmind_invoice_audit_log").insert({
      invoice_id: invoiceId,
      action,
      detail_json: detail,
      actor_user_id: actorUserId,
    });
    if (error) console.error(`[invoice-audit] best-effort write failed (${action}):`, error.message);
  } catch (err: any) {
    console.error(`[invoice-audit] best-effort write threw (${action}):`, err?.message);
  }
}

/**
 * Strict audit write for critical financial actions (status changes, payments,
 * issuance). Written BEFORE the mutation — if the audit row cannot be written,
 * the operation is aborted so the audit trail can never lag a critical change.
 * Returns an error message on failure, null on success.
 */
async function writeAuditStrict(
  sb: any,
  invoiceId: string,
  action: string,
  detail: Record<string, unknown>,
  actorUserId: string | null,
): Promise<string | null> {
  const { error } = await sb.from("accountsmind_invoice_audit_log").insert({
    invoice_id: invoiceId,
    action,
    detail_json: detail,
    actor_user_id: actorUserId,
  });
  return error ? `Audit log write failed — operation aborted: ${error.message}` : null;
}

// ── Business profile ─────────────────────────────────────────────────────────

const businessProfileSchema = z.object({
  from_name: z.string().max(200).default(""),
  from_legal_name: z.string().max(200).default(""),
  from_address: z.string().max(2000).default(""),
  from_email: z.string().max(200).default(""),
  from_phone: z.string().max(50).default(""),
  from_website: z.string().max(300).default(""),
  from_company_number: z.string().max(50).default(""),
  from_vat_number: z.string().max(50).default(""),
  from_tax_number: z.string().max(50).default(""),
  default_currency: z.string().max(8).default("GBP"),
  default_tax_rate_percent: z.number().min(0).max(100).default(20),
  default_payment_terms: z.string().max(500).default(""),
  default_due_days: z.number().int().min(0).max(365).default(30),
  invoice_footer: z.string().max(1000).default(""),
  signatory_name: z.string().max(200).default(""),
  number_prefix: z.string().max(20).default("INV"),
  number_include_year: z.boolean().default(true),
  number_pad_width: z.number().int().min(1).max(8).default(4),
});

export const getInvoiceBusinessProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .handler(async () => {
    const { data, error } = await (supabaseAdmin as any)
      .from("accountsmind_invoice_settings")
      .select("*")
      .eq("id", 1)
      .maybeSingle();
    if (error) return { profile: null, error: error.message };
    return { profile: data ?? null };
  });

export const saveInvoiceBusinessProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((input) => businessProfileSchema.parse(input))
  .handler(async ({ data, context }) => {
    const sb = supabaseAdmin as any;
    const { error } = await sb
      .from("accountsmind_invoice_settings")
      .upsert({ id: 1, ...data, updated_at: new Date().toISOString() }, { onConflict: "id" });
    if (error) return { ok: false as const, error: error.message };
    await writeAudit(sb, null, "business_profile_updated", { fields: Object.keys(data) }, (context as any).userId ?? null);
    return { ok: true as const };
  });

// ── Payment profiles (banking details) ───────────────────────────────────────

const SENSITIVE_PAYMENT_FIELDS = ["account_number", "sort_code", "iban", "swift_bic", "routing_number"] as const;

function maskPaymentProfile(row: any): any {
  const out = { ...row };
  for (const f of SENSITIVE_PAYMENT_FIELDS) out[f] = maskAccountValue(row[f]);
  return out;
}

export const listPaymentProfiles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .handler(async () => {
    const { data, error } = await (supabaseAdmin as any)
      .from("accountsmind_payment_profiles")
      .select("*")
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(50);
    if (error) return { profiles: [], error: error.message };
    return { profiles: (data ?? []).map(maskPaymentProfile) };
  });

export const revealPaymentProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const sb = supabaseAdmin as any;
    const { data: row, error } = await sb
      .from("accountsmind_payment_profiles")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error || !row) return { ok: false as const, error: error?.message ?? "Payment profile not found." };
    await writeAudit(sb, null, "payment_profile_revealed", { payment_profile_id: data.id }, (context as any).userId ?? null);
    return { ok: true as const, profile: row };
  });

const paymentProfileSchema = z.object({
  id: z.string().uuid().nullish(),
  label: z.string().min(1).max(120),
  currency: z.string().min(1).max(8).default("GBP"),
  bank_name: z.string().max(200).default(""),
  account_name: z.string().max(200).default(""),
  account_number: z.string().max(60).default(""),
  sort_code: z.string().max(20).default(""),
  iban: z.string().max(60).default(""),
  swift_bic: z.string().max(20).default(""),
  routing_number: z.string().max(20).default(""),
  bank_address: z.string().max(500).default(""),
  payment_link: z.string().max(500).default(""),
  payment_instructions: z.string().max(2000).default(""),
  is_default: z.boolean().default(false),
});

export const savePaymentProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((input) => paymentProfileSchema.parse(input))
  .handler(async ({ data, context }) => {
    const sb = supabaseAdmin as any;
    const userId = (context as any).userId ?? null;
    const { id, ...fields } = data;
    // Masked values round-tripped from the list view must never overwrite real ones.
    const patch: Record<string, any> = { ...fields, updated_at: new Date().toISOString() };
    for (const f of SENSITIVE_PAYMENT_FIELDS) {
      if (typeof patch[f] === "string" && patch[f].includes("••••")) delete patch[f];
    }
    let rowId = id ?? null;
    if (id) {
      const { error } = await sb.from("accountsmind_payment_profiles").update(patch).eq("id", id);
      if (error) return { ok: false as const, error: error.message };
    } else {
      const { data: row, error } = await sb
        .from("accountsmind_payment_profiles")
        .insert({ ...patch, created_by_user_id: userId })
        .select("id")
        .maybeSingle();
      if (error) return { ok: false as const, error: error.message };
      rowId = row?.id ?? null;
    }
    if (data.is_default && rowId) {
      await sb.from("accountsmind_payment_profiles").update({ is_default: false }).neq("id", rowId);
    }
    await writeAudit(sb, null, id ? "payment_profile_updated" : "payment_profile_created", { payment_profile_id: rowId, label: data.label }, userId);
    return { ok: true as const, id: rowId };
  });

export const archivePaymentProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((input) => z.object({ id: z.string().uuid(), archived: z.boolean() }).parse(input))
  .handler(async ({ data, context }) => {
    const sb = supabaseAdmin as any;
    const { error } = await sb
      .from("accountsmind_payment_profiles")
      .update({ archived: data.archived, updated_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) return { ok: false as const, error: error.message };
    await writeAudit(sb, null, data.archived ? "payment_profile_archived" : "payment_profile_restored", { payment_profile_id: data.id }, (context as any).userId ?? null);
    return { ok: true as const };
  });

// ── Service catalogue ────────────────────────────────────────────────────────

const serviceSchema = z.object({
  id: z.string().uuid().nullish(),
  name: z.string().min(1).max(200),
  public_description: z.string().max(1000).default(""),
  internal_description: z.string().max(1000).default(""),
  category: z.string().max(100).default(""),
  sku: z.string().max(60).default(""),
  unit: z.string().max(30).default("each"),
  unit_price_cents: z.number().int().min(0).max(1_000_000_000),
  cost_price_cents: z.number().int().min(0).max(1_000_000_000).nullish(),
  currency: z.string().max(8).default("GBP"),
  tax_rate_percent: z.number().min(0).max(100).default(20),
  tax_inclusive: z.boolean().default(false),
  recurring: z.boolean().default(false),
  billing_frequency: z.string().max(30).default(""),
});

export const listInvoiceServices = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((input) => z.object({ includeArchived: z.boolean().nullish() }).nullish().parse(input ?? {}))
  .handler(async ({ data }) => {
    const sb = supabaseAdmin as any;
    let q = sb.from("accountsmind_services").select("*").order("name", { ascending: true }).limit(500);
    if (!data?.includeArchived) q = q.eq("archived", false);
    const { data: rows, error } = await q;
    if (error) return { services: [], error: error.message };
    return { services: rows ?? [] };
  });

export const saveInvoiceService = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((input) => serviceSchema.parse(input))
  .handler(async ({ data, context }) => {
    const sb = supabaseAdmin as any;
    const userId = (context as any).userId ?? null;
    const { id, ...fields } = data;
    if (id) {
      const { error } = await sb
        .from("accountsmind_services")
        .update({ ...fields, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) return { ok: false as const, error: error.message };
      return { ok: true as const, id };
    }
    const { data: row, error } = await sb
      .from("accountsmind_services")
      .insert({ ...fields, created_by_user_id: userId })
      .select("id")
      .maybeSingle();
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const, id: row?.id ?? null };
  });

export const archiveInvoiceService = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((input) => z.object({ id: z.string().uuid(), archived: z.boolean() }).parse(input))
  .handler(async ({ data }) => {
    const { error } = await (supabaseAdmin as any)
      .from("accountsmind_services")
      .update({ archived: data.archived, updated_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });

export const duplicateInvoiceService = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const sb = supabaseAdmin as any;
    const { data: src, error } = await sb.from("accountsmind_services").select("*").eq("id", data.id).maybeSingle();
    if (error || !src) return { ok: false as const, error: error?.message ?? "Service not found." };
    const { id: _id, created_at: _c, updated_at: _u, ...rest } = src;
    const { data: row, error: insErr } = await sb
      .from("accountsmind_services")
      .insert({ ...rest, name: `${src.name} (copy)`, created_by_user_id: (context as any).userId ?? null })
      .select("id")
      .maybeSingle();
    if (insErr) return { ok: false as const, error: insErr.message };
    return { ok: true as const, id: row?.id ?? null };
  });

// ── Client-specific service pricing ──────────────────────────────────────────

export const listClientServicePrices = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((input) => z.object({ serviceId: z.string().uuid().nullish(), workspaceId: z.string().uuid().nullish() }).nullish().parse(input ?? {}))
  .handler(async ({ data }) => {
    const sb = supabaseAdmin as any;
    let q = sb.from("accountsmind_client_service_prices").select("*").limit(500);
    if (data?.serviceId) q = q.eq("service_id", data.serviceId);
    if (data?.workspaceId) q = q.eq("workspace_id", data.workspaceId);
    const { data: rows, error } = await q;
    if (error) return { prices: [], error: error.message };
    return { prices: rows ?? [] };
  });

export const saveClientServicePrice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((input) =>
    z
      .object({
        serviceId: z.string().uuid(),
        workspaceId: z.string().uuid(),
        unitPriceCents: z.number().int().min(0).max(1_000_000_000),
        currency: z.string().max(8).nullish(),
        note: z.string().max(500).default(""),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { error } = await (supabaseAdmin as any).from("accountsmind_client_service_prices").upsert(
      {
        service_id: data.serviceId,
        workspace_id: data.workspaceId,
        unit_price_cents: data.unitPriceCents,
        currency: data.currency ?? null,
        note: data.note,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "service_id,workspace_id" },
    );
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });

export const deleteClientServicePrice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { error } = await (supabaseAdmin as any).from("accountsmind_client_service_prices").delete().eq("id", data.id);
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });

// ── Draft invoices ───────────────────────────────────────────────────────────

const draftLineSchema = z.object({
  service_id: z.string().uuid().nullish(),
  description: z.string().min(1).max(500),
  service_date: z.string().max(60).nullish(),
  quantity: z.number().finite().min(0).max(1_000_000),
  unit: z.string().max(30).nullish(),
  unit_price_cents: z.number().int().min(-1_000_000_000).max(1_000_000_000),
  discount_percent: z.number().min(0).max(100).nullish(),
  tax_rate_percent: z.number().min(0).max(100).nullish(),
});

const draftSchema = z.object({
  id: z.string().uuid().nullish(), // update when present
  workspaceId: z.string().uuid(),
  invoiceNumber: z.string().max(60).nullish(), // blank = auto-assign on issue
  invoiceMonth: z.string().regex(/^\d{4}-\d{2}$/),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  currency: z.string().max(8).nullish(),
  taxMode: z.enum(["exclusive", "inclusive"]).default("exclusive"),
  paymentTerms: z.string().max(500).default(""),
  poNumber: z.string().max(100).default(""),
  clientReference: z.string().max(100).default(""),
  paymentProfileId: z.string().uuid().nullish(),
  templateId: z.string().uuid().nullish(),
  customerNotes: z.string().max(2000).default(""),
  internalNotes: z.string().max(2000).default(""),
  clientNameOverride: z.string().max(200).nullish(),
  toAddressOverride: z.string().max(2000).nullish(),
  items: z.array(draftLineSchema).min(0).max(100),
});

async function nextInvoiceNumberFromSettings(sb: any): Promise<string> {
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

export const saveInvoiceDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((input) => draftSchema.parse(input))
  .handler(async ({ data, context }) => {
    const sb = supabaseAdmin as any;
    const userId = (context as any).userId ?? null;

    const { data: ws } = await sb.from("workspaces").select("id,name").eq("id", data.workspaceId).maybeSingle();
    if (!ws) return { ok: false as const, error: "Client workspace not found." };
    const { data: profile } = await sb
      .from("client_billing_profiles")
      .select("currency,billing_address")
      .eq("workspace_id", data.workspaceId)
      .maybeSingle();

    const currency = data.currency || String(profile?.currency ?? "GBP");
    // Authoritative server-side recomputation — never trust browser totals.
    const totals = computeInvoiceTotals(data.items, { taxMode: data.taxMode as TaxMode });
    if (totals.total_cents < 0) return { ok: false as const, error: "Invoice total cannot be negative." };

    const row: Record<string, any> = {
      workspace_id: data.workspaceId,
      invoice_month: data.invoiceMonth,
      client_name: data.clientNameOverride?.trim() || ws.name || "Client",
      currency,
      subtotal_cents: totals.subtotal_cents,
      tax_rate_percent: totals.tax_breakdown.length === 1 ? totals.tax_breakdown[0].rate_percent : 0,
      tax_cents: totals.tax_cents,
      discount_cents: totals.discount_cents,
      total_cents: totals.total_cents,
      line_items_json: totals.lines,
      data_json: {
        tax_mode: data.taxMode,
        to_address_override: data.toAddressOverride ?? null,
        tax_breakdown: totals.tax_breakdown,
      },
      issue_date: data.issueDate ?? null,
      due_date: data.dueDate ?? null,
      payment_terms: data.paymentTerms,
      po_number: data.poNumber,
      client_reference: data.clientReference,
      payment_profile_id: data.paymentProfileId ?? null,
      template_id: data.templateId ?? null,
      customer_notes: data.customerNotes,
      internal_notes: data.internalNotes,
    };

    if (data.id) {
      // Only drafts may be edited.
      const { data: existing } = await sb.from("accountsmind_invoices").select("id,status,invoice_number").eq("id", data.id).maybeSingle();
      if (!existing) return { ok: false as const, error: "Draft not found." };
      if (existing.status !== "draft") return { ok: false as const, error: "Only draft invoices can be edited. Duplicate this invoice to make changes." };
      if (data.invoiceNumber?.trim() && data.invoiceNumber.trim() !== existing.invoice_number) {
        row.invoice_number = data.invoiceNumber.trim();
      }
      const { data: updated, error } = await sb
        .from("accountsmind_invoices")
        .update(row)
        .eq("id", data.id)
        .eq("status", "draft")
        .select("*")
        .maybeSingle();
      if (error) {
        if (error.code === "23505") return { ok: false as const, error: "That invoice number is already in use." };
        return { ok: false as const, error: error.message };
      }
      await writeAudit(sb, data.id, "draft_updated", { total_cents: totals.total_cents }, userId);
      return { ok: true as const, invoice: updated, totals };
    }

    // New draft: reserve a number (user-supplied or generated) via insert-first retry.
    let inserted: any = null;
    for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
      const num = data.invoiceNumber?.trim() || (await nextInvoiceNumberFromSettings(sb));
      const ins = await sb
        .from("accountsmind_invoices")
        .insert({
          ...row,
          invoice_number: num,
          status: "draft",
          storage_path: "draft",
          generated_by_user_id: userId,
        })
        .select("*")
        .maybeSingle();
      if (ins.error) {
        if (ins.error.code === "23505") {
          if (data.invoiceNumber?.trim()) return { ok: false as const, error: "That invoice number is already in use." };
          continue;
        }
        return { ok: false as const, error: ins.error.message };
      }
      inserted = ins.data;
    }
    if (!inserted) return { ok: false as const, error: "Could not reserve an invoice number — please try again." };
    await writeAudit(sb, inserted.id, "draft_created", { invoice_number: inserted.invoice_number, total_cents: totals.total_cents }, userId);
    return { ok: true as const, invoice: inserted, totals };
  });

export const deleteDraftInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const sb = supabaseAdmin as any;
    const { data: row } = await sb.from("accountsmind_invoices").select("id,status,storage_path").eq("id", data.id).maybeSingle();
    if (!row) return { ok: false as const, error: "Invoice not found." };
    if (row.status !== "draft") {
      return { ok: false as const, error: "Issued invoices cannot be deleted — cancel or void them instead." };
    }
    if (row.storage_path && !["draft", "pending"].includes(row.storage_path)) {
      await sb.storage.from(BUCKET).remove([row.storage_path]);
    }
    const { error } = await sb.from("accountsmind_invoices").delete().eq("id", data.id).eq("status", "draft");
    if (error) return { ok: false as const, error: error.message };
    await writeAudit(sb, data.id, "draft_deleted", {}, (context as any).userId ?? null);
    return { ok: true as const };
  });

// ── Document generation from a saved invoice ─────────────────────────────────

export const generateInvoiceDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((input) =>
    z.object({ id: z.string().uuid(), format: z.enum(["docx", "pdf"]) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const sb = supabaseAdmin as any;
    const userId = (context as any).userId ?? null;

    const { data: inv } = await sb.from("accountsmind_invoices").select("*").eq("id", data.id).maybeSingle();
    if (!inv) return { ok: false as const, error: "Invoice not found." };
    if (["cancelled", "void"].includes(inv.status)) return { ok: false as const, error: "This invoice is cancelled/void — duplicate it to reissue." };
    if (data.format === "docx" && !inv.template_id) {
      return { ok: false as const, error: "Attach a Word template to this invoice, or generate a PDF (built-in layout)." };
    }
    if (data.format === "docx" && inv.template_id) {
      const { data: tplKind } = await sb.from("accountsmind_invoice_templates").select("template_type").eq("id", inv.template_id).maybeSingle();
      if (tplKind?.template_type === "pdf_overlay") {
        return { ok: false as const, error: "This invoice uses a PDF overlay template — generate a PDF instead of a Word document." };
      }
    }

    const [{ data: settings }, { data: profile }, { data: payProfile }, { data: tpl }] = await Promise.all([
      sb.from("accountsmind_invoice_settings").select("*").eq("id", 1).maybeSingle(),
      sb.from("client_billing_profiles").select("billing_address,currency").eq("workspace_id", inv.workspace_id).maybeSingle(),
      inv.payment_profile_id
        ? sb.from("accountsmind_payment_profiles").select("*").eq("id", inv.payment_profile_id).maybeSingle()
        : Promise.resolve({ data: null }),
      inv.template_id
        ? sb.from("accountsmind_invoice_templates").select("*").eq("id", inv.template_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    const currency = String(inv.currency ?? "GBP");
    const items: any[] = Array.isArray(inv.line_items_json) ? inv.line_items_json : [];
    if (items.length === 0) return { ok: false as const, error: "Add at least one line item before generating a document." };

    // Recompute totals from stored lines — the document must always match the DB row.
    const taxMode: TaxMode = inv.data_json?.tax_mode === "inclusive" ? "inclusive" : "exclusive";
    const totals = computeInvoiceTotals(items, { taxMode, amountPaidCents: Number(inv.amount_paid_cents ?? 0) });
    if (totals.total_cents !== Number(inv.total_cents)) {
      return { ok: false as const, error: "Stored totals do not match the line items — re-save this invoice before generating." };
    }

    const fmtDate = (d: string | null, fallback: Date | null) => {
      const dd = d ? new Date(`${d}T00:00:00Z`) : fallback;
      return dd ? dd.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "";
    };
    const today = new Date();
    const periodLabel = new Date(`${inv.invoice_month}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });

    const paymentLines: string[] = [];
    if (payProfile) {
      if (payProfile.bank_name) paymentLines.push(`Bank: ${payProfile.bank_name}`);
      if (payProfile.account_name) paymentLines.push(`Account name: ${payProfile.account_name}`);
      if (payProfile.account_number) paymentLines.push(`Account number: ${payProfile.account_number}`);
      if (payProfile.sort_code) paymentLines.push(`Sort code: ${payProfile.sort_code}`);
      if (payProfile.iban) paymentLines.push(`IBAN: ${payProfile.iban}`);
      if (payProfile.swift_bic) paymentLines.push(`SWIFT/BIC: ${payProfile.swift_bic}`);
      if (payProfile.routing_number) paymentLines.push(`Routing number: ${payProfile.routing_number}`);
      if (payProfile.payment_link) paymentLines.push(`Pay online: ${payProfile.payment_link}`);
      if (payProfile.payment_instructions) paymentLines.push(payProfile.payment_instructions);
    }

    const payload: Record<string, any> = {
      invoice_number: inv.invoice_number,
      invoice_date: fmtDate(inv.issue_date, today),
      due_date: fmtDate(inv.due_date, null),
      client_name: inv.client_name,
      from_name: String(settings?.from_name ?? ""),
      from_legal_name: String(settings?.from_legal_name ?? ""),
      from_address: String(settings?.from_address ?? ""),
      from_email: String(settings?.from_email ?? ""),
      from_phone: String(settings?.from_phone ?? ""),
      from_website: String(settings?.from_website ?? ""),
      from_company_number: String(settings?.from_company_number ?? ""),
      from_vat_number: String(settings?.from_vat_number ?? ""),
      from_tax_number: String(settings?.from_tax_number ?? ""),
      to_address: String(inv.data_json?.to_address_override ?? profile?.billing_address ?? ""),
      period: periodLabel,
      billing_month: inv.invoice_month,
      currency,
      payment_terms: String(inv.payment_terms ?? ""),
      purchase_order_number: String(inv.po_number ?? ""),
      client_reference: String(inv.client_reference ?? ""),
      bank_name: String(payProfile?.bank_name ?? ""),
      account_name: String(payProfile?.account_name ?? ""),
      account_number: String(payProfile?.account_number ?? ""),
      sort_code: String(payProfile?.sort_code ?? ""),
      iban: String(payProfile?.iban ?? ""),
      swift_bic: String(payProfile?.swift_bic ?? ""),
      routing_number: String(payProfile?.routing_number ?? ""),
      payment_link: String(payProfile?.payment_link ?? ""),
      payment_reference: inv.invoice_number,
      payment_details: paymentLines.join("\n"),
      items: totals.lines.map((l) => ({
        description: l.description,
        service_date: l.service_date ?? "",
        quantity: l.quantity,
        unit: l.unit ?? "",
        unit_price: formatMoneyCents(l.unit_price_cents, currency),
        discount: l.discount_cents ? formatMoneyCents(l.discount_cents, currency) : "",
        tax: formatMoneyCents(l.tax_cents, currency),
        amount: formatMoneyCents(l.total_cents, currency),
      })),
      subtotal: formatMoneyCents(totals.subtotal_cents, currency),
      discount: formatMoneyCents(totals.discount_cents, currency),
      tax_rate:
        totals.tax_breakdown.length === 1
          ? `${totals.tax_breakdown[0].rate_percent}%`
          : totals.tax_breakdown.map((b) => `${b.rate_percent}%`).join(" / ") || "0%",
      tax: formatMoneyCents(totals.tax_cents, currency),
      total: formatMoneyCents(totals.total_cents, currency),
      amount_paid: formatMoneyCents(totals.amount_paid_cents, currency),
      balance_due: formatMoneyCents(totals.balance_due_cents, currency),
      notes: String(inv.customer_notes ?? "") || String(inv.data_json?.notes ?? ""),
      footer: String(settings?.invoice_footer ?? ""),
      status: inv.status,
    };

    let outBuf: Buffer;
    if (data.format === "pdf" && tpl?.template_type === "pdf_overlay") {
      // PDF-overlay template: uploaded design as background + positioned fields.
      const fields: any[] = Array.isArray(tpl.fields_json) ? tpl.fields_json : [];
      if (fields.length === 0) {
        return { ok: false as const, error: "This PDF template has no fields placed yet — open the layout designer in the Templates tab first." };
      }
      const { data: bgFile, error: bgErr } = await sb.storage.from(BUCKET).download(tpl.storage_path);
      if (bgErr || !bgFile) return { ok: false as const, error: `Could not load template background: ${bgErr?.message ?? "missing file"}` };
      try {
        const { renderPdfOverlay } = await import("@/lib/documents/pdf-overlay.server");
        outBuf = await renderPdfOverlay(Buffer.from(await bgFile.arrayBuffer()), fields, payload);
      } catch (err: any) {
        return { ok: false as const, error: `PDF overlay render failed: ${err?.message ?? "render error"}` };
      }
    } else if (data.format === "pdf") {
      try {
        const { renderInvoicePdf } = await import("@/lib/accountsmind/invoice-pdf.server");
        outBuf = await renderInvoicePdf({
          invoiceNumber: inv.invoice_number,
          invoiceDate: payload.invoice_date,
          dueDate: payload.due_date,
          clientName: inv.client_name,
          fromName: payload.from_name,
          fromAddress: [payload.from_address, payload.from_vat_number ? `VAT: ${payload.from_vat_number}` : "", payload.from_company_number ? `Company no: ${payload.from_company_number}` : ""].filter(Boolean).join("\n"),
          toAddress: payload.to_address,
          period: periodLabel,
          currency,
          items: payload.items.map((i: any) => ({
            description: i.service_date ? `${i.description} (${i.service_date})` : i.description,
            quantity: i.quantity,
            unitPrice: i.unit_price,
            amount: i.amount,
          })),
          subtotal: payload.subtotal,
          taxRate: payload.tax_rate,
          tax: payload.tax,
          total: payload.total,
          notes: [payload.notes, paymentLines.length ? `Payment details:\n${paymentLines.join("\n")}` : "", payload.footer].filter(Boolean).join("\n\n"),
        });
      } catch (err: any) {
        return { ok: false as const, error: `PDF generation failed: ${err?.message ?? "render error"}` };
      }
    } else {
      const { data: tplFile, error: dlErr } = await sb.storage.from(BUCKET).download(tpl?.storage_path);
      if (dlErr || !tplFile) return { ok: false as const, error: `Could not load template: ${dlErr?.message ?? "missing file"}` };
      try {
        const { default: PizZip } = await import("pizzip");
        const { default: Docxtemplater } = await import("docxtemplater");
        const zip = new PizZip(Buffer.from(await tplFile.arrayBuffer()));
        const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, nullGetter: () => "" });
        doc.render(payload);
        outBuf = doc.getZip().generate({ type: "nodebuffer" });
      } catch (err: any) {
        const detail = err?.properties?.errors?.map((e: any) => e?.properties?.explanation).filter(Boolean).join("; ");
        return { ok: false as const, error: `Template fill failed: ${detail || err?.message || "render error"}` };
      }
    }

    // Unique per-row path — no upsert, matching the original generator's race-safety rule.
    const ext = data.format;
    const storagePath = `invoices/${inv.workspace_id}/${inv.id}_${inv.invoice_number}.${ext}`;
    // Remove a previous file for this same invoice+format only (regeneration).
    // Storage errors come back in the result object, not as throws — best-effort.
    try {
      await sb.storage.from(BUCKET).remove([storagePath]);
    } catch {
      // best-effort cleanup; upload below will surface any real problem
    }
    const { error: upErr } = await sb.storage.from(BUCKET).upload(storagePath, outBuf, {
      contentType: ext === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      upsert: false,
    });
    if (upErr && !String(upErr.message ?? "").toLowerCase().includes("already exists")) {
      return { ok: false as const, error: upErr.message };
    }
    if (upErr) {
      // Same path already there (remove failed) — replace explicitly for this row's own path.
      const { error: upErr2 } = await sb.storage.from(BUCKET).update(storagePath, outBuf, {
        contentType: ext === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
      if (upErr2) return { ok: false as const, error: upErr2.message };
    }

    const patch: Record<string, any> = { storage_path: storagePath, data_json: { ...(inv.data_json ?? {}), last_payload: payload } };
    if (inv.status === "draft") {
      patch.status = "ready";
      patch.issue_date = inv.issue_date ?? new Date().toISOString().slice(0, 10);
      patch.status_updated_at = new Date().toISOString();
      // Issuance is a critical lifecycle change — audit must land before it.
      const auditErr = await writeAuditStrict(sb, inv.id, "status_changed", { from: "draft", to: "ready", reason: "document generated" }, userId);
      if (auditErr) return { ok: false as const, error: auditErr };
    }
    const { data: finalRow, error } = await sb.from("accountsmind_invoices").update(patch).eq("id", inv.id).select("*").maybeSingle();
    if (error) return { ok: false as const, error: error.message };

    await writeAudit(sb, inv.id, "document_generated", { format: ext, issued: inv.status === "draft" }, userId);
    const { data: signed } = await sb.storage.from(BUCKET).createSignedUrl(storagePath, 600, { download: `${inv.invoice_number}.${ext}` });
    return { ok: true as const, invoice: finalRow, downloadUrl: signed?.signedUrl ?? null };
  });

// ── Payments ─────────────────────────────────────────────────────────────────

export const recordInvoicePayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((input) =>
    z
      .object({
        invoiceId: z.string().uuid(),
        amountCents: z.number().int().min(1).max(1_000_000_000),
        paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
        method: z.string().max(60).default(""),
        reference: z.string().max(200).default(""),
        notes: z.string().max(1000).default(""),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const sb = supabaseAdmin as any;
    const userId = (context as any).userId ?? null;

    const { data: inv } = await sb
      .from("accountsmind_invoices")
      .select("id,total_cents,amount_paid_cents,credited_cents,status,currency,workspace_id")
      .eq("id", data.invoiceId)
      .maybeSingle();
    if (!inv) return { ok: false as const, error: "Invoice not found." };
    if (inv.status === "draft") return { ok: false as const, error: "Issue the invoice before recording payments." };
    if (["cancelled", "void"].includes(inv.status)) return { ok: false as const, error: "Cannot record payments on a cancelled/void invoice." };
    if (inv.status === "refunded") return { ok: false as const, error: "This invoice was refunded — duplicate it to bill again." };
    if (inv.status === "paid") return { ok: false as const, error: "This invoice is already fully paid." };

    // Outstanding = total − paid − credited (credit notes/write-offs reduce what is owed).
    const remainingCents = Math.max(0, Number(inv.total_cents ?? 0) - Number(inv.amount_paid_cents ?? 0) - Number(inv.credited_cents ?? 0));
    if (data.amountCents > remainingCents) {
      return {
        ok: false as const,
        error: `Payment exceeds the outstanding balance (${formatMoneyCents(remainingCents, String(inv.currency ?? "GBP"))} remaining).`,
      };
    }

    const auditErr = await writeAuditStrict(
      sb,
      inv.id,
      "payment_recorded",
      { amount_cents: data.amountCents, method: data.method, reference: data.reference, paid_on: data.paidOn ?? null },
      userId,
    );
    if (auditErr) return { ok: false as const, error: auditErr };

    const { error: payErr } = await sb.from("accountsmind_invoice_payments").insert({
      invoice_id: inv.id,
      paid_on: data.paidOn ?? new Date().toISOString().slice(0, 10),
      amount_cents: data.amountCents,
      currency: inv.currency,
      method: data.method,
      reference: data.reference,
      notes: data.notes,
      created_by_user_id: userId,
    });
    if (payErr) return { ok: false as const, error: payErr.message };

    // Recompute paid total from the payments table (authoritative).
    const { data: pays } = await sb.from("accountsmind_invoice_payments").select("amount_cents").eq("invoice_id", inv.id);
    const paid = (pays ?? []).reduce((s: number, p: any) => s + Number(p.amount_cents ?? 0), 0);
    const fullyPaid = paid + Number(inv.credited_cents ?? 0) >= Number(inv.total_cents);
    const patch: Record<string, any> = {
      amount_paid_cents: paid,
      status: fullyPaid ? "paid" : "partially_paid",
      status_updated_at: new Date().toISOString(),
      paid_at: fullyPaid ? new Date().toISOString() : null,
    };
    const { error } = await sb.from("accountsmind_invoices").update(patch).eq("id", inv.id);
    if (error) return { ok: false as const, error: error.message };

    if (inv.workspace_id) {
      try {
        const { cacheDel } = await import("@/lib/cache/redis.server");
        await cacheDel(`webee:hivemind:${inv.workspace_id}:platform:v3`);
      } catch {}
    }
    return { ok: true as const, amountPaidCents: paid, status: patch.status };
  });

export const listInvoicePayments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((input) => z.object({ invoiceId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { data: rows, error } = await (supabaseAdmin as any)
      .from("accountsmind_invoice_payments")
      .select("*")
      .eq("invoice_id", data.invoiceId)
      .order("created_at", { ascending: false });
    if (error) return { payments: [], error: error.message };
    return { payments: rows ?? [] };
  });

// ── Status lifecycle ─────────────────────────────────────────────────────────

export const transitionInvoiceStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(INVOICE_LIFECYCLE_STATUSES),
        reason: z.string().max(500).default(""),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const sb = supabaseAdmin as any;
    const userId = (context as any).userId ?? null;
    const { data: inv } = await sb.from("accountsmind_invoices").select("id,status,workspace_id,total_cents,amount_paid_cents,credited_cents,currency").eq("id", data.id).maybeSingle();
    if (!inv) return { ok: false as const, error: "Invoice not found." };

    const allowed = STATUS_TRANSITIONS[inv.status] ?? [];
    if (!allowed.includes(data.status)) {
      return { ok: false as const, error: `Cannot move a ${inv.status} invoice to ${data.status}.` };
    }
    if (["cancelled", "void"].includes(data.status) && ISSUED_STATUSES.includes(inv.status as any) && !data.reason.trim()) {
      return { ok: false as const, error: "A reason is required to cancel or void an issued invoice." };
    }

    const now = new Date().toISOString();
    const patch: Record<string, any> = { status: data.status, status_updated_at: now };
    if (data.status === "paid") patch.paid_at = now;
    if (data.status === "sent") patch.sent_at = now;
    if (data.status === "void" || data.status === "cancelled") patch.voided_at = now;

    // Critical action — the audit row must exist before the mutation lands.
    const auditErr = await writeAuditStrict(sb, data.id, "status_changed", { from: inv.status, to: data.status, reason: data.reason }, userId);
    if (auditErr) return { ok: false as const, error: auditErr };

    // Manual "mark paid" must reconcile the paid amount: record the remaining
    // balance as a payment row so payments stay the authoritative ledger.
    if (data.status === "paid") {
      const remaining = Math.max(0, Number(inv.total_cents ?? 0) - Number(inv.amount_paid_cents ?? 0) - Number(inv.credited_cents ?? 0));
      if (remaining > 0) {
        const { error: payErr } = await sb.from("accountsmind_invoice_payments").insert({
          invoice_id: inv.id,
          paid_on: now.slice(0, 10),
          amount_cents: remaining,
          currency: inv.currency,
          method: "manual_mark_paid",
          reference: data.reason || "Marked paid manually",
          notes: "",
          created_by_user_id: userId,
        });
        if (payErr) return { ok: false as const, error: payErr.message };
      }
      patch.amount_paid_cents = Math.max(0, Number(inv.total_cents ?? 0) - Number(inv.credited_cents ?? 0));
    }

    const { error } = await sb.from("accountsmind_invoices").update(patch).eq("id", data.id).eq("status", inv.status);
    if (error) return { ok: false as const, error: error.message };
    if (inv.workspace_id) {
      try {
        const { cacheDel } = await import("@/lib/cache/redis.server");
        await cacheDel(`webee:hivemind:${inv.workspace_id}:platform:v3`);
      } catch {}
    }
    return { ok: true as const };
  });

// ── Duplicate ────────────────────────────────────────────────────────────────

export const duplicateInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const sb = supabaseAdmin as any;
    const userId = (context as any).userId ?? null;
    const { data: src } = await sb.from("accountsmind_invoices").select("*").eq("id", data.id).maybeSingle();
    if (!src) return { ok: false as const, error: "Invoice not found." };

    let inserted: any = null;
    for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
      const num = await nextInvoiceNumberFromSettings(sb);
      const ins = await sb
        .from("accountsmind_invoices")
        .insert({
          workspace_id: src.workspace_id,
          template_id: src.template_id,
          invoice_number: num,
          invoice_month: src.invoice_month,
          client_name: src.client_name,
          currency: src.currency,
          subtotal_cents: src.subtotal_cents,
          tax_rate_percent: src.tax_rate_percent,
          tax_cents: src.tax_cents,
          discount_cents: src.discount_cents ?? 0,
          total_cents: src.total_cents,
          line_items_json: src.line_items_json,
          data_json: { ...(src.data_json ?? {}), duplicated_from: src.invoice_number },
          storage_path: "draft",
          status: "draft",
          issue_date: null,
          due_date: null,
          payment_terms: src.payment_terms ?? "",
          po_number: src.po_number ?? "",
          client_reference: src.client_reference ?? "",
          payment_profile_id: src.payment_profile_id ?? null,
          customer_notes: src.customer_notes ?? "",
          internal_notes: src.internal_notes ?? "",
          generated_by_user_id: userId,
        })
        .select("*")
        .maybeSingle();
      if (ins.error) {
        if (ins.error.code === "23505") continue;
        return { ok: false as const, error: ins.error.message };
      }
      inserted = ins.data;
    }
    if (!inserted) return { ok: false as const, error: "Could not reserve an invoice number — please try again." };
    await writeAudit(sb, inserted.id, "duplicated", { from_invoice: src.invoice_number }, userId);
    return { ok: true as const, invoice: inserted };
  });

// ── Filterable list + dashboard KPIs ─────────────────────────────────────────

export const listInvoicesV2 = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((input) =>
    z
      .object({
        status: z.string().max(30).nullish(),
        workspaceId: z.string().uuid().nullish(),
        search: z.string().max(120).nullish(),
        overdueOnly: z.boolean().nullish(),
        unpaidOnly: z.boolean().nullish(),
        dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
        dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
      })
      .nullish()
      .parse(input ?? {}),
  )
  .handler(async ({ data }) => {
    const sb = supabaseAdmin as any;
    let q = sb
      .from("accountsmind_invoices")
      .select(
        "id,invoice_number,invoice_month,client_name,workspace_id,currency,subtotal_cents,discount_cents,tax_cents,total_cents,amount_paid_cents,status,issue_date,due_date,paid_at,sent_at,created_at,storage_path,template_id,payment_profile_id,is_imported",
      )
      .neq("storage_path", "pending")
      .order("created_at", { ascending: false })
      .limit(300);
    if (data?.status) q = q.eq("status", data.status);
    if (data?.workspaceId) q = q.eq("workspace_id", data.workspaceId);
    if (data?.search?.trim()) {
      const s = data.search.trim().replace(/[%,]/g, "");
      q = q.or(`invoice_number.ilike.%${s}%,client_name.ilike.%${s}%`);
    }
    if (data?.dateFrom) q = q.gte("created_at", `${data.dateFrom}T00:00:00Z`);
    if (data?.dateTo) q = q.lte("created_at", `${data.dateTo}T23:59:59Z`);
    const { data: rows, error } = await q;
    if (error) return { invoices: [], kpis: null, error: error.message };

    let invoices: any[] = rows ?? [];
    const todayIso = new Date().toISOString().slice(0, 10);
    if (data?.overdueOnly) {
      invoices = invoices.filter(
        (r) => !["paid", "cancelled", "void", "draft", "refunded"].includes(r.status) && r.due_date && r.due_date < todayIso,
      );
    }
    if (data?.unpaidOnly) {
      invoices = invoices.filter((r) => !["paid", "cancelled", "void", "refunded", "draft"].includes(r.status));
    }

    // KPI aggregates for the current month + all-time outstanding (whole table, not just page).
    const monthStart = `${new Date().toISOString().slice(0, 7)}-01T00:00:00Z`;
    const { data: allRows } = await sb
      .from("accountsmind_invoices")
      .select("total_cents,amount_paid_cents,credited_cents,tax_cents,status,due_date,created_at,paid_at")
      .neq("storage_path", "pending")
      .limit(5000);
    const all: any[] = allRows ?? [];
    const active = (r: any) => !["cancelled", "void", "draft"].includes(r.status);
    const kpis = {
      invoiced_this_month_cents: all.filter((r) => active(r) && r.created_at >= monthStart).reduce((s, r) => s + Number(r.total_cents ?? 0), 0),
      paid_this_month_cents: all.filter((r) => r.paid_at && r.paid_at >= monthStart).reduce((s, r) => s + Number(r.total_cents ?? 0), 0),
      outstanding_cents: all.filter((r) => active(r) && !["paid", "refunded"].includes(r.status)).reduce((s, r) => s + Math.max(0, Number(r.total_cents ?? 0) - Number(r.amount_paid_cents ?? 0) - Number(r.credited_cents ?? 0)), 0),
      overdue_cents: all
        .filter((r) => active(r) && !["paid", "refunded"].includes(r.status) && r.due_date && r.due_date < todayIso)
        .reduce((s, r) => s + Math.max(0, Number(r.total_cents ?? 0) - Number(r.amount_paid_cents ?? 0) - Number(r.credited_cents ?? 0)), 0),
      draft_count: all.filter((r) => r.status === "draft").length,
      vat_collected_cents: all.filter((r) => r.status === "paid").reduce((s, r) => s + Number(r.tax_cents ?? 0), 0),
      avg_payment_days: (() => {
        const paid = all.filter((r) => r.paid_at && r.created_at);
        if (!paid.length) return null;
        const days = paid.map((r) => (new Date(r.paid_at).getTime() - new Date(r.created_at).getTime()) / 86_400_000);
        return Math.round(days.reduce((s, d) => s + d, 0) / days.length);
      })(),
    };

    let nextNumber = "";
    try {
      nextNumber = await nextInvoiceNumberFromSettings(sb);
    } catch {}
    return { invoices, kpis, nextNumber };
  });

export const getInvoiceDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const sb = supabaseAdmin as any;
    const [{ data: inv }, { data: pays }, { data: audit }] = await Promise.all([
      sb.from("accountsmind_invoices").select("*").eq("id", data.id).maybeSingle(),
      sb.from("accountsmind_invoice_payments").select("*").eq("invoice_id", data.id).order("created_at", { ascending: false }),
      sb.from("accountsmind_invoice_audit_log").select("*").eq("invoice_id", data.id).order("created_at", { ascending: false }).limit(50),
    ]);
    if (!inv) return { invoice: null, payments: [], audit: [], error: "Invoice not found." };
    return { invoice: inv, payments: pays ?? [], audit: audit ?? [] };
  });

export { INVOICE_UNITS, INVOICE_LIFECYCLE_STATUSES };
