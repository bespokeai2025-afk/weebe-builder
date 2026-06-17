// ── Business DNA Server Functions ─────────────────────────────────────────────
// Server fns powering /hivemind/business-dna page.
// get / update / run-discovery / generate-briefing / list-briefings / mark-read

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ── Get full DNA profile ───────────────────────────────────────────────────────
export const getBusinessDnaFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: any) => d)
  .handler(async ({ context }: any) => {
    const { supabase, workspaceId } = context as any;
    const { data, error } = await supabase
      .from("growthmind_business_dna")
      .select("*")
      .eq("workspace_id", workspaceId)
      .single();
    if (error) throw new Error(error.message);
    return { dna: data };
  });

// ── Update DNA fields manually ─────────────────────────────────────────────────
export const updateBusinessDnaFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: any) => d)
  .handler(async ({ context, data }: any) => {
    const { supabase, workspaceId } = context as any;
    const { fields } = data as { fields: Record<string, any> };

    // When a user manually overrides a field, set confidence to 100 / source = "Manual"
    const existingRes = await supabase
      .from("growthmind_business_dna")
      .select("confidence_scores")
      .eq("workspace_id", workspaceId)
      .single();

    const conf: Record<string, any> = existingRes.data?.confidence_scores ?? {};
    const now = new Date().toISOString();
    for (const key of Object.keys(fields)) {
      if (fields[key] !== undefined) {
        conf[key] = { score: 100, source: "Manual", last_updated: now };
      }
    }

    const { error } = await supabase
      .from("growthmind_business_dna")
      .update({ ...fields, confidence_scores: conf, updated_at: now })
      .eq("workspace_id", workspaceId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── Run DNA discovery engine ───────────────────────────────────────────────────
export const runDnaDiscoveryFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: any) => d)
  .handler(async ({ context }: any) => {
    const { supabase, workspaceId } = context as any;
    const { data: ws } = await supabase
      .from("workspace_settings")
      .select("openai_api_key")
      .eq("workspace_id", workspaceId)
      .single();
    const apiKey = ws?.openai_api_key ?? process.env.OPENAI_API_KEY ?? "";
    if (!apiKey) throw new Error("No OpenAI API key configured.");

    const { runDnaDiscovery } = await import("./dna-discovery.server");
    const result = await runDnaDiscovery(workspaceId, apiKey);

    // Log to executive events
    try {
      const { insertExecutiveEvent } = await import("@/lib/executives/executive-bridge.server");
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await insertExecutiveEvent(supabaseAdmin as any, workspaceId, {
        source: "hivemind",
        event_type: "dna_discovery_completed",
        summary: `Business DNA discovery: updated ${result.updatedFields.length} fields. ${result.summary}`,
        severity: "info",
      });
    } catch { /* non-fatal */ }

    return result;
  });

// ── Generate briefing on demand ────────────────────────────────────────────────
export const generateBriefingFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: any) => d)
  .handler(async ({ context, data }: any) => {
    const { type = "daily" } = (data ?? {}) as { type?: "daily" | "weekly" | "monthly" };
    const { supabase, workspaceId } = context as any;

    const { data: ws } = await supabase
      .from("workspace_settings")
      .select("openai_api_key")
      .eq("workspace_id", workspaceId)
      .single();
    const apiKey = ws?.openai_api_key ?? process.env.OPENAI_API_KEY ?? "";
    if (!apiKey) throw new Error("No OpenAI API key configured.");

    const { generateBriefing } = await import("./briefing-generator.server");
    return generateBriefing(workspaceId, apiKey, type, "manual");
  });

// ── List stored briefings ──────────────────────────────────────────────────────
export const listBriefingsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: any) => d)
  .handler(async ({ context, data }: any) => {
    const { type, limit = 20 } = (data ?? {}) as { type?: string; limit?: number };
    const { supabase, workspaceId } = context as any;

    let query = supabase
      .from("hivemind_briefings")
      .select("id, type, title, summary, meta, is_read, created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (type && type !== "all") query = query.eq("type", type);

    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return { briefings: rows ?? [] };
  });

// ── Get single briefing (full content) ────────────────────────────────────────
export const getBriefingFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: any) => d)
  .handler(async ({ context, data }: any) => {
    const { id } = data as { id: string };
    const { supabase, workspaceId } = context as any;

    const { data: row, error } = await supabase
      .from("hivemind_briefings")
      .select("*")
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .single();
    if (error) throw new Error(error.message);

    // Mark as read
    if (!row.is_read) {
      await supabase.from("hivemind_briefings").update({ is_read: true }).eq("id", id);
    }
    return { briefing: row };
  });

// ── Mark briefing read ─────────────────────────────────────────────────────────
export const markBriefingReadFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: any) => d)
  .handler(async ({ context, data }: any) => {
    const { id } = data as { id: string };
    const { supabase, workspaceId } = context as any;
    await supabase
      .from("hivemind_briefings")
      .update({ is_read: true })
      .eq("id", id)
      .eq("workspace_id", workspaceId);
    return { ok: true };
  });

// ── Get unread briefing count ──────────────────────────────────────────────────
export const getUnreadBriefingCountFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: any) => d)
  .handler(async ({ context }: any) => {
    const { supabase, workspaceId } = context as any;
    const { count } = await supabase
      .from("hivemind_briefings")
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("is_read", false);
    return { count: count ?? 0 };
  });

// ── Proactive campaign proposals (DNA-driven) ─────────────────────────────────
export const generateDnaProposalsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: any) => d)
  .handler(async ({ context }: any) => {
    const { supabase, workspaceId } = context as any;

    const { data: ws } = await supabase
      .from("workspace_settings")
      .select("openai_api_key")
      .eq("workspace_id", workspaceId)
      .single();
    const apiKey = ws?.openai_api_key ?? process.env.OPENAI_API_KEY ?? "";
    if (!apiKey) throw new Error("No OpenAI API key configured.");

    const { generateFullCampaignPackage } = await import("@/lib/growthmind/growthmind.campaign-proposals");
    const result = await generateFullCampaignPackage(workspaceId, apiKey, supabase);

    // Log HiveMind event
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await (supabaseAdmin as any).from("hivemind_events").insert({
        workspace_id: workspaceId,
        trigger_type: "dna_proposals_generated",
        severity: "info",
        priority: 5,
        title: "Campaign proposals generated",
        description: `${result.count} new campaign proposals generated from Business DNA.`,
        metadata: { proposal_ids: result.ids },
      });
    } catch { /* non-fatal */ }

    return result;
  });
