/**
 * AccountsMind Invoice Generator.
 *
 * Platform admins upload a DOCX invoice template containing docxtemplater
 * placeholders (e.g. {client_name}, {invoice_number}, a {#items}…{/items}
 * loop). Invoices are generated per client workspace + billing month: the
 * template is filled from the client's billing profile and computed monthly
 * costs (plus any manual line items), stored in a private storage bucket, and
 * downloaded via short-lived signed URLs.
 *
 * All tables here are server-write-only (RLS on, no authenticated policies) —
 * every access path goes through requirePlatformAdmin.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const BUCKET = "accountsmind-invoices";

async function ensureBucket(): Promise<void> {
  const sb = supabaseAdmin as any;
  const { data: buckets } = await sb.storage.listBuckets();
  if (!buckets?.some((b: any) => b.name === BUCKET)) {
    await sb.storage.createBucket(BUCKET, { public: false });
  }
}

const lineItemSchema = z.object({
  description: z.string().min(1).max(300),
  quantity: z.number().finite().nonnegative(),
  unit_price: z.number().finite(), // major units (e.g. pounds)
});

function money(cents: number, currency: string): string {
  const symbol = currency === "GBP" ? "£" : currency === "USD" ? "$" : currency === "EUR" ? "€" : `${currency} `;
  return `${symbol}${(cents / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Extract {placeholder} tags from a DOCX buffer (best-effort, for the UI hint list). */
