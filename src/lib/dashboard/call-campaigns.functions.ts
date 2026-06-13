import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const MARKER = "__sched_v1__";

type ScheduleConfig = {
  pageType: "data" | "qualified" | "leads";
  leadStatusFilter: string | null;
  callTime: string;
  timezone: string;
  callFrequency: "daily" | "custom";
  intervalDays: number;
  voicemailEnabled: boolean;
  lastRunDate?: string;
};

function parseDesc(description: string | null): ScheduleConfig | null {
  if (!description?.startsWith(MARKER)) return null;
  try { return JSON.parse(description.slice(MARKER.length)) as ScheduleConfig; } catch { return null; }
}

function encodeDesc(cfg: ScheduleConfig): string {
  return MARKER + JSON.stringify(cfg);
}

export type CallCampaign = {
  id: string;
  name: string;
  status: string;
  agent_id: string | null;
  created_at: string;
  config: ScheduleConfig;
};

export const listCallCampaigns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ pageType: z.enum(["data", "qualified", "leads"]) }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const sb = supabase as any;
    const { data: rows, error } = await sb
      .from("campaigns")
      .select("id, name, description, status, agent_id, created_at")
      .eq("workspace_id", workspaceId)
      .like("description", `${MARKER}%`)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (rows ?? [])
      .map((r: any) => ({ ...r, config: parseDesc(r.description) }))
      .filter((r: any) => r.config?.pageType === data.pageType) as CallCampaign[];
  });

export type CallCampaignWithAgent = CallCampaign & {
  agentName: string | null;
};

export const listAllCallCampaigns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const sb = supabase as any;
    const { data: rows, error } = await sb
      .from("campaigns")
      .select("id, name, description, status, agent_id, created_at")
      .eq("workspace_id", workspaceId)
      .like("description", `${MARKER}%`)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const campaigns = ((rows ?? []) as any[])
      .map((r) => ({ ...r, config: parseDesc(r.description) }))
      .filter((r) => r.config !== null) as CallCampaign[];

    const agentIds = [...new Set(campaigns.map((c) => c.agent_id).filter(Boolean))] as string[];
    let agentNames: Record<string, string> = {};
    if (agentIds.length) {
      const { data: agents } = await sb
        .from("agents")
        .select("id, name")
        .in("id", agentIds);
      agentNames = Object.fromEntries((agents ?? []).map((a: any) => [a.id, a.name]));
    }

    return campaigns.map((c) => ({
      ...c,
      agentName: c.agent_id ? (agentNames[c.agent_id] ?? null) : null,
    })) as CallCampaignWithAgent[];
  });

const campaignInput = z.object({
  name: z.string().min(1).max(120),
  agentId: z.string().nullable().optional(),
  pageType: z.enum(["data", "qualified", "leads"]),
  leadStatusFilter: z.string().nullable().optional(),
  callTime: z.string().default("09:00"),
  timezone: z.string().default("Europe/London"),
  callFrequency: z.enum(["daily", "custom"]).default("daily"),
  intervalDays: z.number().int().min(1).max(365).default(1),
  voicemailEnabled: z.boolean().default(false),
});

export const createCallCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => campaignInput.parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const sb = supabase as any;
    const config: ScheduleConfig = {
      pageType: data.pageType,
      leadStatusFilter: data.leadStatusFilter ?? null,
      callTime: data.callTime,
      timezone: data.timezone,
      callFrequency: data.callFrequency,
      intervalDays: data.intervalDays,
      voicemailEnabled: data.voicemailEnabled,
    };
    const { data: row, error } = await sb
      .from("campaigns")
      .insert({
        workspace_id: workspaceId,
        name: data.name,
        description: encodeDesc(config),
        agent_id: data.agentId ?? null,
        status: "active",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id as string };
  });

export const updateCallCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    campaignInput.extend({ id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const sb = supabase as any;
    const config: ScheduleConfig = {
      pageType: data.pageType,
      leadStatusFilter: data.leadStatusFilter ?? null,
      callTime: data.callTime,
      timezone: data.timezone,
      callFrequency: data.callFrequency,
      intervalDays: data.intervalDays,
      voicemailEnabled: data.voicemailEnabled,
    };
    const { error } = await sb
      .from("campaigns")
      .update({
        name: data.name,
        description: encodeDesc(config),
        agent_id: data.agentId ?? null,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteCallCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const sb = supabase as any;
    const { error } = await sb.from("campaigns").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const toggleCallCampaignPause = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ id: z.string().uuid(), currentStatus: z.string() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const sb = supabase as any;
    const next = data.currentStatus === "active" ? "paused" : "active";
    const { error } = await sb.from("campaigns").update({ status: next }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true, newStatus: next };
  });
