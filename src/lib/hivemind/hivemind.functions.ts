import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type HiveMindTask = {
  id: string;
  title: string;
  category: string;
  status: "suggested" | "approved" | "completed";
  createdAt: string;
  completedAt?: string;
};

export const getHiveMindPlatformData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const since30 = new Date();
    since30.setDate(since30.getDate() - 30);
    const since7 = new Date();
    since7.setDate(since7.getDate() - 7);
    const since14 = new Date();
    since14.setDate(since14.getDate() - 14);

    const [agentsRes, callsRes, leadsRes, bookingsRes, settingsRes, campaignsRes] =
      await Promise.all([
        sb
          .from("agents")
          .select("id, name, retell_agent_id, inbound_phone_number, settings, created_at, updated_at")
          .eq("workspace_id", workspaceId),
        sb
          .from("calls")
          .select(
            "id, agent_id, agent_name, call_status, call_successful, duration_seconds, sentiment, started_at, call_type",
          )
          .eq("workspace_id", workspaceId)
          .gte("started_at", since30.toISOString())
          .order("started_at", { ascending: false })
          .limit(500),
        sb
          .from("leads")
          .select("id, status, pipeline_stage, updated_at, created_at, full_name, name")
          .eq("workspace_id", workspaceId)
          .limit(2000),
        sb
          .from("calendar_bookings")
          .select("id, agent_id, status, created_at")
          .eq("workspace_id", workspaceId)
          .limit(200),
        sb
          .from("workspace_settings")
          .select(
            "calcom_api_key, retell_default_agent_id, retell_workspace_id, elevenlabs_api_key, openai_api_key, hivemind_retell_agent_id, hivemind_tasks, whatsapp_phone_id, twilio_auth_token",
          )
          .eq("workspace_id", workspaceId)
          .maybeSingle(),
        sb
          .from("call_campaigns")
          .select("id, name, status, total_leads, completed_calls, created_at")
          .eq("workspace_id", workspaceId)
          .limit(50),
      ]);

    const agents: any[] = agentsRes.data ?? [];
    const calls: any[] = callsRes.data ?? [];
    const leads: any[] = leadsRes.data ?? [];
    const bookings: any[] = bookingsRes.data ?? [];
    const settings: any = settingsRes.data ?? {};
    const campaigns: any[] = campaignsRes.data ?? [];

    const since14Str = since14.toISOString();
    const since7Str = since7.toISOString();

    const callsPerAgent = new Map<string, typeof calls>();
    for (const c of calls) {
      if (!c.agent_id) continue;
      if (!callsPerAgent.has(c.agent_id)) callsPerAgent.set(c.agent_id, []);
      callsPerAgent.get(c.agent_id)!.push(c);
    }

    const agentScores = agents.map((a) => {
      const s = (a.settings ?? {}) as Record<string, unknown>;
      const agentCalls = callsPerAgent.get(a.id) ?? [];
      const successCalls = agentCalls.filter((c) => c.call_successful === true).length;
      const successRate = agentCalls.length > 0 ? successCalls / agentCalls.length : 0;

      let score = 0;
      const breakdown: string[] = [];

      if (s.deployedRetellAgentId || a.retell_agent_id) { score += 25; breakdown.push("Deployed +25"); }
      if (s.phoneNumber || a.inbound_phone_number) { score += 15; breakdown.push("Phone assigned +15"); }
      if (agentCalls.length > 0) { score += 20; breakdown.push("Has call activity +20"); }
      if (successRate >= 0.5) { score += 20; breakdown.push("Good success rate +20"); }
      if ((s.prompt as string | undefined)?.length ?? 0 > 100) { score += 10; breakdown.push("Has prompt +10"); }
      if (s.booking || settings.calcom_api_key) { score += 10; breakdown.push("Calendar connected +10"); }

      return {
        id: a.id,
        name: a.name,
        score,
        breakdown,
        callCount: agentCalls.length,
        successRate: Math.round(successRate * 100),
        deployed: !!(s.deployedRetellAgentId || a.retell_agent_id),
        hasPhone: !!(s.phoneNumber || a.inbound_phone_number),
        deploymentMode: (s.deploymentMode as string) ?? "retell",
      };
    });

    const staleLeads = leads.filter(
      (l) =>
        l.status !== "sale_done" &&
        l.status !== "do_not_call" &&
        l.status !== "not_interested" &&
        l.updated_at < since14Str,
    ).length;

    const needCallLeads = leads.filter((l) => l.status === "need_to_call").length;
    const doNotCallLeads = leads.filter((l) => l.status === "do_not_call" || l.status === "not_interested").length;
    const saleLeads = leads.filter((l) => l.status === "sale_done").length;

    const totalCalls = calls.length;
    const successCalls = calls.filter((c) => c.call_successful === true).length;
    const overallSuccessRate = totalCalls > 0 ? Math.round((successCalls / totalCalls) * 100) : 0;
    const avgDuration =
      calls.filter((c) => c.duration_seconds).length > 0
        ? Math.round(
            calls.filter((c) => c.duration_seconds).reduce((s, c) => s + c.duration_seconds, 0) /
              calls.filter((c) => c.duration_seconds).length,
          )
        : 0;

    const activeCampaigns = campaigns.filter((c) => c.status === "running" || c.status === "active").length;

    const recentBookings = bookings.filter((b) => b.created_at >= since7Str).length;
    const agentBookings = bookings.filter((b) => b.agent_id).length;

    const systemHealth = {
      retell: !!(settings.retell_workspace_id || settings.retell_default_agent_id),
      calcom: !!settings.calcom_api_key,
      twilio: !!settings.twilio_auth_token,
      whatsapp: !!settings.whatsapp_phone_id,
      elevenlabs: !!settings.elevenlabs_api_key,
      openai: !!settings.openai_api_key,
      agents: agents.length > 0,
      campaigns: campaigns.length > 0,
    };

    const tasks: HiveMindTask[] = (() => {
      try {
        return (settings.hivemind_tasks as HiveMindTask[] | null) ?? [];
      } catch {
        return [];
      }
    })();

    return {
      agents,
      agentScores,
      calls: { total: totalCalls, success: successCalls, successRate: overallSuccessRate, avgDuration },
      leads: { total: leads.length, needCall: needCallLeads, stale: staleLeads, doNotCall: doNotCallLeads, sales: saleLeads },
      bookings: { total: bookings.length, recent: recentBookings, agentBooked: agentBookings },
      campaigns: { total: campaigns.length, active: activeCampaigns },
      systemHealth,
      settings,
      tasks,
    };
  });

