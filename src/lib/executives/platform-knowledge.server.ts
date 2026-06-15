// ── Platform Knowledge — admin server functions (SERVER ONLY) ─────────────────
// All mutations go through supabaseAdmin (service_role) which bypasses RLS.
// Admin gate: every handler checks profiles.user_type = 'admin'.
// Read-only functions (list, stats) are usable by any authenticated user.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// ── Admin gate helper ─────────────────────────────────────────────────────────
async function assertPlatformAdmin(userId: string): Promise<void> {
  const { data } = await (supabaseAdmin as any)
    .from("profiles")
    .select("user_type")
    .eq("user_id", userId)
    .maybeSingle();
  if (data?.user_type !== "admin") {
    throw new Error("Platform admin access required.");
  }
}

// ── List platform KBs ─────────────────────────────────────────────────────────
/** Returns all platform_default KB rows. Usable by any authenticated user. */
export const listPlatformKnowledgeBases = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { data, error } = await (supabaseAdmin as any)
      .from("executive_knowledge_bases")
      .select("id, slug, mind_type, name, description, is_shared, scope, created_at")
      .eq("scope", "platform_default")
      .order("slug");
    if (error) throw new Error(error.message);
    return { kbs: data ?? [] };
  });

// ── List platform documents ───────────────────────────────────────────────────
/** Returns documents for a platform KB. Usable by any authenticated user. */
export const getPlatformDocuments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ kbSlug: z.string().min(1) }).parse(input),
  )
  .handler(async ({ data }) => {
    const sb = supabaseAdmin as any;
    // Resolve KB id.
    const { data: kb } = await sb
      .from("executive_knowledge_bases")
      .select("id, name")
      .eq("slug", data.kbSlug)
      .eq("scope", "platform_default")
      .maybeSingle();
    if (!kb) throw new Error(`Platform KB "${data.kbSlug}" not found.`);

    const { data: docs, error } = await sb
      .from("executive_documents")
      .select("id, title, seed_key, source_type, embedding_status, chunk_count, error_message, created_at, indexed_at")
      .is("workspace_id", null)
      .eq("knowledge_base_id", kb.id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    return { kb, docs: docs ?? [] };
  });

// ── Platform doc stats (for Knowledge Centre dashboard) ───────────────────────
/** Aggregate stats across all platform KBs. Usable by any authenticated user. */
export const getPlatformKnowledgeStats = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const sb = supabaseAdmin as any;
    const [kbRes, docsRes] = await Promise.all([
      sb.from("executive_knowledge_bases").select("id, slug, name, description, is_shared").eq("scope", "platform_default").order("slug"),
      sb.from("executive_documents").select("id, knowledge_base_id, embedding_status, chunk_count").is("workspace_id", null),
    ]);
    const kbs  = (kbRes.data ?? []) as any[];
    const docs = (docsRes.data ?? []) as any[];

    const perKb = kbs.map((kb: any) => {
      const kbDocs    = docs.filter((d: any) => d.knowledge_base_id === kb.id);
      const indexed   = kbDocs.filter((d: any) => d.embedding_status === "indexed").length;
      const pending   = kbDocs.filter((d: any) => d.embedding_status === "pending" || d.embedding_status === "processing").length;
      const failed    = kbDocs.filter((d: any) => d.embedding_status === "failed").length;
      const chunkCount = kbDocs.reduce((s: number, d: any) => s + (d.chunk_count ?? 0), 0);
      return { ...kb, docCount: kbDocs.length, indexed, pending, failed, chunkCount };
    });

    const totalDocs   = docs.length;
    const totalChunks = docs.reduce((s: number, d: any) => s + (d.chunk_count ?? 0), 0);
    const totalIndexed = docs.filter((d: any) => d.embedding_status === "indexed").length;

    return { perKb, totalDocs, totalChunks, totalIndexed };
  });

// ── Admin: upload URL for a platform document ─────────────────────────────────
export const getPlatformUploadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      kbSlug:   z.string().min(1),
      fileName: z.string().min(1),
      mimeType: z.string().optional(),
    }).parse(input),
  )
  .handler(async ({ context, data }) => {
    await assertPlatformAdmin((context as any).userId);

    const sb = supabaseAdmin as any;
    const { ensureExecutiveBucket } = await import("@/lib/executives/executive-document-processing.server");
    await ensureExecutiveBucket();

    const { data: kb } = await sb
      .from("executive_knowledge_bases")
      .select("id")
      .eq("slug", data.kbSlug)
      .eq("scope", "platform_default")
      .maybeSingle();
    if (!kb) throw new Error(`Platform KB "${data.kbSlug}" not found.`);

    const safeFile   = data.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = `platform/${kb.id}/${Date.now()}_${safeFile}`;

    const { data: signed, error } = await supabaseAdmin.storage
      .from("executive-documents")
      .createSignedUploadUrl(storagePath);
    if (error || !signed) throw new Error("Could not create platform upload URL.");

    return { signedUrl: signed.signedUrl, storagePath, knowledgeBaseId: kb.id };
  });

