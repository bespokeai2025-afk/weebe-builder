// ── Executive Knowledge — server-only core ────────────────────────────────────
// SERVER ONLY. Never import from a client component. Loaded dynamically inside
// createServerFn handlers (and the weebee_kb adapter).
//
// Provides the shared building blocks for the executive RAG system:
//   • OpenAI embeddings (text-embedding-3-small, direct fetch — no SDK)
//   • default knowledge-base provisioning (idempotent)
//   • access-rule-scoped retrieval via the pgvector match RPC
//   • a formatter that turns retrieved chunks into a prompt-ready block
//
// All queries use the service-role client (`supabaseAdmin`) but are ALWAYS
// scoped by an explicit workspace_id passed in by the caller.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  DEFAULT_EXECUTIVE_KBS,
  getReadableKbSlugs,
  getPlatformKbSlugs,
  EXECUTIVE_EMBEDDING_MODEL,
} from "@/lib/executives/executive-knowledge.config";

export type ExecutiveKbRow = {
  id: string;
  workspace_id: string;
  slug: string;
  mind_type: string;
  name: string;
  description: string | null;
  is_shared: boolean;
};

export type RetrievedChunk = {
  chunkId:    string;
  documentId: string;
  kbId:       string;
  content:    string;
  similarity: number;
  metadata:   Record<string, unknown>;
};

// ── OpenAI key resolution (env first, then workspace setting) ──────────────────
export async function resolveOpenAiKey(sb: any, workspaceId: string): Promise<string> {
  const envKey = process.env.OPENAI_API_KEY;
  if (envKey) return envKey;
  const { data } = await sb
    .from("workspace_settings")
    .select("openai_api_key")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  const key = (data?.openai_api_key as string | undefined)?.trim();
  if (!key) {
    throw new Error("OpenAI API key not configured. Add it in Settings → Integrations.");
  }
  return key;
}

// ── Embeddings (batched, direct fetch) ────────────────────────────────────────
export async function embedTexts(texts: string[], apiKey: string): Promise<number[][]> {
  if (texts.length === 0) return [];
  const out: number[][] = [];
  const BATCH = 96; // stay well under request limits
  for (let i = 0; i < texts.length; i += BATCH) {
    const slice = texts.slice(i, i + BATCH).map((t) => t.replace(/\n+/g, " ").slice(0, 8000));
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: EXECUTIVE_EMBEDDING_MODEL, input: slice }),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      throw new Error(`OpenAI embeddings (${res.status}): ${err.slice(0, 300)}`);
    }
    const json = (await res.json()) as any;
    const rows = (json.data ?? []) as Array<{ embedding: number[]; index: number }>;
    rows.sort((a, b) => a.index - b.index);
    for (const r of rows) out.push(r.embedding);
  }
  return out;
}

export async function embedQuery(text: string, apiKey: string): Promise<number[]> {
  const [vec] = await embedTexts([text], apiKey);
  return vec ?? [];
}

// Postgres `vector` columns accept the text form `[1,2,3]`.
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

// ── Default KB provisioning (idempotent) ──────────────────────────────────────
export async function ensureDefaultKnowledgeBases(
  sb: any,
  workspaceId: string,
): Promise<ExecutiveKbRow[]> {
  const { data: existing } = await sb
    .from("executive_knowledge_bases")
    .select("*")
    .eq("workspace_id", workspaceId);

  const have = new Set<string>((existing ?? []).map((r: any) => r.slug));
  const missing = DEFAULT_EXECUTIVE_KBS.filter((k) => !have.has(k.slug));

  if (missing.length > 0) {
    const rows = missing.map((k) => ({
      workspace_id: workspaceId,
      slug: k.slug,
      mind_type: k.mindType,
      name: k.name,
      description: k.description,
      is_shared: k.isShared,
    }));
    // Upsert is safe against the (workspace_id, slug) unique constraint under
    // concurrent first-use.
    await sb
      .from("executive_knowledge_bases")
      .upsert(rows, { onConflict: "workspace_id,slug", ignoreDuplicates: true });
  }

  const { data: all } = await sb
    .from("executive_knowledge_bases")
    .select("*")
    .eq("workspace_id", workspaceId);
  return (all ?? []) as ExecutiveKbRow[];
}

// Resolve a single KB row by slug, creating the defaults first if needed.
export async function getKnowledgeBaseBySlug(
  sb: any,
  workspaceId: string,
  slug: string,
): Promise<ExecutiveKbRow> {
  const all = await ensureDefaultKnowledgeBases(sb, workspaceId);
  const kb = all.find((k) => k.slug === slug);
  if (!kb) throw new Error(`Knowledge base "${slug}" not found.`);
  return kb;
}

// ── Platform KB resolution ────────────────────────────────────────────────────
// Fetches the platform_default KB rows for the given slugs. Returns [] if the
// migration has not been applied yet (no scope column) — degrades gracefully.
export async function getPlatformKnowledgeBases(
  sb: any,
  slugs: string[],
): Promise<ExecutiveKbRow[]> {
  if (slugs.length === 0) return [];
  try {
    const { data } = await sb
      .from("executive_knowledge_bases")
      .select("*")
      .eq("scope", "platform_default")
      .in("slug", slugs);
    return (data ?? []) as ExecutiveKbRow[];
  } catch {
    return []; // graceful degradation if scope column not yet applied
  }
}

// ── Access-rule-scoped retrieval ──────────────────────────────────────────────
// Retrieval order per spec:
//   1. Workspace-specific KB (e.g. growthmind)
//   2. Workspace shared KB
//   3. Platform default executive KB (e.g. platform_growthmind)
//   4. Platform default shared KB
// All IDs are resolved server-side before calling the SECURITY DEFINER RPC.
export async function retrieveExecutiveKnowledge(opts: {
  sb?: any;
  workspaceId: string;
  mindType: string;
  query: string;
  topK?: number;
  apiKey?: string;
  log?: boolean;
}): Promise<{ chunks: RetrievedChunk[]; kbSlugs: string[] }> {
  const sb = opts.sb ?? (supabaseAdmin as any);
  const topK = Math.max(1, Math.min(opts.topK ?? 5, 20));
  const readableSlugs = getReadableKbSlugs(opts.mindType);

  // ── 1. Workspace KBs ──────────────────────────────────────────────────────
  const all = await ensureDefaultKnowledgeBases(sb, opts.workspaceId);
  const readableKbs = all.filter((k) => readableSlugs.includes(k.slug));

  // ── 2. Platform default KBs (fetched in parallel with embedding) ──────────
  const platformSlugs = getPlatformKbSlugs(opts.mindType);
  const platformKbs   = await getPlatformKnowledgeBases(sb, platformSlugs);

  // Merge: workspace KBs first (ranked higher by order), then platform KBs.
  const allQueryKbs = [...readableKbs, ...platformKbs];
  if (allQueryKbs.length === 0) return { chunks: [], kbSlugs: [] };

  const apiKey = opts.apiKey ?? (await resolveOpenAiKey(sb, opts.workspaceId));
  const queryVec = await embedQuery(opts.query, apiKey);
  if (queryVec.length === 0) {
    return { chunks: [], kbSlugs: [...readableSlugs, ...platformSlugs] };
  }

  // The match RPC is SECURITY DEFINER and granted to service_role only, so it
  // must be invoked with the service-role client (never the user/anon client).
  // The updated RPC WHERE clause accepts both workspace chunks and platform
  // chunks (workspace_id IS NULL) when their KB ids are in the list.
  const rpcClient = supabaseAdmin as any;
  const { data, error } = await rpcClient.rpc("match_executive_document_chunks", {
    p_workspace_id:       opts.workspaceId,
    p_knowledge_base_ids: allQueryKbs.map((k) => k.id),
    p_query_embedding:    toVectorLiteral(queryVec),
    p_match_count:        topK,
  });
  if (error) throw new Error(`Knowledge retrieval failed: ${error.message}`);

  const chunks: RetrievedChunk[] = (data ?? []).map((r: any) => ({
    chunkId:    r.chunk_id,
    documentId: r.document_id,
    kbId:       r.knowledge_base_id,
    content:    r.content,
    similarity: typeof r.similarity === "number" ? r.similarity : 0,
    metadata:   r.metadata ?? {},
  }));

  if (opts.log !== false) {
    const matchedSlugs = Array.from(
      new Set(
        chunks
          .map((c) => allQueryKbs.find((k) => k.id === c.kbId)?.slug)
          .filter(Boolean) as string[],
      ),
    );
    await sb
      .from("executive_knowledge_queries")
      .insert({
        workspace_id:      opts.workspaceId,
        mind_type:         opts.mindType,
        query:             opts.query.slice(0, 2000),
        top_k:             topK,
        matched_count:     chunks.length,
        matched_kb_slugs:  matchedSlugs,
      })
      .then(undefined, () => {/* logging is best-effort */});
  }

  return { chunks, kbSlugs: [...readableSlugs, ...platformSlugs] };
}

// ── Prompt formatting ─────────────────────────────────────────────────────────
// Turns retrieved chunks into a compact, prompt-ready block. Returns "" when no
// relevant knowledge was found so callers can append unconditionally.
export function formatRetrievedKnowledge(
  chunks: RetrievedChunk[],
  opts: { minSimilarity?: number; maxChars?: number } = {},
): string {
  const minSim = opts.minSimilarity ?? 0.2;
  const maxChars = opts.maxChars ?? 6000;
  const relevant = chunks.filter((c) => c.similarity >= minSim);
  if (relevant.length === 0) return "";

  let used = 0;
  const parts: string[] = [];
  for (const c of relevant) {
    const title = (c.metadata?.title as string | undefined) ?? "Reference";
    const block = `• [${title}] ${c.content.trim()}`;
    if (used + block.length > maxChars) break;
    parts.push(block);
    used += block.length;
  }
  if (parts.length === 0) return "";

  return [
    "## Retrieved Knowledge",
    "Relevant reference material from your private knowledge base. Use it to ground your analysis; cite it naturally where useful.",
    "",
    parts.join("\n\n"),
  ].join("\n");
}

// Convenience: retrieve + format in one call. Never throws — returns "" on any
// failure so generation paths degrade gracefully when RAG is unavailable.
export async function getRetrievedKnowledgeBlock(opts: {
  sb?: any;
  workspaceId: string;
  mindType: string;
  query: string;
  topK?: number;
  apiKey?: string;
}): Promise<string> {
  try {
    const { chunks } = await retrieveExecutiveKnowledge(opts);
    return formatRetrievedKnowledge(chunks);
  } catch {
    return "";
  }
}
