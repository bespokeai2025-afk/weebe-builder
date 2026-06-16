import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ── Types ────────────────────────────────────────────────────────────────────
export type HiveMindMode   = "observe" | "recommend" | "assistant" | "operator";
export type ActionStatus   = "pending" | "approved" | "rejected" | "executed" | "failed";
export type ActionType     =
  | "create_task"
  | "create_followup_campaign"
  | "enroll_leads_in_campaign"
  | "move_pipeline_stage"
  | "assign_knowledge_base"
  | "launch_broadcast"
  | "growthmind_video_campaign"
  | "growthmind_growth_campaign";

export interface HiveMindAction {
  id:             string;
  workspace_id:   string;
  title:          string;
  description:    string | null;
  action_type:    ActionType;
  action_payload: Record<string, unknown>;
  status:         ActionStatus;
  proposed_by:    string;
  approved_by:    string | null;
  result:         Record<string, unknown> | null;
  error_message:  string | null;
  created_at:     string;
  updated_at:     string;
  executed_at:    string | null;
}

// ── Action execution ─────────────────────────────────────────────────────────
async function executeAction(sb: any, workspaceId: string, action: HiveMindAction): Promise<Record<string, unknown>> {
  const p = action.action_payload;

  switch (action.action_type) {
    case "create_task": {
      const { data, error } = await sb.from("hivemind_tasks").insert({
        workspace_id: workspaceId,
        title:        p.title,
        description:  p.description ?? null,
        priority:     p.priority ?? "medium",
        status:       "approved",
        source:       "action",
        trigger_type: p.trigger_type ?? null,
        entity_type:  p.entity_type ?? null,
        entity_id:    p.entity_id ?? null,
        entity_name:  p.entity_name ?? null,
      }).select().single();
      if (error) throw error;
      return { task_id: data.id };
    }

    case "create_followup_campaign": {
      const { data, error } = await sb.from("hexmail_campaigns").insert({
        workspace_id: workspaceId,
        name:         p.name ?? "HiveMind Follow-Up Campaign",
        description:  p.description ?? null,
        status:       "draft",
        config:       p.config ?? {},
      }).select().single();
      if (error) throw error;
      // If lead_ids provided, enroll them immediately
      if (Array.isArray(p.lead_ids) && (p.lead_ids as string[]).length > 0) {
        const enrollments = (p.lead_ids as string[]).map((lid: string) => ({
          workspace_id: workspaceId,
          campaign_id:  data.id,
          lead_id:      lid,
          status:       "active",
          current_day:  0,
        }));
        await sb.from("hexmail_campaign_enrollments").upsert(enrollments, { onConflict: "campaign_id,lead_id", ignoreDuplicates: true });
      }
      return { campaign_id: data.id, enrolled: Array.isArray(p.lead_ids) ? (p.lead_ids as string[]).length : 0 };
    }

    case "enroll_leads_in_campaign": {
      if (!p.campaign_id) throw new Error("campaign_id required");
      const leadIds = (p.lead_ids as string[]) ?? [];
      if (leadIds.length === 0) throw new Error("No lead_ids provided");
      const enrollments = leadIds.map((lid: string) => ({
        workspace_id: workspaceId,
        campaign_id:  p.campaign_id,
        lead_id:      lid,
        status:       "active",
        current_day:  0,
      }));
      const { error } = await sb.from("hexmail_campaign_enrollments")
        .upsert(enrollments, { onConflict: "campaign_id,lead_id", ignoreDuplicates: true });
      if (error) throw error;
      return { enrolled: leadIds.length };
    }

    case "move_pipeline_stage": {
      const leadIds = (p.lead_ids as string[]) ?? [];
      if (leadIds.length === 0) throw new Error("No lead_ids provided");
      const { error } = await sb.from("leads")
        .update({ status: p.new_status, pipeline_stage: p.new_stage ?? null, updated_at: new Date().toISOString() })
        .in("id", leadIds)
        .eq("workspace_id", workspaceId);
      if (error) throw error;
      return { moved: leadIds.length, new_status: p.new_status };
    }

    case "assign_knowledge_base": {
      if (!p.agent_id) throw new Error("agent_id required");
      const { data: agent, error: fe } = await sb.from("agents")
        .select("settings").eq("id", p.agent_id).single();
      if (fe) throw fe;
      const settings = { ...(agent.settings ?? {}), knowledgeBase: p.knowledge_base ?? null };
      const { error } = await sb.from("agents")
        .update({ settings, updated_at: new Date().toISOString() })
        .eq("id", p.agent_id)
        .eq("workspace_id", workspaceId);
      if (error) throw error;
      return { agent_id: p.agent_id };
    }

    case "growthmind_video_campaign": {
      const { dispatchVideoGeneration } = await import("@/lib/growthmind/growthmind.dispatch.server");
      const result = await dispatchVideoGeneration(sb, workspaceId, {
        video_type:      String(p.video_type      ?? "meta_video_ad"),
        quality_mode:    String(p.quality_mode     ?? "fast"),
        target_audience: String(p.target_audience  ?? ""),
        offer:           String(p.offer            ?? ""),
        tone:            String(p.tone             ?? "professional"),
        cta:             String(p.cta              ?? ""),
        voice_id:        p.voice_id  ? String(p.voice_id)  : undefined,
        campaign_id:     p.campaign_id ? String(p.campaign_id) : undefined,
      });
      return result;
    }

    case "growthmind_growth_campaign": {
      const { dispatchGrowthCampaign } = await import("@/lib/growthmind/growthmind.dispatch.server");
      const result = await dispatchGrowthCampaign(sb, workspaceId, {
        campaign_type: p.campaign_type ? String(p.campaign_type) : undefined,
        budget:        p.budget != null ? Number(p.budget) : null,
        goal:          p.goal   ? String(p.goal)   : undefined,
      });
      return result;
    }

    default:
      throw new Error(`Unknown action type: ${action.action_type}`);
  }
}