export const saveHiveMindTasks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { tasks: HiveMindTask[] }) => input)
  .handler(async ({ context, data }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    try {
      const { error } = await sb
        .from("workspace_settings")
        .upsert({ workspace_id: workspaceId, hivemind_tasks: data.tasks }, { onConflict: "workspace_id" });
      if (error) {
        if (String(error.code) === "42703" || String(error.message).includes("hivemind_tasks")) {
          return { ok: true, columnMissing: true };
        }
        throw new Error(error.message);
      }
      return { ok: true, columnMissing: false };
    } catch (e: any) {
      if (String(e.message).includes("hivemind_tasks") || String(e.code) === "42703") {
        return { ok: true, columnMissing: true };
      }
      throw e;
    }
  });

export const getHiveMindAgentId = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const workspaceId = context.workspaceId;
    if (!workspaceId) return { agentId: null, columnMissing: false };
    try {
      const { data, error } = await supabaseAdmin
        .from("workspace_settings" as never)
        .select("hivemind_retell_agent_id")
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (error) {
        if (String((error as any).code) === "42703" || String((error as any).message).includes("hivemind_retell_agent_id")) {
          return { agentId: null, columnMissing: true };
        }
        return { agentId: null, columnMissing: false };
      }
      return { agentId: (data as any)?.hivemind_retell_agent_id ?? null, columnMissing: false };
    } catch {
      return { agentId: null, columnMissing: false };
    }
  });

export const saveHiveMindAgentId = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ agentId: z.string().nullable() }).parse(input))
  .handler(async ({ context, data }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    try {
      const { error } = await sb
        .from("workspace_settings")
        .upsert({ workspace_id: workspaceId, hivemind_retell_agent_id: data.agentId || null }, { onConflict: "workspace_id" });
      if (error) {
        if (String(error.code) === "42703" || String(error.message).includes("hivemind_retell_agent_id")) {
          return { ok: true, columnMissing: true };
        }
        throw new Error(error.message);
      }
      return { ok: true, columnMissing: false };
    } catch (e: any) {
      if (String(e.message).includes("hivemind_retell_agent_id")) return { ok: true, columnMissing: true };
      throw e;
    }
  });