function extractTags(xml: string): string[] {
  const tags = new Set<string>();
  // docxtemplater default delimiters { }. Word may split runs, so this is a
  // best-effort scan of the raw XML text content.
  const text = xml.replace(/<[^>]+>/g, "");
  for (const m of text.matchAll(/\{[#/]?([a-zA-Z0-9_.]+)\}/g)) tags.add(m[0]);
  return [...tags].slice(0, 100);
}

// ── Templates ────────────────────────────────────────────────────────────────

export const uploadInvoiceTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((input) =>
    z
      .object({
        name: z.string().min(1).max(200),
        fileName: z.string().min(1).max(300),
        fileBase64: z.string().min(1).max(8_000_000), // ~6 MB docx cap
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const userId = (context as any).userId ?? null;
    if (!/\.docx$/i.test(data.fileName)) {
      return { ok: false as const, error: "Template must be a .docx Word file." };
    }
    const buf = Buffer.from(data.fileBase64, "base64");
    // Validate it's a real docx and the template parses.
    let placeholders: string[] = [];
    try {
      const { default: PizZip } = await import("pizzip");
      const { default: Docxtemplater } = await import("docxtemplater");
      const zip = new PizZip(buf);
      new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
      const docXml = zip.file("word/document.xml")?.asText() ?? "";
      placeholders = extractTags(docXml);
    } catch (err: any) {
      return { ok: false as const, error: `Not a valid Word template: ${err?.message ?? "parse failed"}` };
    }

    await ensureBucket();
    const safe = data.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = `templates/${Date.now()}_${safe}`;
    const { error: upErr } = await (supabaseAdmin as any).storage
      .from(BUCKET)
      .upload(storagePath, buf, {
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
    if (upErr) return { ok: false as const, error: upErr.message };

    const { data: row, error } = await (supabaseAdmin as any)
      .from("accountsmind_invoice_templates")
      .insert({
        name: data.name,
        file_name: data.fileName,
        storage_path: storagePath,
        placeholders_json: placeholders,
        uploaded_by_user_id: userId,
      })
      .select("*")
      .maybeSingle();
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const, template: row };
  });

export const listInvoiceTemplates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .handler(async () => {
    const { data, error } = await (supabaseAdmin as any)
      .from("accountsmind_invoice_templates")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) return { templates: [], error: error.message };
    return { templates: data ?? [] };
  });

export const deleteInvoiceTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const sb = supabaseAdmin as any;
    const { data: row } = await sb
      .from("accountsmind_invoice_templates")
      .select("storage_path")
      .eq("id", data.id)
      .maybeSingle();
    if (row?.storage_path) await sb.storage.from(BUCKET).remove([row.storage_path]);
    const { error } = await sb.from("accountsmind_invoice_templates").delete().eq("id", data.id);
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });

// ── Invoice generation ───────────────────────────────────────────────────────

async function nextInvoiceNumber(sb: any): Promise<string> {
  const year = new Date().getUTCFullYear();
  const prefix = `INV-${year}-`;
  const { data } = await sb
    .from("accountsmind_invoices")
    .select("invoice_number")
    .like("invoice_number", `${prefix}%`)
    .order("invoice_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  const last = data?.invoice_number ? parseInt(String(data.invoice_number).slice(prefix.length), 10) : 0;
  return `${prefix}${String((Number.isFinite(last) ? last : 0) + 1).padStart(4, "0")}`;
}

export const generateInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((input) =>
    z
      .object({
        templateId: z.string().uuid(),
        workspaceId: z.string().uuid(),
        month: z.string().regex(/^\d{4}-\d{2}$/), // YYYY-MM
        taxRatePercent: z.number().min(0).max(100).nullish(),
        dueInDays: z.number().int().min(0).max(365).nullish(),
        includeUsageCosts: z.boolean().nullish(),
        extraLineItems: z.array(lineItemSchema).max(30).nullish(),
        notes: z.string().max(2000).nullish(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const userId = (context as any).userId ?? null;
    const sb = supabaseAdmin as any;

    const [{ data: tpl }, { data: ws }, { data: profile }, { data: monthCosts }] = await Promise.all([
      sb.from("accountsmind_invoice_templates").select("*").eq("id", data.templateId).maybeSingle(),
      sb.from("workspaces").select("id,name").eq("id", data.workspaceId).maybeSingle(),
      sb.from("client_billing_profiles").select("*").eq("workspace_id", data.workspaceId).maybeSingle(),
      sb.from("client_monthly_costs").select("*").eq("workspace_id", data.workspaceId).eq("month", data.month).maybeSingle(),
    ]);
    if (!tpl) return { ok: false as const, error: "Template not found." };
    if (!ws) return { ok: false as const, error: "Client workspace not found." };

    const currency = String(profile?.currency ?? "GBP");
    const taxRate = data.taxRatePercent ?? 20;

    // Line items: monthly service charge, optional usage/overage costs, extras.
    const items: Array<{ description: string; quantity: number; unit_price_cents: number }> = [];
    const monthlyCharge = Number(profile?.monthly_charge_cents ?? 0);
    if (monthlyCharge > 0) {
      items.push({
        description: `Monthly service charge — ${data.month}`,
        quantity: 1,
        unit_price_cents: monthlyCharge,
      });
    }
    if (data.includeUsageCosts && monthCosts) {
      const usageCats: Array<[string, string]> = [
        ["voice_cost_cents", "Voice usage"],
        ["llm_cost_cents", "AI / LLM usage"],
        ["telephony_cost_cents", "Telephony usage"],
        ["whatsapp_cost_cents", "WhatsApp usage"],
        ["email_cost_cents", "Email usage"],
        ["video_cost_cents", "Video generation usage"],
        ["image_cost_cents", "Image generation usage"],
      ];
      for (const [col, label] of usageCats) {
        const cents = Number(monthCosts[col] ?? 0);
        if (cents > 0) items.push({ description: `${label} — ${data.month}`, quantity: 1, unit_price_cents: cents });
      }
    }
    for (const li of data.extraLineItems ?? []) {
      items.push({
        description: li.description,
        quantity: li.quantity,
        unit_price_cents: Math.round(li.unit_price * 100),
      });
    }
    if (items.length === 0) {
      return { ok: false as const, error: "Nothing to invoice — no billing profile charge, usage, or manual line items." };
    }

    const subtotal = items.reduce((s, i) => s + Math.round(i.quantity * i.unit_price_cents), 0);
    const tax = Math.round((subtotal * taxRate) / 100);
    const total = subtotal + tax;

    const today = new Date();
    const due = new Date(today.getTime() + (data.dueInDays ?? 30) * 86_400_000);
    const fmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
    const periodLabel = new Date(`${data.month}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });

    // Reserve the invoice number atomically: insert-first with retry on the
    // unique invoice_number index, so concurrent generations never collide.
    let row: any = null;
    let invoiceNumber = "";
    for (let attempt = 0; attempt < 5 && !row; attempt++) {
      invoiceNumber = await nextInvoiceNumber(sb);
      const ins = await sb
        .from("accountsmind_invoices")
        .insert({
          template_id: data.templateId,
          workspace_id: data.workspaceId,
          invoice_number: invoiceNumber,
          invoice_month: data.month,
          client_name: ws.name ?? "Client",
          currency,
          subtotal_cents: subtotal,
          tax_rate_percent: taxRate,
          tax_cents: tax,
          total_cents: total,
          line_items_json: items,
          data_json: {},
          storage_path: "pending",
          status: "unpaid",
          due_date: due.toISOString().slice(0, 10),
          generated_by_user_id: userId,
        })
        .select("*")
        .maybeSingle();
      if (ins.error) {
        if (ins.error.code === "23505") continue; // number taken — retry
        return { ok: false as const, error: ins.error.message };
      }
      row = ins.data;
    }
    if (!row) return { ok: false as const, error: "Could not reserve an invoice number — please try again." };

    const payload: Record<string, any> = {
      invoice_number: invoiceNumber,
      invoice_date: fmt(today),
      due_date: fmt(due),
      client_name: ws.name ?? "Client",
      period: periodLabel,
      billing_month: data.month,
      currency,
      items: items.map((i) => ({
        description: i.description,
        quantity: i.quantity,
        unit_price: money(i.unit_price_cents, currency),
        amount: money(Math.round(i.quantity * i.unit_price_cents), currency),
      })),
      subtotal: money(subtotal, currency),
      tax_rate: `${taxRate}%`,
      tax: money(tax, currency),
      total: money(total, currency),
      notes: data.notes ?? "",
    };

    // Fill the template; if anything fails, release the reserved row.
    const releaseRow = async () => {
      await sb.from("accountsmind_invoices").delete().eq("id", row.id);
    };
    const { data: tplFile, error: dlErr } = await sb.storage.from(BUCKET).download(tpl.storage_path);
    if (dlErr || !tplFile) {
      await releaseRow();
      return { ok: false as const, error: `Could not load template: ${dlErr?.message ?? "missing file"}` };
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
      await releaseRow();
      const detail = err?.properties?.errors?.map((e: any) => e?.properties?.explanation).filter(Boolean).join("; ");
      return { ok: false as const, error: `Template fill failed: ${detail || err?.message || "render error"}` };
    }

    await ensureBucket();
    // Unique per-row path — no upsert, so a race can never overwrite another invoice's file.
    const storagePath = `invoices/${data.workspaceId}/${row.id}_${invoiceNumber}.docx`;
    const { error: upErr } = await sb.storage.from(BUCKET).upload(storagePath, outBuf, {
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    if (upErr) {
      await releaseRow();
      return { ok: false as const, error: upErr.message };
    }

    const { data: finalRow, error } = await sb
      .from("accountsmind_invoices")
      .update({ storage_path: storagePath, data_json: payload })
      .eq("id", row.id)
      .select("*")
      .maybeSingle();
    if (error) return { ok: false as const, error: error.message };
    row = finalRow ?? { ...row, storage_path: storagePath, data_json: payload };

    const { data: signed } = await sb.storage.from(BUCKET).createSignedUrl(storagePath, 600, {
      download: `${invoiceNumber}.docx`,
    });
    return { ok: true as const, invoice: row, downloadUrl: signed?.signedUrl ?? null };
  });

export const listInvoices = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .handler(async () => {
    const { data, error } = await (supabaseAdmin as any)
      .from("accountsmind_invoices")
      .select("id,invoice_number,invoice_month,client_name,workspace_id,currency,subtotal_cents,tax_cents,total_cents,status,due_date,paid_at,created_at")
      .neq("storage_path", "pending")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) return { invoices: [], summary: null, error: error.message };
    // Full-table aggregate for KPI cards — the listing above is capped at the
    // 200 most recent rows and must not be used for totals.
    let summary = null;
    try {
      const { getInvoiceSalesSummary } = await import("@/lib/accountsmind/invoice-sales.server");
      summary = await getInvoiceSalesSummary();
    } catch {}
    return { invoices: data ?? [], summary };
  });

export const INVOICE_STATUSES = ["unpaid", "sent", "paid", "overdue", "cancelled"] as const;

export const updateInvoiceStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(INVOICE_STATUSES),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const sb = supabaseAdmin as any;
    const patch: Record<string, any> = {
      status: data.status,
      status_updated_at: new Date().toISOString(),
      paid_at: data.status === "paid" ? new Date().toISOString() : null,
    };
    const { data: row, error } = await sb
      .from("accountsmind_invoices")
      .update(patch)
      .eq("id", data.id)
      .neq("storage_path", "pending")
      .select("id,status,paid_at,workspace_id")
      .maybeSingle();
    if (error) return { ok: false as const, error: error.message };
    if (!row) return { ok: false as const, error: "Invoice not found." };
    // Bust the workspace's cached HiveMind platform data so executive views
    // reflect the new paid/sales figures immediately.
    if (row.workspace_id) {
      try {
        const { cacheDel } = await import("@/lib/cache/redis.server");
        await cacheDel(`webee:hivemind:${row.workspace_id}:platform:v3`);
      } catch {}
    }
    return { ok: true as const, invoice: row };
  });

export const getInvoiceDownloadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const sb = supabaseAdmin as any;
    const { data: row } = await sb
      .from("accountsmind_invoices")
      .select("storage_path,invoice_number")
      .eq("id", data.id)
      .maybeSingle();
    if (!row || row.storage_path === "pending") return { ok: false as const, error: "Invoice not found." };
    const { data: signed, error } = await sb.storage.from(BUCKET).createSignedUrl(row.storage_path, 600, {
      download: `${row.invoice_number}.docx`,
    });
    if (error || !signed?.signedUrl) return { ok: false as const, error: error?.message ?? "Could not sign URL." };
    return { ok: true as const, downloadUrl: signed.signedUrl };
  });

export const deleteInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const sb = supabaseAdmin as any;
    const { data: row } = await sb
      .from("accountsmind_invoices")
      .select("storage_path")
      .eq("id", data.id)
      .maybeSingle();
    if (row?.storage_path) await sb.storage.from(BUCKET).remove([row.storage_path]);
    const { error } = await sb.from("accountsmind_invoices").delete().eq("id", data.id);
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });
