import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// ── Knowledge bases ───────────────────────────────────────────────────────────

/** List (auto-provisioning) the executive knowledge bases for the workspace. */
export const listExecutiveKnowledgeBases = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const { ensureDefaultKnowledgeBases } = await import("@/lib/executives/executive-knowledge.server");
    return ensureDefaultKnowledgeBases(supabaseAdmin as any, workspaceId);
  });

// ── Documents ─────────────────────────────────────────────────────────────────

/** Create a private signed upload URL for an executive knowledge document. */
export const getExecutiveUploadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      slug:     z.string().min(1),
      fileName: z.string().min(1),
      mimeType: z.string().optional(),
    }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const { ensureExecutiveBucket } = await import("@/lib/executives/executive-document-processing.server");
    const { getKnowledgeBaseBySlug } = await import("@/lib/executives/executive-knowledge.server");

    await ensureExecutiveBucket();
    const kb = await getKnowledgeBaseBySlug(supabaseAdmin as any, workspaceId, data.slug);

    const safeFile = data.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = `${workspaceId}/${kb.id}/${Date.now()}_${safeFile}`;

    const { data: signed, error } = await supabaseAdmin.storage
      .from("executive-documents")
      .createSignedUploadUrl(storagePath);
    if (error || !signed) throw new Error("Could not create upload URL.");

    return { signedUrl: signed.signedUrl, storagePath, knowledgeBaseId: kb.id };
  });

/** Record a completed upload and synchronously index it (extract→chunk→embed). */
export const recordExecutiveDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      slug:        z.string().min(1),
      title:       z.string().min(1),
      fileName:    z.string().min(1),
      mimeType:    z.string().optional(),
      fileSize:    z.number().optional(),
      storagePath: z.string().min(1),
    }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const sb = supabaseAdmin as any;
    const { getKnowledgeBaseBySlug } = await import("@/lib/executives/executive-knowledge.server");
    const { indexUploadedDocument } = await import("@/lib/executives/executive-document-processing.server");

    const kb = await getKnowledgeBaseBySlug(sb, workspaceId, data.slug);

    const { data: doc, error } = await sb
      .from("executive_documents")
      .insert({
        workspace_id: workspaceId,
        knowledge_base_id: kb.id,
        source_type: "upload",
        title: data.title,
        file_name: data.fileName,
        mime_type: data.mimeType ?? null,
        file_size: data.fileSize ?? null,
        storage_path: data.storagePath,
        embedding_status: "pending",
      })
      .select("*")
      .single();
    if (error || !doc) throw new Error(error?.message ?? "Could not record document.");

    try {
      await indexUploadedDocument(sb, { documentId: doc.id, workspaceId });
    } catch (e: any) {
      // Document row is already marked "failed" with an error message; surface it
      // to the UI rather than failing the whole request.
      return { ...doc, embedding_status: "failed", error_message: String(e?.message ?? e).slice(0, 500) };
    }

    const { data: fresh } = await sb.from("executive_documents").select("*").eq("id", doc.id).maybeSingle();
    return fresh ?? doc;
  });

/** List documents for a KB slug (or all executive docs when slug omitted). */
export const listExecutiveDocuments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ slug: z.string().optional() }).parse(input ?? {}),
  )
  .handler(async ({ context, data }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const sb = supabaseAdmin as any;
    const { ensureDefaultKnowledgeBases } = await import("@/lib/executives/executive-knowledge.server");
    const kbs = await ensureDefaultKnowledgeBases(sb, workspaceId);

    let q = sb
      .from("executive_documents")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });

    if (data.slug) {
      const kb = kbs.find((k) => k.slug === data.slug);
      if (!kb) return [];
      q = q.eq("knowledge_base_id", kb.id);
    }
    const { data: docs, error } = await q;
    if (error) throw new Error(error.message);
    return docs ?? [];
  });

/** Delete an executive document (storage file + row; chunks cascade). */
export const deleteExecutiveDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ id: z.string() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const sb = supabaseAdmin as any;
    const { data: doc } = await sb
      .from("executive_documents")
      .select("storage_path")
      .eq("id", data.id)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (doc?.storage_path) {
      await supabaseAdmin.storage.from("executive-documents").remove([doc.storage_path]);
    }
    const { error } = await sb
      .from("executive_documents")
      .delete()
      .eq("id", data.id)
      .eq("workspace_id", workspaceId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Re-run extraction + embedding for an existing uploaded document. */
export const reindexExecutiveDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ id: z.string() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const sb = supabaseAdmin as any;
    const { indexUploadedDocument } = await import("@/lib/executives/executive-document-processing.server");
    try {
      await indexUploadedDocument(sb, { documentId: data.id, workspaceId });
    } catch (e: any) {
      return { ok: false, error: String(e?.message ?? e).slice(0, 500) };
    }
    const { data: fresh } = await sb.from("executive_documents").select("*").eq("id", data.id).maybeSingle();
    return { ok: true, document: fresh };
  });