// ── Admin: record + index a completed platform upload ────────────────────────
export const recordPlatformDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      kbSlug:      z.string().min(1),
      title:       z.string().min(1),
      fileName:    z.string().min(1),
      mimeType:    z.string().optional(),
      fileSize:    z.number().optional(),
      storagePath: z.string().min(1),
    }).parse(input),
  )
  .handler(async ({ context, data }) => {
    await assertPlatformAdmin((context as any).userId);

    const sb = supabaseAdmin as any;
    const { data: kb } = await sb
      .from("executive_knowledge_bases")
      .select("id")
      .eq("slug", data.kbSlug)
      .eq("scope", "platform_default")
      .maybeSingle();
    if (!kb) throw new Error(`Platform KB "${data.kbSlug}" not found.`);

    const { data: doc, error } = await sb
      .from("executive_documents")
      .insert({
        workspace_id:      null,
        knowledge_base_id: kb.id,
        source_type:       "upload",
        title:             data.title,
        file_name:         data.fileName,
        mime_type:         data.mimeType ?? null,
        file_size:         data.fileSize ?? null,
        storage_path:      data.storagePath,
        embedding_status:  "pending",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    const { indexUploadedDocument } = await import("@/lib/executives/executive-document-processing.server");
    await indexUploadedDocument(supabaseAdmin, {
      documentId:  doc.id,
      workspaceId: null,
    });

    return { documentId: doc.id };
  });

// ── Admin: delete a platform document ────────────────────────────────────────
export const deletePlatformDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ documentId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    await assertPlatformAdmin((context as any).userId);

    const sb = supabaseAdmin as any;
    // Verify it's actually a platform doc (workspace_id IS NULL).
    const { data: doc } = await sb
      .from("executive_documents")
      .select("id, storage_path")
      .is("workspace_id", null)
      .eq("id", data.documentId)
      .maybeSingle();
    if (!doc) throw new Error("Platform document not found.");

    // Delete chunks first.
    await sb.from("executive_document_chunks").delete().eq("document_id", data.documentId);

    // Delete storage file (best-effort).
    if (doc.storage_path) {
      await supabaseAdmin.storage
        .from("executive-documents")
        .remove([doc.storage_path])
        .then(undefined, () => {/* best-effort */});
    }

    await sb.from("executive_documents").delete().eq("id", data.documentId);
    return { ok: true };
  });

// ── Admin: re-index a platform document ──────────────────────────────────────
export const reindexPlatformDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ documentId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    await assertPlatformAdmin((context as any).userId);

    const sb = supabaseAdmin as any;
    const { data: doc } = await sb
      .from("executive_documents")
      .select("id, knowledge_base_id, storage_path, title, mime_type")
      .is("workspace_id", null)
      .eq("id", data.documentId)
      .maybeSingle();
    if (!doc) throw new Error("Platform document not found.");
    if (!doc.storage_path) throw new Error("No storage path — cannot re-index seeded documents via this endpoint.");

    // Delete existing chunks and reset status.
    await sb.from("executive_document_chunks").delete().eq("document_id", data.documentId);
    await sb.from("executive_documents").update({ embedding_status: "pending", error_message: null, chunk_count: 0, indexed_at: null }).eq("id", data.documentId);

    const { indexUploadedDocument } = await import("@/lib/executives/executive-document-processing.server");
    await indexUploadedDocument(supabaseAdmin, {
      documentId:  doc.id,
      workspaceId: null,
    });
    return { ok: true };
  });

// ── Admin: seed the 7 default platform documents ──────────────────────────────
export const seedPlatformDefaults = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ limit: z.number().int().min(1).max(5).optional() }).parse(input ?? {}),
  )
  .handler(async ({ context, data }) => {
    await assertPlatformAdmin((context as any).userId);
    const { seedPlatformKnowledge } = await import("@/lib/executives/platform-knowledge-seed.server");
    return seedPlatformKnowledge(data.limit ?? 2);
  });
