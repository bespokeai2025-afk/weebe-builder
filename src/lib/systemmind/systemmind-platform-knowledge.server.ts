// ── SystemMind Platform Knowledge Writer (SERVER ONLY) ─────────────────────────
// Reusable primitive for recording "we just shipped/changed this platform
// capability" notes into the platform_systemmind knowledge base (scope =
// platform_default, workspace_id = NULL), so every workspace's SystemMind
// (CTO) executive picks it up automatically via querySystemMindKnowledgeContext
// / retrieveExecutiveKnowledge — no per-workspace seeding required.
//
// This is intentionally separate from:
//   • systemmind-kb-seed.server.ts   — AI-GENERATED starter docs (per-workspace)
//   • systemmind-workflow.server.ts  — structured repair playbooks (bug fixes)
// Use THIS module when a completed task changed real platform functionality
// (a feature, a data-model rule, a cross-cutting behavior) and SystemMind's
// knowledge of "how the platform works" should reflect it going forward.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { indexTextDocument } from "@/lib/executives/executive-document-processing.server";

const PLATFORM_SYSTEMMIND_SLUG = "platform_systemmind";

async function getPlatformSystemMindKbId(sb: any): Promise<string> {
  const { data, error } = await sb
    .from("executive_knowledge_bases")
    .select("id")
    .eq("scope", "platform_default")
    .eq("slug", PLATFORM_SYSTEMMIND_SLUG)
    .maybeSingle();
  if (error || !data) {
    throw new Error(
      "platform_systemmind KB not found — has PLATFORM_KNOWLEDGE_MIGRATION.sql been applied?",
    );
  }
  return data.id as string;
}

export type PlatformKnowledgeEntry = {
  /** Stable, human-readable key — reusing it UPDATES the existing note instead of duplicating it. */
  seedKey: string;
  title: string;
  /** Markdown content: what shipped, why, and any constraint future work must respect. */
  content: string;
};

/**
 * Write (or update, if `seedKey` already exists) a platform-wide SystemMind
 * knowledge note describing a real, completed change to platform functionality.
 * Available to every workspace's SystemMind executive immediately (no
 * per-workspace seeding step).
 */
export async function recordSystemMindPlatformKnowledge(
  entry: PlatformKnowledgeEntry,
): Promise<{ documentId: string; chunkCount: number; updated: boolean }> {
  const sb = supabaseAdmin as any;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not set — required to embed platform SystemMind knowledge.");
  }

  const kbId = await getPlatformSystemMindKbId(sb);

  const { data: existing } = await sb
    .from("executive_documents")
    .select("id")
    .is("workspace_id", null)
    .eq("seed_key", entry.seedKey)
    .maybeSingle();

  let documentId: string;
  let updated = false;

  if (existing?.id) {
    documentId = existing.id;
    updated = true;
    await sb
      .from("executive_documents")
      .update({ title: entry.title, embedding_status: "pending", error_message: null })
      .eq("id", documentId);
  } else {
    const { data: doc, error } = await sb
      .from("executive_documents")
      .insert({
        workspace_id: null,
        knowledge_base_id: kbId,
        source_type: "manual",
        title: entry.title,
        seed_key: entry.seedKey,
        embedding_status: "pending",
      })
      .select("id")
      .single();
    if (error || !doc) throw new Error(error?.message ?? "Failed to create platform knowledge document.");
    documentId = doc.id;
  }

  const { chunkCount } = await indexTextDocument(sb, {
    documentId,
    workspaceId: null,
    text: entry.content,
    apiKey,
  });

  return { documentId, chunkCount, updated };
}