// ── Retrieval ─────────────────────────────────────────────────────────────────

/** Retrieve knowledge for an executive (mind_type), enforcing access rules. */
export const queryExecutiveKnowledge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      mindType: z.string().min(1),
      query:    z.string().min(1),
      topK:     z.number().int().min(1).max(20).optional(),
    }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const { retrieveExecutiveKnowledge } = await import("@/lib/executives/executive-knowledge.server");
    const { chunks, kbSlugs } = await retrieveExecutiveKnowledge({
      workspaceId,
      mindType: data.mindType,
      query: data.query,
      topK: data.topK,
    });
    return { chunks, kbSlugs };
  });

// ── Starter knowledge seeding ─────────────────────────────────────────────────

/** Seed (idempotently) AI-generated starter knowledge — processes a batch per call. */
export const seedExecutiveStarterKnowledge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ limit: z.number().int().min(1).max(10).optional() }).parse(input ?? {}),
  )
  .handler(async ({ context, data }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const { seedExecutiveStarterKnowledge: seed } = await import("@/lib/executives/executive-knowledge-seed.server");
    return seed(workspaceId, data.limit ?? 4);
  });

// ── Dashboard stats ───────────────────────────────────────────────────────────

/** Aggregate knowledge-centre stats for the dashboard. */
export const getExecutiveKnowledgeStats = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const sb = supabaseAdmin as any;
    const { ensureDefaultKnowledgeBases } = await import("@/lib/executives/executive-knowledge.server");

    const [kbs, docsResult, latestDocResult, recentQueriesResult, allQueriesResult] = await Promise.all([
      ensureDefaultKnowledgeBases(sb, workspaceId),
      sb
        .from("executive_documents")
        .select("id, knowledge_base_id, embedding_status, chunk_count, created_at")
        .eq("workspace_id", workspaceId),
      sb
        .from("executive_documents")
        .select("created_at")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      sb
        .from("executive_knowledge_queries")
        .select("id, mind_type, query, matched_count, matched_kb_slugs, created_at")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(10),
      sb
        .from("executive_knowledge_queries")
        .select("mind_type")
        .eq("workspace_id", workspaceId),
    ]);

    const docs = docsResult.data ?? [];

    const perKb = kbs.map((kb: any) => {
      const kbDocs = docs.filter((d: any) => d.knowledge_base_id === kb.id);
      const latestKbDoc = kbDocs.reduce(
        (latest: string | null, d: any) =>
          !latest || d.created_at > latest ? d.created_at : latest,
        null,
      );
      return {
        id: kb.id,
        slug: kb.slug,
        name: kb.name,
        isShared: kb.is_shared,
        documentCount: kbDocs.length,
        indexedCount: kbDocs.filter((d: any) => d.embedding_status === "indexed").length,
        pendingCount: kbDocs.filter((d: any) => d.embedding_status === "pending" || d.embedding_status === "processing").length,
        failedCount: kbDocs.filter((d: any) => d.embedding_status === "failed").length,
        chunkCount: kbDocs.reduce((s: number, d: any) => s + (d.chunk_count ?? 0), 0),
        lastUpload: latestKbDoc,
      };
    });

    // Per-mind usage breakdown
    const allQueriesData: any[] = allQueriesResult.data ?? [];
    const perMindUsage: Record<string, number> = {};
    for (const q of allQueriesData) {
      perMindUsage[q.mind_type] = (perMindUsage[q.mind_type] ?? 0) + 1;
    }

    return {
      perKb,
      totals: {
        knowledgeBases: kbs.length,
        documents: docs.length,
        indexedFiles: perKb.reduce((s: number, k: any) => s + k.indexedCount, 0),
        chunks: perKb.reduce((s: number, k: any) => s + k.chunkCount, 0),
        queries: allQueriesData.length,
        lastUpload: latestDocResult.data?.created_at ?? null,
      },
      perMindUsage,
      recentQueries: recentQueriesResult.data ?? [],
    };
  });
