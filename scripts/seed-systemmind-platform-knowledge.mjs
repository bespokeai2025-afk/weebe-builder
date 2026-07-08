/**
 * Write (or update) a note into the platform_systemmind knowledge base
 * (scope = platform_default, workspace_id = NULL) so every workspace's
 * SystemMind (CTO) executive picks it up automatically.
 *
 * This is a standalone duplicate of the chunk/embed/store logic in
 * src/lib/executives/executive-document-processing.server.ts + the insert
 * logic in src/lib/systemmind/systemmind-platform-knowledge.server.ts,
 * written this way only because tsx cannot resolve this project's "@/"
 * path aliases outside of the Vite pipeline. The real app-facing API is
 * `recordSystemMindPlatformKnowledge()` in that server file — use it from
 * server code going forward; this script exists purely as a one-off/manual
 * CLI runner with the same behavior.
 *
 * Usage:
 *   node scripts/seed-systemmind-platform-knowledge.mjs entries.json
 *   entries.json: [{ "seedKey": "...", "title": "...", "content": "..." }, ...]
 *
 * Requires: VITE_SUPABASE_URL (or SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !OPENAI_API_KEY) {
  console.error("Missing SUPABASE_URL/VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or OPENAI_API_KEY.");
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const EMBEDDING_MODEL = "text-embedding-3-small";

function chunkText(text, maxChars = 3500, overlapChars = 400) {
  const clean = text.replace(/\r/g, "").replace(/\u0000/g, "").trim();
  if (!clean) return [];
  const rawParas = clean.split(/\n\s*\n+/).map((p) => p.trim()).filter(Boolean);
  const paras = [];
  for (const p of rawParas) {
    if (p.length <= maxChars) { paras.push(p); continue; }
    for (let i = 0; i < p.length; i += maxChars) paras.push(p.slice(i, i + maxChars));
  }
  const chunks = [];
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

async function embedTexts(texts) {
  const out = [];
  const BATCH = 96;
  for (let i = 0; i < texts.length; i += BATCH) {
    const slice = texts.slice(i, i + BATCH).map((t) => t.replace(/\n+/g, " ").slice(0, 8000));
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: slice }),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      throw new Error(`OpenAI embeddings (${res.status}): ${err.slice(0, 300)}`);
    }
    const json = await res.json();
    const rows = (json.data ?? []).sort((a, b) => a.index - b.index);
    for (const r of rows) out.push(r.embedding);
  }
  return out;
}

function toVectorLiteral(vec) {
  return `[${vec.join(",")}]`;
}

async function getPlatformSystemMindKbId() {
  const { data, error } = await sb
    .from("executive_knowledge_bases")
    .select("id")
    .eq("scope", "platform_default")
    .eq("slug", "platform_systemmind")
    .maybeSingle();
  if (error || !data) throw new Error("platform_systemmind KB not found — apply PLATFORM_KNOWLEDGE_MIGRATION.sql first.");
  return data.id;
}

async function recordEntry(kbId, entry) {
  const { data: existing } = await sb
    .from("executive_documents")
    .select("id")
    .is("workspace_id", null)
    .eq("seed_key", entry.seedKey)
    .maybeSingle();

  let documentId;
  if (existing?.id) {
    documentId = existing.id;
    await sb.from("executive_documents").update({
      title: entry.title,
      embedding_status: "processing",
      error_message: null,
    }).eq("id", documentId);
  } else {
    const { data: doc, error } = await sb
      .from("executive_documents")
      .insert({
        workspace_id: null,
        knowledge_base_id: kbId,
        source_type: "manual",
        title: entry.title,
        seed_key: entry.seedKey,
        embedding_status: "processing",
      })
      .select("id")
      .single();
    if (error || !doc) throw new Error(error?.message ?? "insert failed");
    documentId = doc.id;
  }

  try {
    const chunks = chunkText(entry.content);
    if (chunks.length === 0) throw new Error("No extractable text.");
    const embeddings = await embedTexts(chunks);

    await sb.from("executive_document_chunks").delete().eq("document_id", documentId);
    const rows = chunks.map((content, i) => ({
      workspace_id: null,
      document_id: documentId,
      knowledge_base_id: kbId,
      chunk_index: i,
      content,
      token_count: Math.ceil(content.length / 4),
      embedding_vector: toVectorLiteral(embeddings[i]),
      metadata: { title: entry.title, chunk: i },
    }));
    const BATCH = 100;
    for (let i = 0; i < rows.length; i += BATCH) {
      const { error } = await sb.from("executive_document_chunks").insert(rows.slice(i, i + BATCH));
      if (error) throw new Error(error.message);
    }

    await sb.from("executive_documents").update({
      embedding_status: "indexed",
      chunk_count: chunks.length,
      indexed_at: new Date().toISOString(),
      error_message: null,
    }).eq("id", documentId);

    return { documentId, chunkCount: chunks.length };
  } catch (e) {
    await sb.from("executive_documents").update({
      embedding_status: "failed",
      error_message: String(e?.message ?? e).slice(0, 500),
    }).eq("id", documentId);
    throw e;
  }
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: node scripts/seed-systemmind-platform-knowledge.mjs entries.json");
    process.exit(1);
  }
  const entries = JSON.parse(readFileSync(file, "utf-8"));
  const kbId = await getPlatformSystemMindKbId();
  for (const entry of entries) {
    try {
      const result = await recordEntry(kbId, entry);
      console.log(`OK  ${entry.seedKey} -> doc ${result.documentId} (${result.chunkCount} chunks)`);
    } catch (e) {
      console.error(`FAIL ${entry.seedKey}:`, e.message);
    }
  }
}

main();
