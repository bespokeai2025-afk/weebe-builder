import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { splitContent } from "@/lib/hexmail/vars-helpers";

const BUCKET = "hexmail-documents";

/**
 * Extract the storage object path from a hexmail-documents public URL.
 * Returns null unless the URL matches the exact
 * `/storage/v1/object/public/hexmail-documents/<path>` shape — anything else
 * (external hosts, other buckets, non-storage paths) is rejected so we never
 * make raw server-side fetches to attacker-controlled URLs (SSRF).
 */
function storagePathFromPublicUrl(fileUrl: string): string | null {
  let u: URL;
  try { u = new URL(fileUrl); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const marker = `/storage/v1/object/public/${BUCKET}/`;
  const idx = u.pathname.indexOf(marker);
  if (idx === -1) return null;
  const path = decodeURIComponent(u.pathname.slice(idx + marker.length));
  if (!path || path.includes("..")) return null;
  return path;
}

/**
 * Render a Template Studio document template as a filled PDF using the shared
 * PDF overlay engine (the same engine that renders AccountsMind pdf_overlay
 * invoice templates). The template must be a document type with an uploaded
 * PDF (stored as the `subject` URL) and a saved overlay layout (`_pdfOverlay`
 * inside the content vars JSON).
 */
export const renderHexmailTemplatePdf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        templateId: z.string().uuid(),
        fills: z.record(z.string(), z.string().max(4000)).default({}),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context as any;
    if (!workspaceId) return { ok: false as const, error: "No active workspace" };

    const { data: tpl, error } = await (supabase as any)
      .from("hexmail_templates")
      .select("id,name,type,subject,content")
      .eq("id", data.templateId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (error) return { ok: false as const, error: error.message };
    if (!tpl) return { ok: false as const, error: "Template not found." };

    const fileUrl = String(tpl.subject ?? "");
    const storagePath = storagePathFromPublicUrl(fileUrl);
    if (!storagePath) {
      return { ok: false as const, error: "This template has no uploaded document — upload a PDF first." };
    }
    // Uploads are keyed by workspace (createTemplateDocumentUploadUrl stores as
    // `<workspaceId>/<file>`); enforce that so one tenant can't point their
    // template at another workspace's file.
    if (!storagePath.startsWith(`${workspaceId}/`)) {
      return { ok: false as const, error: "The uploaded document does not belong to this workspace." };
    }
    if (!/\.pdf$/i.test(storagePath)) {
      return { ok: false as const, error: "The uploaded file is not a PDF — the layout designer only works with PDF backgrounds." };
    }

    const { vars, overlay } = splitContent(String(tpl.content ?? ""));
    if (!overlay.length) {
      return { ok: false as const, error: "No PDF layout saved yet — open the layout designer and place fields first." };
    }

    let pdfBuf: Buffer;
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: blob, error: dlError } = await supabaseAdmin.storage.from(BUCKET).download(storagePath);
      if (dlError || !blob) throw new Error(dlError?.message ?? "download failed");
      pdfBuf = Buffer.from(await blob.arrayBuffer());
    } catch (err: any) {
      return { ok: false as const, error: `Could not load the template PDF: ${err?.message ?? "unknown error"}` };
    }

    // Payload = variable defaults overridden by caller-supplied fills.
    const payload: Record<string, string> = {};
    for (const [k, def] of Object.entries(vars)) payload[k] = def?.default ?? "";
    for (const [k, v] of Object.entries(data.fills)) payload[k] = v;

    try {
      const { renderPdfOverlay } = await import("@/lib/documents/pdf-overlay.server");
      const out = await renderPdfOverlay(pdfBuf, overlay as any, payload);
      const safeName = String(tpl.name ?? "document").replace(/[^\w\- ]+/g, "").trim() || "document";
      return { ok: true as const, fileName: `${safeName}.pdf`, base64: out.toString("base64") };
    } catch (err: any) {
      return { ok: false as const, error: `PDF render failed: ${err?.message ?? "unknown error"}` };
    }
  });
