/**
 * Shared "auto-call a new lead" pipeline.
 *
 * Mirrors the auto-email-on-new-lead pattern (see
 * src/lib/lead-gen/lead-email.server.ts): a core function callable directly
 * from server code with a raw supabase client, no auth-middleware
 * dependency, always best-effort and never throws — so it's safe to call
 * from any lead-creation path (manual add, webforms, Developer API) without
 * risking the parent operation.
 *
 * Reuses the same call-placing logic as the manual "Qualify Leads" flow
 * (startQualificationCallsForLeads in src/lib/dashboard/leads.functions.ts):
 * resolve the configured agent, resolve the workspace's own Retell key
 * (falls back to the shared platform key), enforce the existing
 * 3-calls-per-phone-per-UTC-day cap, place the call via
 * POST /v2/create-phone-call, then record it in `calls` and update the
 * lead's status.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { retellFetch } from "@/lib/providers/retell/client.server";

export interface AutoCallResult {
  placed: boolean;
  reason?: string;
  callId?: string;
}

/**
 * Attempts to place an outbound qualification call for a brand-new lead, IF
 * the workspace has lead auto-call enabled with a fully-configured agent.
 * Never throws.
 */
export async function triggerAutoCallForNewLead(
  sb: any,
  params: { workspaceId: string; leadId: string },
): Promise<AutoCallResult> {
  const { workspaceId, leadId } = params;
  try {
    const { data: wsSettings } = await sb
      .from("workspace_settings")
      .select("lead_auto_call_enabled, lead_auto_call_agent_id, retell_workspace_id")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (!wsSettings?.lead_auto_call_enabled || !wsSettings?.lead_auto_call_agent_id) {
      return { placed: false, reason: "auto_call_disabled" };
    }

    const { data: lead } = await sb
      .from("leads")
      .select(
        "id, phone, full_name, email, company_name, call_summary, next_action, interest_level, notes, source, meta",
      )
      .eq("id", leadId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (!lead?.phone?.trim()) {
      return { placed: false, reason: "no_phone" };
    }

    const { data: agent } = await sb
      .from("agents")
      .select("id, retell_agent_id, name, settings")
      .eq("id", wsSettings.lead_auto_call_agent_id)
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (!agent) return { placed: false, reason: "agent_not_found" };

    const agentSettings = (agent.settings ?? {}) as Record<string, unknown>;
    const qualifySettings = (agentSettings.qualify as Record<string, unknown> | undefined) ?? {};
    const preCallMappings = (qualifySettings.preCallMappings as Record<string, string> | undefined) ?? {};
    const deployedRetellAgentId = (agentSettings.deployedRetellAgentId as string | undefined) ?? null;
    const retellAgentId = deployedRetellAgentId ?? agent.retell_agent_id ?? null;
    const fromNumber = (agentSettings.phoneNumber as string | undefined) ?? null;

    if (!retellAgentId || !fromNumber) {
      return { placed: false, reason: "agent_not_fully_configured" };
    }

    // The workspace's own Retell key always takes priority when present —
    // the agent belongs to their Retell workspace regardless of internal
    // deployment flags. No signed-in user in this context, so there's no
    // per-agent secret fallback (that only applies to the dashboard UI
    // flows); falling back to `undefined` here uses the shared platform key.
    const clientRetellKey = (wsSettings as any)?.retell_workspace_id?.trim() || undefined;

    // Daily call limit — max 3 attempts per phone number per UTC day. Same
    // guardrail as manual/scheduled calling, prevents automation from
    // hammering a number if duplicate leads or retried webhooks occur.
    const todayUtc = new Date();
    todayUtc.setUTCHours(0, 0, 0, 0);
    const { count: attemptsToday } = await sb
      .from("calls")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("to_number", lead.phone)
      .gte("created_at", todayUtc.toISOString());
    if ((attemptsToday ?? 0) >= 3) {
      return { placed: false, reason: "daily_limit_reached" };
    }

    const dynamicVars: Record<string, string> = { full_name: lead.full_name ?? "" };
    for (const [placeholder, leadField] of Object.entries(preCallMappings)) {
      const val = (lead as Record<string, unknown>)[leadField];
      if (val != null && val !== "") dynamicVars[placeholder] = String(val);
    }

    const callPayload = {
      from_number: fromNumber,
      to_number: lead.phone,
      override_agent_id: retellAgentId,
      metadata: { lead_id: lead.id, workspace_id: workspaceId, trigger: "auto_new_lead" },
      retell_llm_dynamic_variables: dynamicVars,
    };

    const call = await retellFetch<any>("/v2/create-phone-call", callPayload, "POST", clientRetellKey);

    const now = new Date().toISOString();
    await sb.from("leads").update({ status: "calling", updated_at: now }).eq("id", lead.id);
    await sb.from("calls").insert({
      workspace_id: workspaceId,
      retell_call_id: call?.call_id ?? null,
      agent_id: retellAgentId,
      agent_name: agent.name ?? null,
      from_number: fromNumber,
      to_number: lead.phone,
      call_type: "outbound",
      call_status: "initiated",
      lead_id: lead.id,
    });

    return { placed: true, callId: call?.call_id };
  } catch (e) {
    console.error("[AUTO-CALL] trigger failed:", e instanceof Error ? e.message : e);
    return { placed: false, reason: "error" };
  }
}

export const getLeadAutoCallSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const sb = supabase as any;
    const { data } = await sb
      .from("workspace_settings")
      .select("lead_auto_call_enabled, lead_auto_call_agent_id")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    return {
      enabled: !!data?.lead_auto_call_enabled,
      agentId: (data?.lead_auto_call_agent_id as string | null) ?? null,
    };
  });

export const saveLeadAutoCallSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        enabled: z.boolean(),
        agentId: z.string().uuid().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const sb = supabase as any;
    const { error } = await sb.from("workspace_settings").upsert(
      {
        workspace_id: workspaceId,
        lead_auto_call_enabled: data.enabled,
        lead_auto_call_agent_id: data.agentId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });
