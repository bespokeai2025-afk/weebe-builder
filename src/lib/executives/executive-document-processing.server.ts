// ── Executive Document Processing — server-only ───────────────────────────────
// SERVER ONLY. Dynamically imported inside createServerFn handlers so the heavy
// parsing deps (pdf-parse / mammoth / xlsx) never reach client bundles.
//
// Pipeline: download (or accept text) → extract → chunk → embed → store chunks,
// driving each document through the embedding_status lifecycle
// (pending → processing → indexed | failed).

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { embedTexts, resolveOpenAiKey, toVectorLiteral } from "@/lib/executives/executive-knowledge.server";

export const EXECUTIVE_BUCKET = "executive-documents";

// ── Text extraction ───────────────────────────────────────────────────────────
export async function extractTextFromBuffer(
  buffer: Buffer,
  mimeType: string,
  fileName: string,
): Promise<string> {
  const ext = (fileName.split(".").pop() ?? "").toLowerCase();
  const mime = mimeType ?? "";

  // DOCX
  if (ext === "docx" || mime.includes("wordprocessingml") || mime.includes("msword")) {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    return result.value.trim();
  }

  // PDF
  if (ext === "pdf" || mime === "application/pdf") {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: buffer });
    await parser.load();
    const extracted = await parser.getText();
    return (extracted.text ?? "").trim();
  }

  // XLSX / XLS — flatten every sheet to CSV-ish text
  if (
    ext === "xlsx" || ext === "xls" ||
    mime.includes("spreadsheetml") || mime.includes("ms-excel")
  ) {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(buffer, { type: "buffer" });
    const parts: string[] = [];
    for (const sheetName of wb.SheetNames) {
      const sheet = wb.Sheets[sheetName];
      const csv = XLSX.utils.sheet_to_csv(sheet);
      if (csv.trim()) parts.push(`# ${sheetName}\n${csv}`);
    }
    return parts.join("\n\n").trim();
  }

  // TXT / CSV / Markdown / any text/*
  if (
    ext === "txt" || ext === "csv" || ext === "md" || ext === "markdown" ||
    ext === "rtf" || mime.startsWith("text/")
  ) {
    return buffer.toString("utf-8").trim();
  }

  // Fallback: best-effort UTF-8 decode
  return buffer.toString("utf-8").trim();
}

// ── Chunking ──────────────────────────────────────────────────────────────────
// Paragraph-aware accumulation up to ~maxChars (~800-1000 tokens) with overlap.
export function chunkText(
  text: string,
  opts: { maxChars?: number; overlapChars?: number } = {},
): string[] {
  const maxChars = opts.maxChars ?? 3500;
  const overlapChars = opts.overlapChars ?? 400;
  const clean = text.replace(/\r/g, "").replace(/\u0000/g, "").trim();
  if (!clean) return [];

  // First, split any oversized paragraph into hard windows so the accumulator
  // never has to handle a single block larger than maxChars.
  const rawParas = clean.split(/\n\s*\n+/).map((p) => p.trim()).filter(Boolean);
  const paras: string[] = [];
  for (const p of rawParas) {
    if (p.length <= maxChars) { paras.push(p); continue; }
    for (let i = 0; i < p.length; i += maxChars) paras.push(p.slice(i, i + maxChars));
  }

  const chunks: string[] = [];
  let buf = "";
  for (const p of paras) {
    if (buf && buf.length + p.length + 2 > maxChars) {
      chunks.push(buf);
      const tail = buf.slice(-overlapChars);
      buf = `${tail}\n\n${p}`;
    } else {
      buf = buf ? `${buf}\n\n${p}` : p;
    }
  }
  if (buf.trim()) chunks.push(buf);
  return chunks;
}

function approxTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

// ── Core: chunk + embed + store ───────────────────────────────────────────────
async function embedAndStoreChunks(
  sb: any,
  doc: { id: string; workspace_id: string; knowledge_base_id: string; title: string },
  text: string,
  apiKey: string,
): Promise<number> {
  const chunks = chunkText(text);
  if (chunks.length === 0) throw new Error("No extractable text content found in document.");

  const embeddings = await embedTexts(chunks, apiKey);
  if (embeddings.length !== chunks.length) {
    throw new Error("Embedding count did not match chunk count.");
  }

  // Replace any prior chunks for this document (re-index safe).
  await sb.from("executive_document_chunks").delete().eq("document_id", doc.id);

  const rows = chunks.map((content, i) => ({
    workspace_id: doc.workspace_id,
    document_id: doc.id,
    knowledge_base_id: doc.knowledge_base_id,
    chunk_index: i,
    content,
    token_count: approxTokens(content),
    embedding_vector: toVectorLiteral(embeddings[i]),
    metadata: { title: doc.title, chunk: i },
  }));

  // Insert in batches to keep payloads reasonable.
  const BATCH = 100;
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await sb.from("executive_document_chunks").insert(rows.slice(i, i + BATCH));
    if (error) throw new Error(error.message);
  }
  return chunks.length;
}

async function loadDocument(sb: any, documentId: string, workspaceId: string) {
  const { data: doc, error } = await sb
    .from("executive_documents")
    .select("*")
    .eq("id", documentId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error || !doc) throw new Error("Document not found.");
  return doc;
}

async function markStatus(sb: any, documentId: string, fields: Record<string, unknown>) {
  await sb.from("executive_documents").update(fields).eq("id", documentId);
}

// Index an UPLOADED document: download bytes from storage, extract, chunk, embed.
export async function indexUploadedDocument(
  sbArg: any,
  args: { documentId: string; workspaceId: string; apiKey?: string },
): Promise<{ chunkCount: number }> {
  const sb = sbArg ?? (supabaseAdmin as any);
  const doc = await loadDocument(sb, args.documentId, args.workspaceId);
  await markStatus(sb, doc.id, { embedding_status: "processing", error_message: null });
  try {
    if (!doc.storage_path) throw new Error("Document has no stored file.");
    const apiKey = args.apiKey ?? (await resolveOpenAiKey(sb, args.workspaceId));

    const { data: blob, error: dlErr } = await supabaseAdmin.storage
      .from(EXECUTIVE_BUCKET)
      .download(doc.storage_path);
    if (dlErr || !blob) throw new Error(dlErr?.message ?? "Could not download file.");
    const buffer = Buffer.from(await blob.arrayBuffer());

    const text = await extractTextFromBuffer(buffer, doc.mime_type ?? "", doc.file_name ?? doc.title);
    const chunkCount = await embedAndStoreChunks(sb, doc, text, apiKey);

    await markStatus(sb, doc.id, {
      embedding_status: "indexed",
      chunk_count: chunkCount,
      indexed_at: new Date().toISOString(),
      error_message: null,
    });
    return { chunkCount };
  } catch (e: any) {
    await markStatus(sb, doc.id, {
      embedding_status: "failed",
      error_message: String(e?.message ?? e).slice(0, 500),
    });
    throw e;
  }
}

// Index a TEXT document (AI-seeded reference content — no storage download).
export async function indexTextDocument(
  sbArg: any,
  args: { documentId: string; workspaceId: string; text: string; apiKey: string },
): Promise<{ chunkCount: number }> {
  const sb = sbArg ?? (supabaseAdmin as any);
  const doc = await loadDocument(sb, args.documentId, args.workspaceId);
  await markStatus(sb, doc.id, { embedding_status: "processing", error_message: null });
  try {
    const chunkCount = await embedAndStoreChunks(sb, doc, args.text, args.apiKey);
    await markStatus(sb, doc.id, {
      embedding_status: "indexed",
      chunk_count: chunkCount,
      indexed_at: new Date().toISOString(),
      error_message: null,
    });
    return { chunkCount };
  } catch (e: any) {
    await markStatus(sb, doc.id, {
      embedding_status: "failed",
      error_message: String(e?.message ?? e).slice(0, 500),
    });
    throw e;
  }
}

// Ensure the private storage bucket exists (mirrors the existing bucket pattern).
export async function ensureExecutiveBucket(): Promise<void> {
  const { data: buckets } = await supabaseAdmin.storage.listBuckets();
  const exists = (buckets ?? []).some((b: any) => b.name === EXECUTIVE_BUCKET);
  if (!exists) {
    await supabaseAdmin.storage.createBucket(EXECUTIVE_BUCKET, {
      public: false,
      fileSizeLimit: 52_428_800, // 50 MB
    });
  }
}
