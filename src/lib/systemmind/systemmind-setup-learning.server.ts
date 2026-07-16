// ── SystemMind Setup Learning (SERVER ONLY) ────────────────────────────────────
// Every time a setup is successfully completed (an automation draft activated,
// a build applied, a workflow generated and turned on, etc.), SystemMind writes
// a short "what worked" note into the workspace's own systemmind knowledge base.
// Future builds, repairs and recommendations retrieve these notes via
// querySystemMindKnowledgeContext / retrieveExecutiveKnowledge, so SystemMind
// genuinely learns from each successful setup in that workspace.
//
// Fire-and-forget: callers must NEVER let a learning failure break the
// activation itself — use recordSetupSuccessLearning(...).catch(...).

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getKnowledgeBaseBySlug, resolveOpenAiKey } from "@/lib/executives/executive-knowledge.server";
import { indexTextDocument } from "@/lib/executives/executive-document-processing.server";

export type SetupSuccessEntry = {
  workspaceId: string;
  /** e.g. "workflow", "build_workspace_apply", "whatsapp_setup", "n8n_blueprint" */
  kind: string;
  title: string;
  /** Small, non-sensitive summary facts about what was activated. */
  summary?: Record<string, unknown>;
};

const MAX_SUMMARY_CHARS = 2000;

function renderNote(entry: SetupSuccessEntry, when: string): string {
  const lines: string[] = [
    `# Successful setup: ${entry.title}`,
    "",
    `- Kind: ${entry.kind}`,
    `- Completed: ${when}`,
    "",
    "This setup was reviewed, approved and activated successfully in this workspace.",
    "Treat it as a proven, working pattern when generating or repairing similar setups here.",
  ];
  const summary = entry.summary ?? {};
  const keys = Object.keys(summary);
  if (keys.length > 0) {
    lines.push("", "## Details");
    for (const k of keys) {
      const v = summary[k];
      const rendered = typeof v === "string" ? v : JSON.stringify(v);
      if (rendered != null) lines.push(`- ${k}: ${String(rendered).slice(0, 400)}`);
    }
  }
  return lines.join("\n").slice(0, MAX_SUMMARY_CHARS + 1000);
}

/**
 * Record a successful setup into the workspace's systemmind KB.
 * Idempotent per (workspace, kind, sourceId): re-activation updates the note.
 */
export async function recordSetupSuccessLearning(
  entry: SetupSuccessEntry & { sourceId: string },
): Promise<void> {
  const sb = supabaseAdmin as any;
  const kb = await getKnowledgeBaseBySlug(sb, entry.workspaceId, "systemmind");
  const apiKey = await resolveOpenAiKey(sb, entry.workspaceId);

  const seedKey = `setup_success:${entry.kind}:${entry.sourceId}`;
  const title = `Successful setup — ${entry.title}`.slice(0, 200);
  const when = new Date().toISOString();

  const { data: existing } = await sb
    .from("executive_documents")
    .select("id")
    .eq("workspace_id", entry.workspaceId)
    .eq("seed_key", seedKey)
    .maybeSingle();

  let documentId: string | undefined = existing?.id;
  if (documentId) {
    await sb
      .from("executive_documents")
      .update({ title, embedding_status: "pending", error_message: null })
      .eq("id", documentId)
      .eq("workspace_id", entry.workspaceId);
  } else {
    const { data: doc, error } = await sb
      .from("executive_documents")
      .insert({
        workspace_id: entry.workspaceId,
        knowledge_base_id: kb.id,
        source_type: "manual",
        title,
        seed_key: seedKey,
        embedding_status: "pending",
      })
      .select("id")
      .single();
    if (error || !doc) throw new Error(error?.message ?? "Failed to create setup-learning document.");
    documentId = doc.id;
  }

  await indexTextDocument(sb, {
    documentId: documentId!,
    workspaceId: entry.workspaceId,
    text: renderNote(entry, when),
    apiKey,
  });
}
