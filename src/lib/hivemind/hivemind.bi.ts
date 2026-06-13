import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ── Types ────────────────────────────────────────────────────────────────────
export interface BIPeriod {
  leads:    number;
  bookings: number;
  sales:    number;
  calls:    number;
}

export interface BiRecommendation {
  title:          string;
  description:    string;
  priority:       "low" | "medium" | "high";
  action_type?:   string;
  action_payload?: Record<string, unknown>;
}

export interface BiRisk {
  type:        string;
  title:       string;
  description: string;
  severity:    "info" | "warning" | "critical";
}

export interface ExecutiveBriefing {
  greeting:        string;
  month:           BIPeriod;
  prevMonth:       BIPeriod;
  week:            BIPeriod;
  today:           BIPeriod;
  leadVelocity:    { thisMonth: number; lastMonth: number; trend: "up" | "down" | "flat"; pct: number };
  conversionRate:  number;
  costs:           { totalMinutes: number; totalDollars: number; costPerLead: number; costPerBooking: number };
  topAgent:        { name: string; callCount: number; successRate: number } | null;
  topCampaign:     { name: string; completionPct: number; leads: number } | null;
  agentRankings:   { name: string; callCount: number; successRate: number; deployed: boolean }[];
  pipelineHealth:  { stage: string; label: string; count: number }[];
  followUpGaps:    number;
  risks:           BiRisk[];
  recommendations: BiRecommendation[];
}

const PIPELINE_LABELS: Record<string, string> = {
  need_to_call:      "Need to Call",
  calling:           "Calling",
  interested:        "Interested",
  qualified:         "Qualified",
  contact_made:      "Contact Made",
  sale_done:         "Sale Done",
  completed:         "Completed",
  not_interested:    "Not Interested",
  do_not_call:       "Do Not Call",
  not_connected:     "Not Connected",
};