// ── getHiveMindMode ───────────────────────────────────────────────────────────
export const getHiveMindMode = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as any;
    try {
      const { data } = await sb.from("workspace_settings")
        .select("hivemind_mode")
        .eq("workspace_id", context.workspaceId)
        .maybeSingle();
      return { mode: (data?.hivemind_mode ?? "assistant") as HiveMindMode };
    } catch { return { mode: "assistant" as HiveMindMode }; }
  });

// ── setHiveMindMode ───────────────────────────────────────────────────────────
export const setHiveMindMode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ mode: z.enum(["observe","recommend","assistant","operator"]) }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb = context.supabase as any;
    const { error } = await sb.from("workspace_settings")
      .update({ hivemind_mode: data.mode })
      .eq("workspace_id", context.workspaceId);
    if (error) throw error;
    return { ok: true };
  });

// ── getHiveMindActionsAndCounts ───────────────────────────────────────────────
export const getHiveMindActionsAndCounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as any;
    const { data, error } = await sb.from("hivemind_actions")
      .select("*")
      .eq("workspace_id", context.workspaceId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    const actions  = (data ?? []) as HiveMindAction[];
    const pending  = actions.filter(a => a.status === "pending").length;
    return { actions, pending, badge: pending };
  });

// ── proposeHiveMindAction ─────────────────────────────────────────────────────
export const proposeHiveMindAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      title:          z.string().min(1).max(300),
      description:    z.string().max(2000).optional(),
      action_type:    z.string(),
      action_payload: z.record(z.unknown()).default({}),
      proposed_by:    z.string().default("hivemind"),
    }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb = context.supabase as any;
    const { data: row, error } = await sb.from("hivemind_actions")
      .insert({ workspace_id: context.workspaceId, ...data, status: "pending" })
      .select().single();
    if (error) throw error;
    return { action: row as HiveMindAction };
  });

// ── approveHiveMindAction ─────────────────────────────────────────────────────
export const approveHiveMindAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      id:          z.string().uuid(),
      approved_by: z.string().default("User"),
    }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb = context.supabase as any;
    const { data: action, error: fe } = await sb.from("hivemind_actions")
      .select("*")
      .eq("id", data.id)
      .eq("workspace_id", context.workspaceId)
      .single();
    if (fe) throw fe;
    if (action.status !== "pending") throw new Error("Action is not pending");

    try {
      const result = await executeAction(sb, context.workspaceId, action as HiveMindAction);
      await sb.from("hivemind_actions").update({
        status: "executed", approved_by: data.approved_by,
        result, executed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).eq("id", data.id);
      return { ok: true, result };
    } catch (err: any) {
      await sb.from("hivemind_actions").update({
        status: "failed", error_message: err?.message ?? String(err), updated_at: new Date().toISOString(),
      }).eq("id", data.id);
      throw err;
    }
  });

