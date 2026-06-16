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
  | "growthmind_growth_campaign"
  | "register_resend_webhook"
  | "sync_ad_stats";

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

    case "register_resend_webhook": {
      const { registerResendWebhookForWorkspace } = await import("@/lib/hexmail/deliverability.server");
      const result = await registerResendWebhookForWorkspace(workspaceId);
      return result;
    }

    case "sync_ad_stats": {
      const { syncAllAdsForWorkspace } = await import("@/lib/growthmind/growthmind.ads-sync.server");
      const results = await syncAllAdsForWorkspace(workspaceId);
      const synced = results.filter((r: any) => r.ok).length;
      const failed = results.filter((r: any) => !r.ok).length;
      const totalSpend = results.reduce((s: number, r: any) => s + (r.spend ?? 0), 0);
      return { synced, failed, totalSpend, results };
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

    // 6. Email deliverability risks — check sender domains and DNS health
    try {
      const { data: senderDomains } = await sb
        .from("email_sender_domains")
        .select("id,domain,spf_status,dkim_status,dmarc_status,mx_status,status")
        .eq("workspace_id", workspaceId)
        .limit(10);

      const domains = senderDomains ?? [];

      if (domains.length === 0 && hexCamps.length > 0 && !pendingTypes.has("create_task")) {
        proposed.push({
          workspace_id:   workspaceId,
          title:          "Set up a verified sender domain before running email campaigns",
          description:    "You have email campaigns configured but no verified sender domain. Without SPF, DKIM, and DMARC records, emails will likely land in spam or be rejected.",
          action_type:    "create_task",
          action_payload: {
            title:       "Add and verify a sender domain in HexMail",
            description: "Go to HexMail → Sender Domains → Add Domain to verify your DNS records (SPF, DKIM, DMARC).",
            priority:    "high",
            trigger_type: "email_deliverability",
          },
          proposed_by: "hivemind",
          status:      "pending",
        });
      } else {
        for (const dom of domains) {
          const dnsFailing = dom.spf_status !== "pass" || dom.dmarc_status === "missing";
          const suspended  = dom.status === "suspended" || dom.status === "paused";
          if ((dnsFailing || suspended) && !pendingTypes.has("create_task")) {
            proposed.push({
              workspace_id:   workspaceId,
              title:          `Fix deliverability issues on ${dom.domain}`,
              description:    `Domain "${dom.domain}" has DNS issues: ${[
                dom.spf_status !== "pass"   ? "SPF failing" : null,
                dom.dkim_status !== "pass"  ? "DKIM not verified" : null,
                dom.dmarc_status === "missing" ? "DMARC missing" : null,
                suspended ? "domain paused" : null,
              ].filter(Boolean).join(", ")}. Email campaigns from this domain may be blocked or land in spam.`,
              action_type:    "create_task",
              action_payload: {
                title:       `Fix DNS records for ${dom.domain}`,
                description: "Go to HexMail → Sender Domains and update the DNS records. Fix SPF, DKIM, and DMARC to protect your sender reputation.",
                priority:    "high",
                trigger_type: "email_deliverability",
                entity_type: "sender_domain",
                entity_id:   dom.id,
                entity_name: dom.domain,
              },
              proposed_by: "hivemind",
              status:      "pending",
            });
            break; // one action per scan
          }
        }
      }
    } catch { /* graceful — tables may not exist yet */ }

    // 7. Ad accounts with token but never synced — propose sync
    try {
      const { data: stalAccounts } = await sb
        .from("growthmind_ads_accounts")
        .select("id, platform, label")
        .eq("workspace_id", workspaceId)
        .eq("status", "active")
        .not("token_enc", "is", null)
        .or("last_synced_at.is.null,sync_status.eq.error")
        .limit(5)
        .catch(() => ({ data: [] }));

      if ((stalAccounts ?? []).length > 0 && !pendingTypes.has("sync_ad_stats")) {
        const platforms = [...new Set((stalAccounts ?? []).map((a: any) => a.platform))].join(", ");
        proposed.push({
          workspace_id:   workspaceId,
          title:          `Sync live ad stats from ${platforms}`,
          description:    `${(stalAccounts ?? []).length} connected ad account(s) have not synced yet. Approving will pull live campaign data, spend, ROAS and impressions from the ad platform APIs.`,
          action_type:    "sync_ad_stats",
          action_payload: {},
          proposed_by:    "hivemind",
          status:         "pending",
        });
      }
    } catch { /* graceful */ }

    // 8. Ad efficiency checks — low ROAS, budget alerts, stale data
    try {
      const { data: adCamps } = await sb
        .from("growthmind_campaigns")
        .select("id,name,platform,roas,spend,status,updated_at")
        .eq("workspace_id", workspaceId)
        .gte("updated_at", s7.toISOString())
        .limit(100)
        .catch(() => ({ data: [] }));

      const { data: adAlerts } = await sb
        .from("growthmind_ad_budget_alerts")
        .select("id,platform,alert_type,message")
        .eq("workspace_id", workspaceId)
        .eq("acknowledged", false)
        .limit(10)
        .catch(() => ({ data: [] }));

      // 8a. Low ROAS campaigns spending real money
      const lowRoasCamps = (adCamps ?? []).filter(
        (c: any) => c.roas !== null && Number(c.roas) < 1 && Number(c.spend ?? 0) > 50
          && (c.status === "active" || c.status === "enabled")
      );
      if (lowRoasCamps.length > 0 && !pendingTypes.has("create_task")) {
        const names = lowRoasCamps.slice(0, 3).map((c: any) => `"${c.name}"`).join(", ");
        proposed.push({
          workspace_id:   workspaceId,
          title:          `Optimise ${lowRoasCamps.length} ad campaign${lowRoasCamps.length !== 1 ? "s" : ""} with ROAS below 1x`,
          description:    `${lowRoasCamps.length > 1 ? `${lowRoasCamps.length} campaigns are` : "A campaign is"} spending money but returning less than £1 for every £1 spent: ${names}. Review targeting, creative, and bid strategy to improve return on ad spend.`,
          action_type:    "create_task",
          action_payload: {
            title:        `Review and optimise low-ROAS ad campaigns`,
            description:  `Campaigns with ROAS < 1x: ${names}. Check audience targeting, ad creative, landing pages, and bid strategy. Consider pausing until optimised.`,
            priority:     "high",
            trigger_type: "low_roas",
          },
          proposed_by: "hivemind",
          status:      "pending",
        });
      }

      // 8b. Unacknowledged budget alerts
      if ((adAlerts ?? []).length > 0 && !pendingTypes.has("create_task")) {
        const alertMsg = (adAlerts ?? []).slice(0, 2).map((a: any) => a.message).join("; ");
        proposed.push({
          workspace_id:   workspaceId,
          title:          `Review ${(adAlerts ?? []).length} ad budget alert${(adAlerts ?? []).length !== 1 ? "s" : ""}`,
          description:    `Unacknowledged budget alerts detected across your ad accounts: ${alertMsg}. Review spend pacing and adjust budgets or bids as needed.`,
          action_type:    "create_task",
          action_payload: {
            title:        "Review ad budget alerts in GrowthMind → Ads",
            description:  `Go to GrowthMind → Ads to view and dismiss budget alerts. Consider adjusting monthly budgets or pausing overspending campaigns. Alerts: ${alertMsg}`,
            priority:     "medium",
            trigger_type: "budget_alert",
          },
          proposed_by: "hivemind",
          status:      "pending",
        });
      }
    } catch { /* graceful */ }

    // 9. SEO health checks — no keywords tracked, dropping rankings, no GSC
    try {
      const { data: seoSites } = await sb
        .from("growthmind_seo_sites")
        .select("id,url,keywords,ai_recs,updated_at")
        .eq("workspace_id", workspaceId)
        .limit(3)
        .catch(() => ({ data: [] }));

      if ((seoSites ?? []).length === 0) {
        // No SEO site configured at all
        if (!pendingTypes.has("create_task")) {
          proposed.push({
            workspace_id:   workspaceId,
            title:          "Set up SEO tracking in GrowthMind",
            description:    "No site is configured for SEO monitoring. Setting up keyword tracking and connecting Google Search Console gives HiveMind visibility into organic traffic and search rankings alongside your paid ads.",
            action_type:    "create_task",
            action_payload: {
              title:       "Configure SEO tracking in GrowthMind → SEO",
              description: "Go to GrowthMind → SEO, add your site URL, import keywords, and connect Google Search Console to start tracking rankings and organic traffic.",
              priority:    "medium",
              trigger_type:"seo_not_configured",
            },
            proposed_by: "hivemind",
            status:      "pending",
          });
        }
      } else {
        const site     = (seoSites ?? [])[0];
        const keywords = (site.keywords ?? []) as any[];

        // No keywords tracked
        if (keywords.length === 0 && !pendingTypes.has("create_task")) {
          proposed.push({
            workspace_id:   workspaceId,
            title:          `Add keywords to track for ${site.url}`,
            description:    `Your SEO site "${site.url}" has no keywords configured. Adding target keywords lets HiveMind monitor rankings and alert you to drops or opportunities.`,
            action_type:    "create_task",
            action_payload: {
              title:       `Add target keywords in GrowthMind → SEO`,
              description: `Open GrowthMind → SEO for ${site.url} and add the keywords you want to rank for. Then connect Google Search Console to pull live position data.`,
              priority:    "medium",
              trigger_type:"seo_no_keywords",
            },
            proposed_by: "hivemind",
            status:      "pending",
          });
        }

        // Keywords dropping in rank
        const dropping = keywords.filter((k: any) => {
          const trend = k.trend ?? k.position_trend;
          return trend === "dropping" || trend === "down";
        });
        if (dropping.length > 0 && !pendingTypes.has("create_task")) {
          const kList = dropping.slice(0, 3).map((k: any) => `"${k.keyword}"`).join(", ");
          proposed.push({
            workspace_id:   workspaceId,
            title:          `Investigate ${dropping.length} dropping keyword${dropping.length !== 1 ? "s" : ""} on ${site.url}`,
            description:    `Search rankings are falling for ${dropping.length} keyword${dropping.length !== 1 ? "s" : ""}: ${kList}. Review the affected pages for content quality, technical SEO issues, and competitor activity.`,
            action_type:    "create_task",
            action_payload: {
              title:       `Fix dropping keyword rankings — ${site.url}`,
              description: `Investigate pages ranking for: ${kList}. Check for thin content, missing meta tags, slow page speed, or new competitor pages. Refresh content and build supporting internal links.`,
              priority:    "high",
              trigger_type:"seo_rank_drop",
            },
            proposed_by: "hivemind",
            status:      "pending",
          });
        }

        // No AI recommendations generated
        if (keywords.length > 0 && !site.ai_recs && !pendingTypes.has("create_task")) {
          proposed.push({
            workspace_id:   workspaceId,
            title:          `Generate SEO recommendations for ${site.url}`,
            description:    `You're tracking ${keywords.length} SEO keyword${keywords.length !== 1 ? "s" : ""} but haven't generated AI recommendations yet. These give you prioritised fixes for rankings, content gaps, and technical issues.`,
            action_type:    "create_task",
            action_payload: {
              title:       "Generate AI SEO recommendations in GrowthMind → SEO",
              description: `Open GrowthMind → SEO → "${site.url}" and click "Generate Recommendations" to get a prioritised SEO action plan from the AI.`,
              priority:    "low",
              trigger_type:"seo_no_ai_recs",
            },
            proposed_by: "hivemind",
            status:      "pending",
          });
        }
      }
    } catch { /* graceful */ }

    // 10. Resend webhook not registered — auto-propose for workspaces with Resend API key
    try {
      const { checkResendWebhookStatusForWorkspace } = await import("@/lib/hexmail/deliverability.server");
      const whStatus = await checkResendWebhookStatusForWorkspace(workspaceId);
      if (whStatus.hasApiKey && !whStatus.registered && !pendingTypes.has("register_resend_webhook")) {
        proposed.push({
          workspace_id:   workspaceId,
          title:          "Register Resend bounce/complaint webhook",
          description:    "Your workspace has Resend configured but the deliverability webhook is not registered. Approving this action will automatically register the webhook so bounces, complaints, and delivery failures are tracked in real time.",
          action_type:    "register_resend_webhook",
          action_payload: {},
          proposed_by:    "hivemind",
          status:         "pending",
        });
      }
    } catch { /* graceful */ }

    // 11. Prompt Studio — very low-scoring templates (critically poor performance)
    try {
      const [worstRes, bestRes] = await Promise.all([
        sb.from("growthmind_prompt_stats")
          .select("template_id, avg_score, usage_count, growthmind_prompt_templates(name, type)")
          .eq("workspace_id", workspaceId)
          .lt("avg_score", 3)
          .gt("usage_count", 0)
          .order("avg_score", { ascending: true })
          .limit(5),
        sb.from("growthmind_prompt_stats")
          .select("template_id, avg_score, usage_count, growthmind_prompt_templates(name, type)")
          .eq("workspace_id", workspaceId)
          .gt("usage_count", 0)
          .order("avg_score", { ascending: false })
          .limit(3),
      ]);

      const poorPrompts = worstRes.data ?? [];
      const topPrompts  = bestRes.data  ?? [];

      if (poorPrompts.length > 0 && !pendingTypes.has("create_task")) {
        const worstNames = poorPrompts.slice(0, 3)
          .map((p: any) => `"${p.growthmind_prompt_templates?.name ?? "Unknown"}" (${(p.avg_score ?? 0).toFixed(1)}/10)`)
          .join(", ");
        const bestNames = topPrompts.slice(0, 2)
          .map((p: any) => `"${p.growthmind_prompt_templates?.name ?? "Unknown"}" (${(p.avg_score ?? 0).toFixed(1)}/10)`)
          .join(", ");
        const bestHint = bestNames ? ` Best performers: ${bestNames}.` : "";

        proposed.push({
          workspace_id:   workspaceId,
          title:          `Critically low-scoring prompt templates need urgent revision in Prompt Studio`,
          description:    `${poorPrompts.length} prompt template${poorPrompts.length !== 1 ? "s are" : " is"} scoring below 3/10 — critically failing outputs that will actively hurt content quality and campaign performance. Worst performers: ${worstNames}.${bestHint} Use best-performing templates as reference when rewriting.`,
          action_type:    "create_task",
          action_payload: {
            title:       "Revise critically failing prompt templates in GrowthMind → Prompt Studio",
            description: `Templates scoring below 3/10: ${worstNames}. Open GrowthMind → Prompt Studio, select each failing template, study the best-performers${bestNames ? ` (${bestNames})` : ""} for reference, rewrite the system and user prompts, then re-run the scorer until scores exceed 7/10.`,
            priority:    "high",
            trigger_type:"prompt_performance",
          },
          proposed_by: "hivemind",
          status:      "pending",
        });
      }
    } catch { /* graceful — prompt studio tables may not exist yet */ }

    // ── Strategy Centre: pending approval ─────────────────────────────────────
    try {
      const { data: pendingStrategies } = await sb
        .from("growthmind_strategy_centre")
        .select("id, strategy_type, selected_service, confidence_score, created_at")
        .eq("workspace_id", workspaceId)
        .eq("status", "proposed_to_hivemind")
        .order("created_at", { ascending: false })
        .limit(5)
        .catch(() => ({ data: [] }));

      for (const strat of (pendingStrategies ?? [])) {
        const typeLabel = (strat.strategy_type as string).replace(/_/g, "-");
        const service   = strat.selected_service ? ` — promoting "${strat.selected_service}"` : "";
        const confidence = Math.round((strat.confidence_score ?? 0) * 100);

        const existsCheck = await sb
          .from("hivemind_actions")
          .select("id")
          .eq("workspace_id", workspaceId)
          .eq("status", "pending")
          .eq("action_type", "review_strategy")
          .contains("action_payload", { strategy_id: strat.id })
          .maybeSingle()
          .catch(() => ({ data: null }));

        if (!existsCheck.data) {
          proposed.push({
            workspace_id:   workspaceId,
            title:          `GrowthMind Strategy Awaiting Approval: ${typeLabel}${service}`,
            description:    `GrowthMind has prepared a ${typeLabel} strategy${service} with ${confidence}% confidence. Review the complete campaign plan, service selection rationale, channel recommendations, and approval actions in GrowthMind → Strategy Centre. Approve to create tasks and launch, or reject with a reason.`,
            action_type:    "review_strategy",
            action_payload: { strategy_id: strat.id, strategy_type: strat.strategy_type },
            proposed_by:    "growthmind",
            status:         "pending",
          });
        }
      }
    } catch { /* graceful — strategy centre tables may not exist yet */ }

    if (proposed.length > 0) {
      await sb.from("hivemind_actions").insert(proposed);
    }

    return { proposed: proposed.length };
  });