// ── getExecutiveBriefing ──────────────────────────────────────────────────────
export const getExecutiveBriefing = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const now         = new Date();
    const hour        = now.getHours();
    const greeting    = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

    // Date boundaries
    const todayStart  = new Date(now); todayStart.setHours(0,0,0,0);
    const weekStart   = new Date(now); weekStart.setDate(now.getDate() - 7);
    const monthStart  = new Date(now.getFullYear(), now.getMonth(), 1);
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonthEnd   = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
    const s30         = new Date(now); s30.setDate(now.getDate() - 30);
    const s60         = new Date(now); s60.setDate(now.getDate() - 60);
    const s14         = new Date(now); s14.setDate(now.getDate() - 14);
    const s2          = new Date(now); s2.setDate(now.getDate() - 2);

    const [agRes, callRes, leadRes, bkRes, campRes, hexRes, enrollRes, usageRes, settingsRes] = await Promise.all([
      sb.from("agents").select("id,name,retell_agent_id,settings").eq("workspace_id", workspaceId),
      sb.from("calls").select("id,agent_id,call_successful,duration_seconds,call_type,started_at").eq("workspace_id", workspaceId).gte("started_at", s60.toISOString()).limit(2000),
      sb.from("leads").select("id,status,pipeline_stage,sale_amount,created_at,updated_at").eq("workspace_id", workspaceId).limit(5000),
      sb.from("calendar_bookings").select("id,status,created_at").eq("workspace_id", workspaceId).gte("created_at", s60.toISOString()).limit(1000),
      sb.from("call_campaigns").select("id,name,status,total_leads,completed_calls,created_at").eq("workspace_id", workspaceId).limit(100),
      sb.from("hexmail_campaigns").select("id,name,status").eq("workspace_id", workspaceId).limit(50),
      sb.from("hexmail_campaign_enrollments").select("lead_id,status").eq("workspace_id", workspaceId).eq("status","active").limit(5000),
      sb.from("usage_events").select("minutes,cost_cents,occurred_at").eq("workspace_id", workspaceId).gte("occurred_at", s30.toISOString()).limit(5000),
      sb.from("workspace_settings").select("hivemind_mode,whatsapp_phone_id,elevenlabs_api_key,openai_api_key,retell_workspace_id,calcom_api_key").eq("workspace_id", workspaceId).maybeSingle(),
    ]);

    const agents   = agRes.data    ?? [];
    const calls    = callRes.data  ?? [];
    const leads    = leadRes.data  ?? [];
    const bks      = bkRes.data    ?? [];
    const camps    = campRes.data  ?? [];
    const hexCamps = hexRes.data   ?? [];
    const enrolled = new Set((enrollRes.data ?? []).map((e: any) => e.lead_id));
    const usage    = usageRes.data ?? [];
    const cfg      = settingsRes.data ?? {};

    // ── Period helper ─────────────────────────────────────────────────────────
    function periodStats(from: Date, to?: Date): BIPeriod {
      const fromStr = from.toISOString();
      const toStr   = to?.toISOString();
      const inRange = (d: string) => d >= fromStr && (!toStr || d <= toStr);
      const saleStatuses = ["sale_done","completed"];
      return {
        leads:    leads.filter((l: any) => l.created_at >= fromStr && (!toStr || l.created_at <= toStr)).length,
        bookings: bks.filter((b: any) => b.created_at >= fromStr && (!toStr || b.created_at <= toStr)).length,
        sales:    leads.filter((l: any) => saleStatuses.includes(l.status) && l.updated_at >= fromStr && (!toStr || l.updated_at <= toStr)).length,
        calls:    calls.filter((c: any) => inRange(c.started_at)).length,
      };
    }

    const month     = periodStats(monthStart);
    const prevMonth = periodStats(prevMonthStart, prevMonthEnd);
    const week      = periodStats(weekStart);
    const today     = periodStats(todayStart);

    // ── Lead velocity ─────────────────────────────────────────────────────────
    const velocityPct = prevMonth.leads > 0
      ? Math.round(((month.leads - prevMonth.leads) / prevMonth.leads) * 100)
      : 0;
    const leadVelocity = {
      thisMonth: month.leads,
      lastMonth: prevMonth.leads,
      trend:     (month.leads > prevMonth.leads ? "up" : month.leads < prevMonth.leads ? "down" : "flat") as "up" | "down" | "flat",
      pct:       Math.abs(velocityPct),
    };

    // ── Conversion rate ───────────────────────────────────────────────────────
    const activeSales = leads.filter((l: any) => ["sale_done","completed"].includes(l.status)).length;
    const conversionRate = leads.length > 0 ? Math.round((activeSales / leads.length) * 100 * 10) / 10 : 0;

    // ── Costs ─────────────────────────────────────────────────────────────────
    const totalMinutes = usage.reduce((s: number, u: any) => s + (Number(u.minutes) || 0), 0);
    const totalCents   = usage.reduce((s: number, u: any) => s + (Number(u.cost_cents) || 0), 0);
    const totalDollars = Math.round(totalCents / 100 * 100) / 100;
    const costPerLead  = month.leads > 0 ? Math.round((totalDollars / month.leads) * 100) / 100 : 0;
    const costPerBooking = month.bookings > 0 ? Math.round((totalDollars / month.bookings) * 100) / 100 : 0;

    // ── Agent rankings ────────────────────────────────────────────────────────
    const agentRankings = agents.map((a: any) => {
      const s        = a.settings ?? {};
      const deployed = !!(s.deployedRetellAgentId || a.retell_agent_id);
      const ac       = calls.filter((c: any) => c.agent_id === a.id);
      const succ     = ac.filter((c: any) => c.call_successful).length;
      return { name: a.name, callCount: ac.length, successRate: ac.length ? Math.round((succ / ac.length) * 100) : 0, deployed };
    }).sort((a: any, b: any) => b.callCount - a.callCount);

    const topAgent = agentRankings.length > 0 ? agentRankings[0] : null;

    // ── Top campaign ──────────────────────────────────────────────────────────
    const campStats = camps.map((c: any) => ({
      name:          c.name,
      completionPct: c.total_leads > 0 ? Math.round((c.completed_calls / c.total_leads) * 100) : 0,
      leads:         c.total_leads ?? 0,
      status:        c.status,
    })).sort((a: any, b: any) => b.completionPct - a.completionPct);
    const topCampaign = campStats.length > 0 ? campStats[0] : null;

    // ── Pipeline health ───────────────────────────────────────────────────────
    const stageCounts: Record<string, number> = {};
    for (const l of leads) {
      const stage = l.status ?? "unknown";
      stageCounts[stage] = (stageCounts[stage] ?? 0) + 1;
    }
    const pipelineHealth = Object.entries(stageCounts)
      .map(([stage, count]) => ({ stage, label: PIPELINE_LABELS[stage] ?? stage, count: count as number }))
      .sort((a, b) => b.count - a.count);

    // ── Follow-up gaps ────────────────────────────────────────────────────────
    const activeStatuses = ["need_to_call","calling","interested","qualified","contact_made"];
    const activeLeads    = leads.filter((l: any) => activeStatuses.includes(l.status));
    const followUpGaps   = activeLeads.filter((l: any) => !enrolled.has(l.id)).length;

    // ── Risks ─────────────────────────────────────────────────────────────────
    const risks: BiRisk[] = [];

    const idleLeads = leads.filter(
      (l: any) => activeStatuses.includes(l.status) && new Date(l.updated_at) < s14
    );
    if (idleLeads.length > 0) {
      risks.push({
        type: "idle_leads", severity: idleLeads.length > 20 ? "warning" : "info",
        title: `${idleLeads.length} leads idle 14+ days`,
        description: `${idleLeads.length} active leads have had no activity in over 2 weeks. They risk going cold.`,
      });
    }

    const stalledCamps = camps.filter((c: any) =>
      ["active","running"].includes(c.status ?? "") &&
      new Date(c.created_at) < s2 &&
      (c.total_leads ?? 0) > 0 && (c.completed_calls ?? 0) === 0
    );
    if (stalledCamps.length > 0) {
      risks.push({
        type: "stalled_campaigns", severity: "warning",
        title: `${stalledCamps.length} campaign${stalledCamps.length !== 1 ? "s" : ""} stalled`,
        description: `${stalledCamps.slice(0,2).map((c: any) => `"${c.name}"`).join(", ")} ${stalledCamps.length > 1 ? "are" : "is"} active but 0 calls completed.`,
      });
    }

    const undeployed = agents.filter((a: any) => !(a.settings?.deployedRetellAgentId || a.retell_agent_id));
    if (undeployed.length > 0) {
      risks.push({
        type: "undeployed_agents", severity: "warning",
        title: `${undeployed.length} agent${undeployed.length !== 1 ? "s" : ""} not deployed`,
        description: `${undeployed.slice(0,2).map((a: any) => `"${a.name}"`).join(", ")} ${undeployed.length > 1 ? "are" : "is"} not live yet.`,
      });
    }

    if (followUpGaps > 20) {
      risks.push({
        type: "no_followup", severity: "info",
        title: `${followUpGaps} leads have no follow-up sequence`,
        description: `${followUpGaps} active leads are not enrolled in any email follow-up campaign. You may be losing conversion opportunities.`,
      });
    }

    if (!cfg.whatsapp_phone_id) {
      risks.push({
        type: "whatsapp_offline", severity: "info",
        title: "WhatsApp not connected",
        description: "Connect a WhatsApp number to enable two-way messaging with leads.",
      });
    }

    // ── Recommendations ───────────────────────────────────────────────────────
    const recommendations: BiRecommendation[] = [];

    if (idleLeads.length > 5) {
      const unenrolled = idleLeads.filter((l: any) => !enrolled.has(l.id));
      recommendations.push({
        title:       `Launch 30-day nurture for ${unenrolled.length} idle leads`,
        description: `${unenrolled.length} idle leads have no follow-up sequence. A structured nurture campaign can recover 15–25% of cold leads.`,
        priority:    "high",
        action_type: "create_followup_campaign",
        action_payload: {
          name:     "30-Day Lead Nurture",
          lead_ids: unenrolled.slice(0,500).map((l: any) => l.id),
        },
      });
    }

    if (leadVelocity.trend === "up" && leadVelocity.pct > 20) {
      recommendations.push({
        title:       `Lead volume up ${leadVelocity.pct}% — consider automating intake`,
        description: `You received ${month.leads} leads this month vs ${prevMonth.leads} last month. Automating initial outreach will prevent leads from going cold.`,
        priority:    "medium",
      });
    }

    if (conversionRate < 5 && month.leads > 20) {
      recommendations.push({
        title:       `Conversion rate is ${conversionRate}% — review sales process`,
        description: `Your lead-to-sale conversion rate is below the 5–10% benchmark. Consider A/B testing your agent scripts or follow-up sequences.`,
        priority:    "high",
      });
    }

    if (stalledCamps.length > 0) {
      recommendations.push({
        title:       `Review ${stalledCamps.length} stalled campaign${stalledCamps.length !== 1 ? "s" : ""}`,
        description: `${stalledCamps.map((c: any) => `"${c.name}"`).join(", ")} ${stalledCamps.length > 1 ? "have" : "has"} 0 calls completed. Check the schedule and agent configuration.`,
        priority:    "high",
      });
    }

    if (hexCamps.length === 0 && leads.length > 10) {
      recommendations.push({
        title:       "Set up your first follow-up email sequence",
        description: `You have ${leads.length} leads but no email follow-up campaigns. A 3-touch sequence can increase conversions by 30%+.`,
        priority:    "medium",
        action_type: "create_followup_campaign",
        action_payload: { name: "New Lead Welcome Sequence", config: {} },
      });
    }

    if (totalDollars > 0 && costPerLead > 50) {
      recommendations.push({
        title:       `Cost per lead is $${costPerLead} — optimise outreach`,
        description: `Your current cost per lead is above the $50 benchmark. Consider refining your target list or improving agent call scripts to reduce costs.`,
        priority:    "medium",
      });
    }

    return {
      greeting, month, prevMonth, week, today,
      leadVelocity, conversionRate, costs: { totalMinutes: Math.round(totalMinutes), totalDollars, costPerLead, costPerBooking },
      topAgent, topCampaign, agentRankings, pipelineHealth, followUpGaps,
      risks, recommendations,
    } as ExecutiveBriefing;
  });
