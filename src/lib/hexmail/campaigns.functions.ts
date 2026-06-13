import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ActionType =
  | "email"
  | "whatsapp"
  | "sms"
  | "ai_call"
  | "task"
  | "notification"
  | "pipeline_update"
  | "tag_assignment";

export interface CampaignAction {
  id: string;
  type: ActionType;
  template_id: string | null;
  notes: string;
  config: Record<string, unknown>;
}

export interface CampaignStep {
  id?: string;
  day_number: number;
  actions: CampaignAction[];
}

export interface CampaignConfig {
  template_id?: string | null;
  target_statuses?: string[];
  start_date?: string | null;
  end_date?: string | null;
  execution_time?: string | null;
  timezone?: string | null;
  frequency?: "daily" | "custom_interval";
  interval_days?: number;
}

export interface HexmailCampaign {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  status: "draft" | "active" | "paused" | "archived";
  config: CampaignConfig;
  created_at: string;
  updated_at: string;
  steps?: CampaignStep[];
}

const actionSchema = z.object({
  id: z.string(),
  type: z.enum([
    "email","whatsapp","sms","ai_call","task","notification","pipeline_update","tag_assignment",
  ]),
  template_id: z.string().nullable(),
  notes: z.string(),
  config: z.record(z.unknown()),
});

const stepSchema = z.object({
  day_number: z.number().int().positive(),
  actions: z.array(actionSchema),
});

export const listHexmailCampaigns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ includeArchived: z.boolean().optional() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const sb = supabase as any;
    let q = sb
      .from("hexmail_campaigns")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });
    if (!data.includeArchived) q = q.neq("status", "archived");
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return (rows ?? []) as HexmailCampaign[];
  });

export const getHexmailCampaignWithSteps = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const sb = supabase as any;
    const { data: campaign, error: ce } = await sb
      .from("hexmail_campaigns")
      .select("*")
      .eq("id", data.id)
      .eq("workspace_id", workspaceId)
      .single();
    if (ce || !campaign) throw new Error("Campaign not found");
    const { data: steps, error: se } = await sb
      .from("hexmail_campaign_steps")
      .select("*")
      .eq("campaign_id", data.id)
      .order("day_number", { ascending: true });
    if (se) throw new Error(se.message);
    return { ...campaign, steps: (steps ?? []) } as HexmailCampaign;
  });

const configSchema = z
  .object({
    template_id: z.string().nullable().optional(),
    target_statuses: z.array(z.string()).optional(),
    start_date: z.string().nullable().optional(),
    end_date: z.string().nullable().optional(),
    execution_time: z.string().nullable().optional(),
    timezone: z.string().nullable().optional(),
    frequency: z.enum(["daily", "custom_interval"]).optional(),
    interval_days: z.number().int().positive().optional(),
  })
  .optional();

export const saveHexmailCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().optional(),
        name: z.string().min(1),
        description: z.string().optional().nullable(),
        status: z.enum(["draft", "active", "paused", "archived"]).optional(),
        config: configSchema,
        steps: z.array(stepSchema),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const sb = supabase as any;
    const now = new Date().toISOString();

    let campaignId = data.id;

    if (campaignId) {
      const { error } = await sb
        .from("hexmail_campaigns")
        .update({
          name: data.name,
          description: data.description ?? null,
          status: data.status ?? "draft",
          config: data.config ?? {},
          updated_at: now,
        })
        .eq("id", campaignId)
        .eq("workspace_id", workspaceId);
      if (error) throw new Error(error.message);
    } else {
      const { data: row, error } = await sb
        .from("hexmail_campaigns")
        .insert({
          workspace_id: workspaceId,
          name: data.name,
          description: data.description ?? null,
          status: data.status ?? "draft",
          config: data.config ?? {},
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      campaignId = row.id as string;
    }

    await sb.from("hexmail_campaign_steps").delete().eq("campaign_id", campaignId);

    if (data.steps.length > 0) {
      const stepRows = data.steps.map((s) => ({
        campaign_id: campaignId,
        day_number: s.day_number,
        actions: s.actions,
      }));
      const { error: stepErr } = await sb.from("hexmail_campaign_steps").insert(stepRows);
      if (stepErr) throw new Error(stepErr.message);
    }

    return { id: campaignId as string };
  });

export const updateHexmailCampaignStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string(),
        status: z.enum(["draft", "active", "paused", "archived"]),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const sb = supabase as any;
    const { error } = await sb
      .from("hexmail_campaigns")
      .update({ status: data.status, updated_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("workspace_id", workspaceId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteHexmailCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const sb = supabase as any;
    const { error } = await sb
      .from("hexmail_campaigns")
      .delete()
      .eq("id", data.id)
      .eq("workspace_id", workspaceId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
