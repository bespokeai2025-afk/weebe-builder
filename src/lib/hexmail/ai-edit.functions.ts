import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { TemplateType } from "./templates.functions";

const TYPE_CONTEXT: Record<string, string> = {
  email:    "a professional email",
  sms:      "a concise SMS message (keep under 160 chars where possible)",
  whatsapp: "a WhatsApp message (conversational, can use emojis sparingly)",
  document: "a business document",
  proposal: "a business proposal document",
  quote:    "a price quote document",
  invoice:  "an invoice document",
  contract: "a legal contract or agreement",
};

export const aiEditTemplateContent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      content:     z.string(),
      instruction: z.string().min(1).max(2000),
      type:        z.string(),
      subject:     z.string().optional(),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not configured on this server");

    const typeCtx = TYPE_CONTEXT[data.type] ?? "a business template";
    const hasContent = data.content.trim().length > 0;

    const systemPrompt = `You are an expert copywriter and document editor. 
The user is editing ${typeCtx}.
${data.subject ? `Document title / subject: "${data.subject}"` : ""}
Return ONLY the updated content — no commentary, no markdown fences, no preamble.
Preserve any {{merge_tags}} exactly as written.
Keep the tone professional and appropriate for the document type.`;

    const userMessage = hasContent
      ? `Here is the current content:\n\n${data.content}\n\n---\nInstruction: ${data.instruction}`
      : `Instruction: ${data.instruction}\n\nCreate the content from scratch.`;

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.7,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user",   content: userMessage },
        ],
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`OpenAI error: ${err}`);
    }

    const json = await resp.json();
    const result = json.choices?.[0]?.message?.content ?? "";
    return { content: result.trim() };
  });

export const extractTemplateDocumentText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      publicUrl: z.string().url(),
      mimeType:  z.string().optional(),
      fileName:  z.string().optional(),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const resp = await fetch(data.publicUrl);
    if (!resp.ok) throw new Error("Could not download file for extraction");

    const mime     = data.mimeType ?? "";
    const ext      = (data.fileName ?? "").split(".").pop()?.toLowerCase() ?? "";
    const arrayBuf = await resp.arrayBuffer();
    const buffer   = Buffer.from(arrayBuf);

    // ── DOCX ──────────────────────────────────────────────────────────────────
    if (ext === "docx" || mime.includes("wordprocessingml") || mime.includes("msword")) {
      const mammoth = await import("mammoth");
      const result  = await mammoth.extractRawText({ buffer });
      return { text: result.value.trim() };
    }

    // ── PDF ───────────────────────────────────────────────────────────────────
    if (ext === "pdf" || mime === "application/pdf") {
      const pdfParse = (await import("pdf-parse")).default;
      const result   = await pdfParse(buffer);
      return { text: result.text.trim() };
    }

    // ── Plain text / CSV / RTF ─────────────────────────────────────────────────
    if (
      ext === "txt" || ext === "csv" || ext === "rtf" ||
      mime.startsWith("text/")
    ) {
      return { text: buffer.toString("utf-8").trim() };
    }

    throw new Error(
      `Text extraction is not supported for this file type (${ext || mime}). ` +
      `Please paste the content manually.`
    );
  });

export const createTemplateDocumentUploadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      fileName: z.string().min(1),
      mimeType: z.string().optional(),
    }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");

    const BUCKET = "hexmail-documents";

    // Ensure bucket exists
    const { data: buckets } = await supabaseAdmin.storage.listBuckets();
    const exists = (buckets ?? []).some((b: any) => b.name === BUCKET);
    if (!exists) {
      await supabaseAdmin.storage.createBucket(BUCKET, {
        public: true,
        fileSizeLimit: 52_428_800,
      });
    }

    const safeFile = data.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = `${workspaceId}/${Date.now()}_${safeFile}`;

    const { data: signed, error } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUploadUrl(storagePath);

    if (error || !signed) throw new Error("Could not create upload URL");

    const { data: pub } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(storagePath);

    return {
      signedUrl:   signed.signedUrl,
      storagePath,
      publicUrl:   pub.publicUrl,
    };
  });
