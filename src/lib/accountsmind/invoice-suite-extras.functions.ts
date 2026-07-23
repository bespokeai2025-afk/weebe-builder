/**
 * AccountsMind Invoice Suite — Phase 2 server functions.
 *
 * Adds: email delivery (via the workspace email dispatch chain), importing
 * historical invoices (with optional file), template test-render through the
 * exact same docxtemplater pipeline used for real generation, and recurring
 * schedule CRUD (generation itself runs in recurring-invoices.server.ts,
 * draft-first, autosend off).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  computeInvoiceTotals,
  formatMoneyCents,
  type TaxMode,
} from "@/lib/accountsmind/invoice-totals.shared";

const BUCKET = "accountsmind-invoices";

async function auditBestEffort(sb: any, invoiceId: string | null, action: string, detail: Record<string, unknown>, actorUserId: string | null) {
  try {
    const { error } = await sb.from("accountsmind_invoice_audit_log").insert({
      invoice_id: invoiceId, action, detail_json: detail, actor_user_id: actorUserId,
    });
    if (error) console.error(`[invoice-audit] best-effort write failed (${action}):`, error.message);
  } catch (err: any) {
    console.error(`[invoice-audit] best-effort write threw (${action}):`, err?.message);
  }
}

/** Strict pre-mutation audit for critical actions — returns error message or null. */
async function auditStrict(sb: any, invoiceId: string, action: string, detail: Record<string, unknown>, actorUserId: string | null): Promise<string | null> {
  const { error } = await sb.from("accountsmind_invoice_audit_log").insert({
    invoice_id: invoiceId, action, detail_json: detail, actor_user_id: actorUserId,
  });
  return error ? `Audit log write failed — operation aborted: ${error.message}` : null;
}

function escapeHtml(s: string): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

// ── Email delivery ───────────────────────────────────────────────────────────

