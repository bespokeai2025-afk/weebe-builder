import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAction } from "@/lib/permissions/permissions.server";

// NOTE on assigned-record visibility: the campaigns table has no per-user
// assignment column, so campaign visibility for restricted roles is governed
// by their `campaigns` page-access level (hidden / view_only) rather than a
// row-level assignment filter. Leads, calls and follow-up tasks — which DO
// carry assignment — are row-filtered for assignedRecordsOnly roles.
export const listCampaigns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const sb = supabase as any;
    const { data, error } = await sb
      .from("campaigns")
      .select("id, name, description, status, agent_id, created_at, updated_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as Array<{
      id: string;
      name: string;
      description: string | null;
      status: string;
      agent_id: string | null;
      created_at: string;
      updated_at: string;
    }>;
  });

export const createCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        name: z.string().min(1).max(120),
        description: z.string().max(500).nullable().optional(),
        agentId: z.string().uuid().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId, userId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    await requireAction(workspaceId, userId, "campaign_activation");
    const { requireResourceCapacity } = await import("@/lib/packages/entitlements.server");
    await requireResourceCapacity(workspaceId, "campaigns");
    const sb = supabase as any;
    const { data: row, error } = await sb
      .from("campaigns")
      .insert({
        workspace_id: workspaceId,
        name: data.name,
        description: data.description ?? null,
        agent_id: data.agentId ?? null,
        status: "active",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id as string };
  });

export const deleteCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const sb = supabase as any;
    const { error } = await sb.from("campaigns").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getCampaignStats = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ campaignId: z.string().uuid().nullable().optional() }).parse(input ?? {}),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const sb = supabase as any;

    let recQ = sb
      .from("data_records")
      .select("id, call_status, last_call_sentiment")
      .eq("workspace_id", workspaceId)
      .eq("is_deleted", false);
    if (data.campaignId) recQ = recQ.eq("campaign_id", data.campaignId);
    const { data: records, error: recErr } = await recQ;
    if (recErr) throw new Error(recErr.message);

    const rows = (records ?? []) as Array<{
      id: string;
      call_status: string;
      last_call_sentiment: string | null;
    }>;

    const called = rows.filter((r) => ["completed", "failed"].includes(r.call_status)).length;
    const reached = rows.filter((r) => r.call_status === "completed").length;
    const positive = rows.filter((r) => r.last_call_sentiment === "positive").length;
    const positivePct = reached > 0 ? Math.round((positive / reached) * 100) : 0;
    const conversionRate = called > 0 ? Math.round((reached / called) * 100) : 0;

    const { data: leads } = await sb
      .from("leads")
      .select("id, lead_score, meeting_requested, sentiment")
      .eq("workspace_id", workspaceId);

    const leadRows = (leads ?? []) as Array<{
      id: string;
      lead_score: number | null;
      meeting_requested: boolean;
      sentiment: string | null;
    }>;

    const meetingsBooked = leadRows.filter((l) => l.meeting_requested).length;
    const scoredLeads = leadRows.filter((l) => l.lead_score != null);
    const avgLeadScore =
      scoredLeads.length > 0
        ? Math.round(
            scoredLeads.reduce((acc, l) => acc + (l.lead_score ?? 0), 0) / scoredLeads.length,
          )
        : null;

    return {
      total: rows.length,
      called,
      reached,
      positivePct,
      meetingsBooked,
      avgLeadScore,
      conversionRate,
    };
  });