// ── rejectHiveMindAction ──────────────────────────────────────────────────────
export const rejectHiveMindAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid() }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb = context.supabase as any;
    const { error } = await sb.from("hivemind_actions")
      .update({ status: "rejected", updated_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("workspace_id", context.workspaceId);
    if (error) throw error;
    return { ok: true };
  });

// ── deleteHiveMindAction ──────────────────────────────────────────────────────
export const deleteHiveMindAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid() }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb = context.supabase as any;
    const { error } = await sb.from("hivemind_actions")
      .delete()
      .eq("id", data.id)
      .eq("workspace_id", context.workspaceId);
    if (error) throw error;
    return { ok: true };
  });

// ── generateOperatorActions ───────────────────────────────────────────────────
// Analyses platform and proposes specific executable actions (Operator mode)
export const generateOperatorActions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const now   = new Date();
    const s14   = new Date(now); s14.setDate(now.getDate() - 14);
    const s7    = new Date(now); s7.setDate(now.getDate() - 7);
    const s2    = new Date(now); s2.setDate(now.getDate() - 2);

    const [agRes, leadRes, campRes, hexRes, enrollRes] = await Promise.all([
      sb.from("agents").select("id,name,retell_agent_id,settings").eq("workspace_id", workspaceId),
      sb.from("leads").select("id,status,updated_at").eq("workspace_id", workspaceId).limit(3000),
      sb.from("call_campaigns").select("id,name,status,total_leads,completed_calls,created_at").eq("workspace_id", workspaceId).limit(100),
      sb.from("hexmail_campaigns").select("id,name,status").eq("workspace_id", workspaceId).limit(50),
      sb.from("hexmail_campaign_enrollments").select("lead_id").eq("workspace_id", workspaceId).eq("status", "active").limit(5000),
    ]);

    const agents    = agRes.data    ?? [];
    const leads     = leadRes.data  ?? [];
    const camps     = campRes.data  ?? [];
    const hexCamps  = hexRes.data   ?? [];
    const enrolled  = new Set((enrollRes.data ?? []).map((e: any) => e.lead_id));

    // Check existing pending actions to avoid duplicates
    const { data: existing } = await sb.from("hivemind_actions")
      .select("action_type").eq("workspace_id", workspaceId).eq("status", "pending");
    const pendingTypes = new Set((existing ?? []).map((a: any) => a.action_type));

    const proposed: any[] = [];

    const activeStatuses = ["need_to_call","calling","interested","qualified","contact_made"];

    // 1. Idle active leads not enrolled in any campaign → propose enroll in nurture campaign
    const idleLeads = leads.filter(
      (l: any) => activeStatuses.includes(l.status) && new Date(l.updated_at) < s14
    );
    const unenrolledIdle = idleLeads.filter((l: any) => !enrolled.has(l.id));

    if (unenrolledIdle.length > 0 && !pendingTypes.has("create_followup_campaign")) {
      proposed.push({
        workspace_id:   workspaceId,
        title:          `Create 30-day nurture campaign for ${unenrolledIdle.length} idle lead${unenrolledIdle.length !== 1 ? "s" : ""}`,
        description:    `${unenrolledIdle.length} active lead${unenrolledIdle.length !== 1 ? "s" : ""} have had no activity for 14+ days and are not enrolled in any follow-up sequence. Creating a 30-day nurture campaign will re-engage them automatically.`,
        action_type:    "create_followup_campaign",
        action_payload: {
          name:        "30-Day Lead Nurture",
          description: `Auto-generated nurture sequence for ${unenrolledIdle.length} idle leads`,
          config:      { auto_enroll: true },
          lead_ids:    unenrolledIdle.slice(0, 500).map((l: any) => l.id),
        },
        proposed_by: "hivemind",
        status:      "pending",
      });
    }

    // 2. Agents not deployed → create task
    for (const agent of agents) {
      const deployed = !!(agent.settings?.deployedRetellAgentId || agent.retell_agent_id);
      if (!deployed && !pendingTypes.has("create_task")) {
        proposed.push({
          workspace_id:   workspaceId,
          title:          `Deploy agent "${agent.name}"`,
          description:    `The agent "${agent.name}" has been built but is not deployed. Deploy it to start handling live calls and campaigns.`,
          action_type:    "create_task",
          action_payload: {
            title:       `Deploy agent "${agent.name}"`,
            description: `Go to the Agent Builder and deploy "${agent.name}" to make it live.`,
            priority:    "high",
            trigger_type:"agent_not_deployed",
            entity_type: "agent",
            entity_id:   agent.id,
            entity_name: agent.name,
          },
          proposed_by: "hivemind",
          status:      "pending",
        });
      }
    }

    // 3. Stalled campaigns → create task
    for (const c of camps) {
      const isActive = ["active","running"].includes(c.status ?? "");
      const isOld    = new Date(c.created_at) < s2;
      if (isActive && isOld && (c.total_leads ?? 0) > 0 && (c.completed_calls ?? 0) === 0) {
        if (!pendingTypes.has("create_task")) {
          proposed.push({
            workspace_id:   workspaceId,
            title:          `Review stalled campaign "${c.name}"`,
            description:    `Campaign "${c.name}" has been active for 2+ days with ${c.total_leads} leads but 0 calls completed. Review its schedule and configuration.`,
            action_type:    "create_task",
            action_payload: {
              title:       `Review stalled campaign "${c.name}"`,
              description: `Campaign "${c.name}" is active but no calls have been completed in 2+ days. Check the schedule, targets, and agent assignment.`,
              priority:    "high",
            },
            proposed_by: "hivemind",
            status:      "pending",
          });
        }
      }
    }

    // 4. No follow-up campaigns exist → propose creating one
    if (hexCamps.length === 0 && leads.length > 10 && !pendingTypes.has("create_followup_campaign")) {
      proposed.push({
        workspace_id:   workspaceId,
        title:          "Set up your first follow-up email campaign",
        description:    `You have ${leads.length} leads but no follow-up email campaigns configured. A structured follow-up sequence can significantly improve conversion rates.`,
        action_type:    "create_followup_campaign",
        action_payload: {
          name:        "New Lead Welcome Sequence",
          description: "Automated welcome and nurture sequence for new leads",
          config:      {},
        },
        proposed_by: "hivemind",
        status:      "pending",
      });
    }

    // 5. Marketing opportunity gap → propose GrowthMind video campaign
    // Triggered when there are active leads but no video assets this month
    if (
      !pendingTypes.has("growthmind_video_campaign") &&
      leads.filter((l: any) => ["need_to_call","calling","interested","qualified","contact_made"].includes(l.status)).length > 5
    ) {
      // Check if any video assets exist this month
      const monthStart = new Date(now); monthStart.setDate(1); monthStart.setHours(0,0,0,0);
      const { data: recentVideos } = await sb
        .from("growthmind_video_assets")
        .select("id")
        .eq("workspace_id", workspaceId)
        .gte("created_at", monthStart.toISOString())
        .limit(1)
        .catch(() => ({ data: [] }));

      if (!recentVideos || recentVideos.length === 0) {
        // Check GrowthMind opportunities for high-score finding
        const { data: topOpp } = await sb
          .from("growthmind_opportunities")
          .select("title,urgency")
          .eq("workspace_id", workspaceId)
          .in("urgency", ["critical","high"])
          .order("confidence_score", { ascending: false })
          .limit(1)
          .catch(() => ({ data: [] }));

        const oppTitle = topOpp?.[0]?.title;
        proposed.push({
          workspace_id:   workspaceId,
          title:          "Create a video marketing campaign via GrowthMind",
          description:    `Your pipeline has active leads but no video content this month.${oppTitle ? ` Top opportunity: ${oppTitle}.` : ""} A short video ad can significantly boost engagement and conversion.`,
          action_type:    "growthmind_video_campaign",
          action_payload: {
            video_type:      "meta_video_ad",
            quality_mode:    "fast",
            target_audience: "active leads and prospects",
            offer:           "",
            tone:            "professional",
            cta:             "Book a call today",
          },
          proposed_by: "hivemind",
          status:      "pending",
        });
      }
    }

    if (proposed.length > 0) {
      await sb.from("hivemind_actions").insert(proposed);
    }

    return { proposed: proposed.length };
  });
