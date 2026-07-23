// ── GrowthMind Content Intelligence activity/audit log ────────────────────────
// SERVER ONLY. Every content-intelligence action (DNA changes, social
// connections, trend/recommendation/publishing lifecycle, mode changes) writes
// a row here. Reads happen via authenticated RLS (SELECT-only for members);
// writes go through the admin client because the table is server-write-only.
//
// Never throws — audit logging must not break the action it describes.

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type GrowthMindActivityCategory =
  | "dna"
  | "social"
  | "trends"
  | "recommendations"
  | "publishing"
  | "mode"
  | "sources"
  | "other";

export interface GrowthMindActivityInput {
  workspaceId: string;
  actor?: "growthmind" | "user" | "system";
  actorUserId?: string | null;
  category: GrowthMindActivityCategory;
  action: string;              // machine-readable verb, e.g. "dna.version_saved"
  entityType?: string | null;
  entityId?: string | null;
  summary?: string | null;     // human-readable one-liner
  detail?: Record<string, unknown>;
  modeAtTime?: string | null;
}

export async function logGrowthMindActivity(input: GrowthMindActivityInput): Promise<void> {
  try {
    const sb = supabaseAdmin as any;
    const { error } = await sb.from("growthmind_activity_log").insert({
      workspace_id:  input.workspaceId,
      actor:         input.actor ?? "growthmind",
      actor_user_id: input.actorUserId ?? null,
      category:      input.category,
      action:        input.action,
      entity_type:   input.entityType ?? null,
      entity_id:     input.entityId ?? null,
      summary:       input.summary ?? null,
      detail:        input.detail ?? {},
      mode_at_time:  input.modeAtTime ?? null,
    });
    if (error) console.warn("[gm-activity] insert failed:", error.message);
  } catch (err: any) {
    console.warn("[gm-activity] insert error:", err?.message ?? err);
  }
}

/** Fetch the current GrowthMind autonomy mode (server-side helper, never throws). */
export async function getGrowthMindModeServer(workspaceId: string): Promise<string> {
  try {
    const sb = supabaseAdmin as any;
    const { data } = await sb
      .from("workspace_settings")
      .select("growthmind_mode")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    return (data?.growthmind_mode as string) ?? "recommend";
  } catch {
    return "recommend";
  }
}