export const sendInvoiceEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((input) =>
    z
      .object({
        invoiceId: z.string().uuid(),
        to: z.string().email().max(200),
        subject: z.string().max(300).default(""),
        message: z.string().max(4000).default(""),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const sb = supabaseAdmin as any;
    const userId = (context as any).userId ?? null;

    const { data: inv } = await sb.from("accountsmind_invoices").select("*").eq("id", data.invoiceId).maybeSingle();
    if (!inv) return { ok: false as const, error: "Invoice not found." };
    if (inv.status === "draft") return { ok: false as const, error: "Generate the invoice document before emailing it." };
    if (["cancelled", "void"].includes(inv.status)) return { ok: false as const, error: "Cannot email a cancelled/void invoice." };
    if (!inv.storage_path || ["draft", "pending"].includes(inv.storage_path)) {
      return { ok: false as const, error: "No generated document found — generate a PDF first." };
    }

    // 7-day signed link — recipients download rather than receiving a raw attachment.
    const { data: signed, error: signErr } = await sb.storage
      .from(BUCKET)
      .createSignedUrl(inv.storage_path, 7 * 24 * 3600, { download: `${inv.invoice_number}.${String(inv.storage_path).split(".").pop()}` });
    if (signErr || !signed?.signedUrl) return { ok: false as const, error: `Could not create download link: ${signErr?.message ?? "unknown"}` };

    const currency = String(inv.currency ?? "GBP");
    const subject = data.subject.trim() || `Invoice ${inv.invoice_number} — ${formatMoneyCents(Number(inv.total_cents ?? 0), currency)}`;
    const bodyMsg = data.message.trim() || `Please find invoice ${inv.invoice_number} for ${formatMoneyCents(Number(inv.total_cents ?? 0), currency)} attached below.`;
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a">
        <h2 style="margin:0 0 16px">Invoice ${escapeHtml(inv.invoice_number)}</h2>
        <p style="white-space:pre-line">${escapeHtml(bodyMsg)}</p>
        <table style="margin:16px 0;border-collapse:collapse">
          <tr><td style="padding:4px 16px 4px 0;color:#666">Total</td><td style="padding:4px 0;font-weight:bold">${escapeHtml(formatMoneyCents(Number(inv.total_cents ?? 0), currency))}</td></tr>
          ${inv.due_date ? `<tr><td style="padding:4px 16px 4px 0;color:#666">Due date</td><td style="padding:4px 0">${escapeHtml(String(inv.due_date))}</td></tr>` : ""}
        </table>
        <p><a href="${signed.signedUrl}" style="display:inline-block;background:#111;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none">Download invoice</a></p>
        <p style="color:#888;font-size:12px">This download link expires in 7 days.</p>
      </div>`;

    const auditErr = await auditStrict(sb, inv.id, "invoice_emailed", { to: data.to, subject }, userId);
    if (auditErr) return { ok: false as const, error: auditErr };

    const { sendWorkspaceEmail } = await import("@/lib/email/email-dispatch.server");
    const res = await sendWorkspaceEmail(sb, {
      workspaceId: inv.workspace_id,
      to: data.to,
      subject,
      html,
      text: `${bodyMsg}\n\nDownload: ${signed.signedUrl}`,
    });
    if (!res.success) {
      await auditBestEffort(sb, inv.id, "invoice_email_failed", { to: data.to, error: res.error ?? "send failed" }, userId);
      return { ok: false as const, error: `Email failed to send: ${res.error ?? "unknown error"}` };
    }

    const patch: Record<string, any> = {
      last_emailed_at: new Date().toISOString(),
      last_emailed_to: data.to,
    };
    // First send moves ready/unpaid → sent (audited above as invoice_emailed).
    if (["ready", "unpaid"].includes(inv.status)) {
      patch.status = "sent";
      patch.sent_at = new Date().toISOString();
      patch.status_updated_at = new Date().toISOString();
    }
    await sb.from("accountsmind_invoices").update(patch).eq("id", inv.id);
    return { ok: true as const, providerUsed: res.providerUsed, statusNow: patch.status ?? inv.status };
  });

// ── Import an existing/historical invoice ────────────────────────────────────

export const importInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((input) =>
    z
      .object({
        workspaceId: z.string().uuid(),
        invoiceNumber: z.string().min(1).max(60),
        invoiceMonth: z.string().regex(/^\d{4}-\d{2}$/),
        issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
        dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
        currency: z.string().min(3).max(8).default("GBP"),
        totalCents: z.number().int().min(0).max(10_000_000_000),
        taxCents: z.number().int().min(0).max(10_000_000_000).default(0),
        status: z.enum(["ready", "sent", "paid"]).default("ready"),
        notes: z.string().max(2000).default(""),
        fileName: z.string().max(300).nullish(),
        fileBase64: z.string().max(12_000_000).nullish(), // ~9 MB cap
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const sb = supabaseAdmin as any;
    const userId = (context as any).userId ?? null;

    const { data: ws } = await sb.from("workspaces").select("id,name").eq("id", data.workspaceId).maybeSingle();
    if (!ws) return { ok: false as const, error: "Client workspace not found." };
    if (data.taxCents > data.totalCents) return { ok: false as const, error: "Tax cannot exceed the total." };

    let storagePath = "imported";
    if (data.fileBase64 && data.fileName) {
      const ext = (data.fileName.split(".").pop() ?? "").toLowerCase();
      if (!["pdf", "docx"].includes(ext)) return { ok: false as const, error: "Imported file must be a PDF or DOCX." };
      const buf = Buffer.from(data.fileBase64, "base64");
      const safeNum = data.invoiceNumber.replace(/[^a-zA-Z0-9._-]/g, "_");
      storagePath = `invoices/${data.workspaceId}/imported_${Date.now()}_${safeNum}.${ext}`;
      const { error: upErr } = await sb.storage.from(BUCKET).upload(storagePath, buf, {
        contentType: ext === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        upsert: false,
      });
      if (upErr) return { ok: false as const, error: `File upload failed: ${upErr.message}` };
    }

    const now = new Date().toISOString();
    const isPaid = data.status === "paid";
    const { data: inserted, error } = await sb
      .from("accountsmind_invoices")
      .insert({
        workspace_id: data.workspaceId,
        invoice_month: data.invoiceMonth,
        invoice_number: data.invoiceNumber.trim(),
        client_name: ws.name || "Client",
        currency: data.currency,
        subtotal_cents: data.totalCents - data.taxCents,
        tax_cents: data.taxCents,
        discount_cents: 0,
        total_cents: data.totalCents,
        amount_paid_cents: isPaid ? data.totalCents : 0,
        line_items_json: [],
        data_json: { imported: true, import_notes: data.notes },
        issue_date: data.issueDate ?? null,
        due_date: data.dueDate ?? null,
        internal_notes: data.notes,
        status: data.status,
        paid_at: isPaid ? now : null,
        sent_at: data.status === "sent" ? now : null,
        status_updated_at: now,
        storage_path: storagePath,
        source: "imported",
        generated_by_user_id: userId,
      })
      .select("*")
      .maybeSingle();
    if (error) {
      if (error.code === "23505") return { ok: false as const, error: "That invoice number is already in use." };
      return { ok: false as const, error: error.message };
    }

    if (isPaid && data.totalCents > 0) {
      await sb.from("accountsmind_invoice_payments").insert({
        invoice_id: inserted.id,
        paid_on: (data.issueDate ?? now.slice(0, 10)),
        amount_cents: data.totalCents,
        currency: data.currency,
        method: "imported",
        reference: "Imported as paid",
        notes: "",
        created_by_user_id: userId,
      });
    }
    await auditBestEffort(sb, inserted.id, "invoice_imported", { invoice_number: inserted.invoice_number, status: data.status, total_cents: data.totalCents, has_file: storagePath !== "imported" }, userId);
    return { ok: true as const, invoice: inserted };
  });

// ── Template test-render (same pipeline as real generation) ─────────────────

const SAMPLE_ITEMS = [
  { description: "AI Receptionist — monthly service", quantity: 1, unit: "month", unit_price_cents: 50000, tax_rate_percent: 20, discount_cents: 0 },
  { description: "Additional call minutes", quantity: 250, unit: "minutes", unit_price_cents: 12, tax_rate_percent: 20, discount_cents: 0 },
];

export const testRenderInvoiceTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((input) => z.object({ templateId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const sb = supabaseAdmin as any;
    const { data: tpl } = await sb.from("accountsmind_invoice_templates").select("*").eq("id", data.templateId).maybeSingle();
    if (!tpl) return { ok: false as const, error: "Template not found." };

    const { data: settings } = await sb.from("accountsmind_invoice_settings").select("*").eq("id", 1).maybeSingle();
    const totals = computeInvoiceTotals(SAMPLE_ITEMS as any, { taxMode: "exclusive" as TaxMode });
    const currency = String(settings?.default_currency ?? "GBP");
    const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

    const payload: Record<string, any> = {
      invoice_number: "SAMPLE-0001",
      invoice_date: today,
      due_date: today,
      client_name: "Sample Client Ltd",
      from_name: String(settings?.from_name ?? "Your Business"),
      from_legal_name: String(settings?.from_legal_name ?? ""),
      from_address: String(settings?.from_address ?? "1 Example Street\nLondon"),
      from_email: String(settings?.from_email ?? ""),
      from_phone: String(settings?.from_phone ?? ""),
      from_website: String(settings?.from_website ?? ""),
      from_company_number: String(settings?.from_company_number ?? ""),
      from_vat_number: String(settings?.from_vat_number ?? ""),
      from_tax_number: String(settings?.from_tax_number ?? ""),
      to_address: "Sample Client Ltd\n2 Client Road\nManchester",
      period: new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric" }),
      billing_month: new Date().toISOString().slice(0, 7),
      currency,
      payment_terms: String(settings?.default_payment_terms ?? "Payment due within 30 days"),
      purchase_order_number: "PO-SAMPLE",
      client_reference: "REF-SAMPLE",
      bank_name: "Sample Bank",
      account_name: "Your Business Ltd",
      account_number: "12345678",
      sort_code: "12-34-56",
      iban: "", swift_bic: "", routing_number: "", payment_link: "",
      payment_reference: "SAMPLE-0001",
      payment_details: "Bank: Sample Bank\nAccount number: 12345678\nSort code: 12-34-56",
      items: totals.lines.map((l) => ({
        description: l.description,
        service_date: "",
        quantity: l.quantity,
        unit: l.unit ?? "",
        unit_price: formatMoneyCents(l.unit_price_cents, currency),
        discount: "",
        tax: formatMoneyCents(l.tax_cents, currency),
        amount: formatMoneyCents(l.total_cents, currency),
      })),
      subtotal: formatMoneyCents(totals.subtotal_cents, currency),
      discount: formatMoneyCents(0, currency),
      tax_rate: "20%",
      tax: formatMoneyCents(totals.tax_cents, currency),
      total: formatMoneyCents(totals.total_cents, currency),
      amount_paid: formatMoneyCents(0, currency),
      balance_due: formatMoneyCents(totals.total_cents, currency),
      notes: "This is a sample render — real invoices use your saved data.",
      footer: String(settings?.invoice_footer ?? ""),
      status: "sample",
    };

    const { data: tplFile, error: dlErr } = await sb.storage.from(BUCKET).download(tpl.storage_path);
    if (dlErr || !tplFile) return { ok: false as const, error: `Could not load template file: ${dlErr?.message ?? "missing"}` };

    if (tpl.template_type === "pdf_overlay") {
      const fields: any[] = Array.isArray(tpl.fields_json) ? tpl.fields_json : [];
      if (fields.length === 0) return { ok: false as const, error: "Place at least one field in the layout designer before test-rendering." };
      let pdfBuf: Buffer;
      try {
        const { renderPdfOverlay } = await import("@/lib/documents/pdf-overlay.server");
        pdfBuf = await renderPdfOverlay(Buffer.from(await tplFile.arrayBuffer()), fields, payload);
      } catch (err: any) {
        return { ok: false as const, error: `Overlay render failed: ${err?.message ?? "render error"}` };
      }
      const pdfPreviewPath = `previews/${tpl.id}_sample.pdf`;
      try { await sb.storage.from(BUCKET).remove([pdfPreviewPath]); } catch { /* best-effort */ }
      const { error: upPdfErr } = await sb.storage.from(BUCKET).upload(pdfPreviewPath, pdfBuf, { contentType: "application/pdf", upsert: true });
      if (upPdfErr) return { ok: false as const, error: upPdfErr.message };
      const { data: signedPdf } = await sb.storage.from(BUCKET).createSignedUrl(pdfPreviewPath, 600, { download: `${tpl.name}-sample.pdf` });
      return { ok: true as const, downloadUrl: signedPdf?.signedUrl ?? null };
    }

    let outBuf: Buffer;
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

    const previewPath = `previews/${tpl.id}_sample.docx`;
    try {
      await sb.storage.from(BUCKET).remove([previewPath]);
    } catch {
      // best-effort — upsert below replaces the file anyway
    }
    const { error: upErr } = await sb.storage.from(BUCKET).upload(previewPath, outBuf, {
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      upsert: true,
    });
    if (upErr) return { ok: false as const, error: upErr.message };
    const { data: signed } = await sb.storage.from(BUCKET).createSignedUrl(previewPath, 600, { download: `${tpl.name}-sample.docx` });
    return { ok: true as const, downloadUrl: signed?.signedUrl ?? null };
  });

// ── Recurring schedules (CRUD — generation is draft-first in the tick) ──────

const recurringLineSchema = z.object({
  description: z.string().min(1).max(500),
  quantity: z.number().min(0).max(1_000_000),
  unit: z.string().max(30).default(""),
  unit_price_cents: z.number().int().min(0).max(1_000_000_000),
  tax_rate_percent: z.number().min(0).max(100).default(20),
  discount_cents: z.number().int().min(0).max(1_000_000_000).default(0),
  service_date: z.string().nullish(),
});

export const listRecurringInvoices = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .handler(async () => {
    const sb = supabaseAdmin as any;
    const { data: rows, error } = await sb
      .from("accountsmind_recurring_invoices")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) return { schedules: [], error: error.message };
    const wsIds = [...new Set((rows ?? []).map((r: any) => r.workspace_id))];
    let names: Record<string, string> = {};
    if (wsIds.length) {
      const { data: wss } = await sb.from("workspaces").select("id,name").in("id", wsIds);
      names = Object.fromEntries((wss ?? []).map((w: any) => [w.id, w.name]));
    }
    return { schedules: (rows ?? []).map((r: any) => ({ ...r, workspace_name: names[r.workspace_id] ?? "—" })) };
  });

export const saveRecurringInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid().nullish(),
        workspaceId: z.string().uuid(),
        name: z.string().min(1).max(200),
        dayOfMonth: z.number().int().min(1).max(28),
        currency: z.string().min(3).max(8).default("GBP"),
        taxMode: z.enum(["exclusive", "inclusive"]).default("exclusive"),
        items: z.array(recurringLineSchema).min(1).max(100),
        paymentProfileId: z.string().uuid().nullish(),
        templateId: z.string().uuid().nullish(),
        paymentTerms: z.string().max(500).default(""),
        customerNotes: z.string().max(2000).default(""),
        dueDays: z.number().int().min(0).max(365).default(30),
        active: z.boolean().default(true),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const sb = supabaseAdmin as any;
    const userId = (context as any).userId ?? null;

    const { data: ws } = await sb.from("workspaces").select("id").eq("id", data.workspaceId).maybeSingle();
    if (!ws) return { ok: false as const, error: "Client workspace not found." };
    // Validate the items produce a sane invoice.
    const totals = computeInvoiceTotals(data.items as any, { taxMode: data.taxMode as TaxMode });
    if (totals.total_cents <= 0) return { ok: false as const, error: "Recurring invoice total must be greater than zero." };

    const row = {
      workspace_id: data.workspaceId,
      name: data.name.trim(),
      day_of_month: data.dayOfMonth,
      currency: data.currency,
      tax_mode: data.taxMode,
      items_json: data.items,
      payment_profile_id: data.paymentProfileId ?? null,
      template_id: data.templateId ?? null,
      payment_terms: data.paymentTerms,
      customer_notes: data.customerNotes,
      due_days: data.dueDays,
      active: data.active,
      updated_at: new Date().toISOString(),
    };
    if (data.id) {
      const { data: updated, error } = await sb.from("accountsmind_recurring_invoices").update(row).eq("id", data.id).select("*").maybeSingle();
      if (error) return { ok: false as const, error: error.message };
      if (!updated) return { ok: false as const, error: "Schedule not found." };
      return { ok: true as const, schedule: updated, previewTotalCents: totals.total_cents };
    }
    const { data: inserted, error } = await sb
      .from("accountsmind_recurring_invoices")
      .insert({ ...row, created_by_user_id: userId })
      .select("*")
      .maybeSingle();
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const, schedule: inserted, previewTotalCents: totals.total_cents };
  });

export const deleteRecurringInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const sb = supabaseAdmin as any;
    // Generated invoices keep their recurring_id for history; deleting the
    // schedule never touches invoices.
    const { error } = await sb.from("accountsmind_recurring_invoices").delete().eq("id", data.id);
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });
