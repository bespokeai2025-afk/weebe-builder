import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function retellFetch<T>(
  path: string,
  body: Record<string, unknown>,
  apiKey?: string,
): Promise<T> {
  const key = apiKey ?? process.env.RETELL_API_KEY ?? "";
  const res = await fetch(`https://api.retellai.com${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Retell ${path} → ${res.status}: ${txt}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Returns the standard lead fields + any custom meta keys detected from
 * this workspace's existing lead records. Used by the qualification builder
 * to populate the Pre-Call Data Injection mapping dropdowns.
 */
export const getLeadCustomFields = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) return { standardFields: [], metaFields: [] };
    const sb = supabase as any;

    const STANDARD: Array<{ value: string; label: string }> = [
      { value: "full_name", label: "Full Name" },
      { value: "phone", label: "Phone" },
      { value: "email", label: "Email" },
      { value: "company_name", label: "Company Name" },
      { value: "call_summary", label: "Last Call Summary" },
      { value: "next_action", label: "Last Next Action" },
      { value: "interest_level", label: "Interest Level" },
      { value: "notes", label: "Notes" },
      { value: "source", label: "Lead Source" },
      { value: "urgency", label: "Urgency" },
      { value: "next_step", label: "Next Step" },
      { value: "buying_intent", label: "Buying Intent" },
    ];

    // Aggregate distinct meta keys from existing leads
    const { data: leads } = await sb
      .from("leads")
      .select("meta")
      .eq("workspace_id", workspaceId)
      .not("meta", "eq", "{}")
      .limit(200);

    const metaKeys = new Set<string>();
    for (const lead of leads ?? []) {
      if (lead.meta && typeof lead.meta === "object") {
        for (const key of Object.keys(lead.meta)) {
          metaKeys.add(key);
        }
      }
    }

    const metaFields = Array.from(metaKeys).map((key) => ({
      value: `meta.${key}`,
      label: key,
    }));

    return { standardFields: STANDARD, metaFields };
  });

export const getOverviewStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");

    const [leadsRes, callsRes, bookingsRes, qualifiedRes] = await Promise.all([
      (supabase as any)
        .from("leads" as never)
        .select("id, status, created_at", { count: "exact", head: false })
        .eq("workspace_id", workspaceId),
      (supabase as any)
        .from("calls" as never)
        .select("id, call_status, duration_seconds, started_at")
        .eq("workspace_id", workspaceId),
      (supabase as any)
        .from("calendar_bookings" as never)
        .select("id, status, start_at")
        .eq("workspace_id", workspaceId),
      (supabase as any)
        .from("leads" as never)
        .select("id")
        .eq("workspace_id", workspaceId)
        .in("status", ["interested", "qualified"]),
    ]);

    if (leadsRes.error) throw new Error(leadsRes.error.message);
    if (callsRes.error) throw new Error(callsRes.error.message);
    if (bookingsRes.error) throw new Error(bookingsRes.error.message);

    const leads = leadsRes.data ?? [];
    const calls = callsRes.data ?? [];
    const bookings = bookingsRes.data ?? [];
    const now = Date.now();

    return {
      workspaceId,
      totals: {
        leads: leads.length,
        qualified: (qualifiedRes.data ?? []).length,
        calls: calls.length,
        callsCompleted: calls.filter((c: any) => c.call_status === "completed").length,
        callsFailed: calls.filter((c: any) =>
          ["failed", "no_answer", "busy"].includes(c.call_status),
        ).length,
        totalCallSeconds: calls.reduce((acc: number, c: any) => acc + (c.duration_seconds ?? 0), 0),
        bookings: bookings.length,
        upcomingBookings: bookings.filter(
          (b: any) => new Date(b.start_at).getTime() > now && b.status !== "cancelled",
        ).length,
        pendingBookings: bookings.filter((b: any) => b.status === "pending").length,
        cancelledBookings: bookings.filter((b: any) => b.status === "cancelled").length,
      },
      recentLeads: leads.slice(-5).reverse(),
    };
  });

export const listLeads = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        status: z.string().optional(),
        qualifiedOnly: z.boolean().optional(),
        search: z.string().optional(),
        limit: z.number().int().min(1).max(500).default(100),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    let q = supabase
      .from("leads" as never)
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .limit(data.limit);
    if (data.qualifiedOnly) q = q.in("status", ["interested", "qualified"]);
    if (data.status && data.status !== "all") q = q.eq("status", data.status as any);
    if (data.search)
      q = q.or(
        `full_name.ilike.%${data.search}%,phone.ilike.%${data.search}%,email.ilike.%${data.search}%`,
      );
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const upsertLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid().optional(),
        full_name: z.string().nullable().optional(),
        phone: z.string().min(3).max(40),
        email: z.string().email().nullable().optional().or(z.literal("")),
        company_name: z.string().nullable().optional(),
        status: z.string().optional(),
        source: z.string().optional(),
        funding_amount: z.number().nullable().optional(),
        notes: z.string().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const payload: any = {
      workspace_id: workspaceId,
      full_name: data.full_name ?? null,
      phone: data.phone,
      email: data.email || null,
      company_name: data.company_name ?? null,
      funding_amount: data.funding_amount ?? null,
      notes: data.notes ?? null,
      ...(data.status ? { status: data.status } : {}),
      ...(data.source ? { source: data.source } : {}),
    };
    if (data.id) {
      const { error } = await (supabase as any)
        .from("leads" as never)
        .update(payload)
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: row, error } = await (supabase as any)
      .from("leads" as never)
      .insert(payload)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row!.id as string };
  });

export const setLeadStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum([
          "need_to_call",
          "callback_requested",
          "interested",
          "not_interested",
          "qualified",
          "completed",
          "do_not_call",
          "no_answer",
          "scheduled",
        ]),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const { error } = await (supabase as any)
      .from("leads" as never)
      .update({ status: data.status, updated_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("workspace_id", workspaceId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const { error } = await (supabase as any)
      .from("leads" as never)
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const startQualificationCallsForLeads = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        leadIds: z.array(z.string().uuid()).min(1).max(200),
        agentId: z.string().uuid(),
        fromNumber: z.string().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId, userId } = context as any;
    if (!workspaceId) throw new Error("No active workspace");
    const sb = supabase as any;

    // Load the selected leads — select all fields that could be used in pre-call mapping
    const { data: leads, error: leadsErr } = await sb
      .from("leads")
      .select("id, phone, full_name, email, company_name, call_summary, next_action, interest_level, notes, source, meta")
      .eq("workspace_id", workspaceId)
      .in("id", data.leadIds);
    if (leadsErr) throw new Error(leadsErr.message);

    // Load the qualification agent
    const { data: agent, error: agentErr } = await sb
      .from("agents")
      .select("id, retell_agent_id, name, settings")
      .eq("id", data.agentId)
      .maybeSingle();
    if (agentErr) throw new Error(agentErr.message);
    if (!agent) throw new Error("Agent not found");

    const agentSettings = (agent.settings ?? {}) as Record<string, unknown>;
    const qualifySettings = (agentSettings.qualify as Record<string, unknown> | undefined) ?? {};
    const preCallMappings = (qualifySettings.preCallMappings as Record<string, string> | undefined) ?? {};
    const deployedRetellAgentId = (agentSettings.deployedRetellAgentId as string | undefined) ?? null;
    const retellAgentId = deployedRetellAgentId ?? agent.retell_agent_id ?? null;

    // Resolve Retell API key
    const { data: wsSettings } = await sb
      .from("workspace_settings")
      .select("retell_workspace_id")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    const clientRetellKey = (wsSettings as any)?.retell_workspace_id?.trim() || undefined;

    let agentApiKey: string | undefined;
    if (deployedRetellAgentId && userId) {
      const { data: secret } = await (supabaseAdmin as any)
        .from("agent_retell_secrets")
        .select("production_api_key")
        .eq("agent_id", data.agentId)
        .eq("user_id", userId)
        .maybeSingle();
      const k = secret?.production_api_key?.trim();
      if (k?.startsWith("key_")) agentApiKey = k;
    }
    const resolvedKey = deployedRetellAgentId ? (clientRetellKey || agentApiKey) : undefined;

    const fromNumber = data.fromNumber?.trim() || (agentSettings.phoneNumber as string | undefined) || null;

    let placed = 0;
    let queued = 0;
    let failed = 0;
    const errors: { leadId: string; message: string }[] = [];
    const now = new Date().toISOString();

    // Start of today (UTC) for daily limit checks
    const todayUtc = new Date();
    todayUtc.setUTCHours(0, 0, 0, 0);
    const todayStart = todayUtc.toISOString();

    let limitReached = 0;

    for (const lead of leads ?? []) {
      if (!lead.phone?.trim()) {
        failed += 1;
        errors.push({ leadId: lead.id, message: "No phone number" });
        continue;
      }

      // Daily call limit — max 3 attempts per lead per calendar day (UTC)
      const { count: attemptsToday } = await sb
        .from("calls")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .eq("to_number", lead.phone)
        .gte("created_at", todayStart);
      if ((attemptsToday ?? 0) >= 3) {
        limitReached += 1;
        errors.push({ leadId: lead.id, message: "Daily call limit reached (3/day)" });
        continue;
      }

      if (!retellAgentId || !fromNumber) {
        // Queue without placing — agent not fully configured
        await sb.from("leads").update({ status: "need_to_call", updated_at: now }).eq("id", lead.id);
        queued += 1;
        continue;
      }

      try {
        // Build dynamic variables from preCallMappings (placeholder → lead field)
        // Always include full_name as a baseline, then apply builder-configured mappings.
        const dynamicVars: Record<string, string> = {
          full_name: lead.full_name ?? "",
        };
        for (const [placeholder, leadField] of Object.entries(preCallMappings)) {
          const val = (lead as Record<string, unknown>)[leadField];
          if (val != null && val !== "") {
            dynamicVars[placeholder] = String(val);
          }
        }

        const callPayload: Record<string, unknown> = {
          from_number: fromNumber,
          to_number: lead.phone,
          override_agent_id: retellAgentId,
          metadata: { lead_id: lead.id, workspace_id: workspaceId },
          retell_llm_dynamic_variables: dynamicVars,
        };

        const call = await retellFetch<any>("/v2/create-phone-call", callPayload, resolvedKey);

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
        });
        placed += 1;
      } catch (e: any) {
        failed += 1;
        errors.push({ leadId: lead.id, message: e?.message ?? "Retell call failed" });
        await sb.from("leads").update({ status: "need_to_call", updated_at: now }).eq("id", lead.id);
      }
    }

    return { placed, queued, failed, limitReached, errors };
  });

// ── Schedule outbound calls for a future time ─────────────────────────────
export const scheduleQualificationCalls = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        leadIds: z.array(z.string().uuid()).min(1).max(200),
        agentId: z.string().uuid(),
        fromNumber: z.string().nullable().optional(),
        scheduledAt: z.string(), // ISO datetime string
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context as any;
    if (!workspaceId) throw new Error("No active workspace");
    const sb = supabase as any;
    const now = new Date().toISOString();

    const { error } = await sb
      .from("leads")
      .update({
        status: "scheduled",
        scheduled_call_at: data.scheduledAt,
        scheduled_agent_id: data.agentId,
        scheduled_from_number: data.fromNumber || null,
        updated_at: now,
      })
      .eq("workspace_id", workspaceId)
      .in("id", data.leadIds);

    if (error) throw new Error(error.message);
    return { scheduled: data.leadIds.length };
  });

// ── Fire all scheduled calls that are due now ─────────────────────────────
export const fireScheduledCalls = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, workspaceId, userId } = context as any;
    if (!workspaceId) throw new Error("No active workspace");
    const sb = supabase as any;

    // Fetch due scheduled leads grouped by agent
    const { data: scheduledLeads, error } = await sb
      .from("leads")
      .select("id, phone, full_name, email, company_name, call_summary, next_action, interest_level, notes, source, meta, scheduled_agent_id, scheduled_from_number")
      .eq("workspace_id", workspaceId)
      .eq("status", "scheduled")
      .lte("scheduled_call_at", new Date().toISOString())
      .not("scheduled_agent_id", "is", null);

    if (error) throw new Error(error.message);
    if (!scheduledLeads?.length) return { fired: 0, message: "No scheduled calls due" };

    // Clear schedule fields first to prevent double-firing on concurrent requests
    const dueIds = scheduledLeads.map((l: any) => l.id);
    await sb
      .from("leads")
      .update({ status: "calling", scheduled_call_at: null, updated_at: new Date().toISOString() })
      .eq("workspace_id", workspaceId)
      .in("id", dueIds);

    // Resolve shared workspace Retell key once
    const { data: wsSettings } = await sb
      .from("workspace_settings")
      .select("retell_workspace_id")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    const clientRetellKey = (wsSettings as any)?.retell_workspace_id?.trim() || undefined;

    let placed = 0;
    let failed = 0;
    const errors: { leadId: string; message: string }[] = [];
    const now = new Date().toISOString();

    // Start of today for daily limit check
    const todayUtc = new Date();
    todayUtc.setUTCHours(0, 0, 0, 0);
    const todayStart = todayUtc.toISOString();

    // Group by agent so we only load each agent once
    const agentCache: Record<string, { retellAgentId: string | null; fromNumber: string | null; name: string; preCallMappings: Record<string, string>; resolvedKey: string | undefined }> = {};

    for (const lead of scheduledLeads) {
      if (!lead.phone?.trim()) {
        failed += 1;
        errors.push({ leadId: lead.id, message: "No phone number" });
        continue;
      }

      const agentId = lead.scheduled_agent_id as string;
      if (!agentCache[agentId]) {
        const { data: agent } = await sb
          .from("agents")
          .select("id, retell_agent_id, name, settings")
          .eq("id", agentId)
          .maybeSingle();
        const agentSettings = (agent?.settings ?? {}) as Record<string, unknown>;
        const qualifySettings = (agentSettings.qualify as Record<string, unknown> | undefined) ?? {};
        const deployedRetellAgentId = (agentSettings.deployedRetellAgentId as string | undefined) ?? null;

        let agentApiKey: string | undefined;
        if (deployedRetellAgentId && userId) {
          const { data: secret } = await (supabaseAdmin as any)
            .from("agent_retell_secrets")
            .select("production_api_key")
            .eq("agent_id", agentId)
            .eq("user_id", userId)
            .maybeSingle();
          const k = secret?.production_api_key?.trim();
          if (k?.startsWith("key_")) agentApiKey = k;
        }

        agentCache[agentId] = {
          retellAgentId: deployedRetellAgentId ?? agent?.retell_agent_id ?? null,
          fromNumber: (agentSettings.phoneNumber as string | undefined) ?? null,
          name: agent?.name ?? "Agent",
          preCallMappings: (qualifySettings.preCallMappings as Record<string, string> | undefined) ?? {},
          resolvedKey: deployedRetellAgentId ? (clientRetellKey || agentApiKey) : undefined,
        };
      }

      const { retellAgentId, fromNumber: agentFromNumber, name: agentName, preCallMappings, resolvedKey } = agentCache[agentId];
      const fromNumber = (lead.scheduled_from_number as string | null) || agentFromNumber;

      if (!retellAgentId || !fromNumber) {
        failed += 1;
        errors.push({ leadId: lead.id, message: "Agent not fully configured" });
        continue;
      }

      // Daily limit check
      const { count: attemptsToday } = await sb
        .from("calls")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .eq("to_number", lead.phone)
        .gte("created_at", todayStart);
      if ((attemptsToday ?? 0) >= 3) {
        failed += 1;
        errors.push({ leadId: lead.id, message: "Daily call limit reached (3/day)" });
        await sb.from("leads").update({ status: "need_to_call", updated_at: now }).eq("id", lead.id);
        continue;
      }

      try {
        const dynamicVars: Record<string, string> = { full_name: lead.full_name ?? "" };
        for (const [placeholder, leadField] of Object.entries(preCallMappings)) {
          const val = (lead as Record<string, unknown>)[leadField as string];
          if (val != null && val !== "") dynamicVars[placeholder] = String(val);
        }

        const callPayload = {
          from_number: fromNumber,
          to_number: lead.phone,
          override_agent_id: retellAgentId,
          metadata: { lead_id: lead.id, workspace_id: workspaceId },
          retell_llm_dynamic_variables: dynamicVars,
        };

        const call = await retellFetch<any>("/v2/create-phone-call", callPayload, resolvedKey);
        await sb.from("calls").insert({
          workspace_id: workspaceId,
          retell_call_id: call?.call_id ?? null,
          agent_id: retellAgentId,
          agent_name: agentName,
          from_number: fromNumber,
          to_number: lead.phone,
          call_type: "outbound",
          call_status: "initiated",
          lead_id: lead.id,
        });
        placed += 1;
      } catch (e: any) {
        failed += 1;
        errors.push({ leadId: lead.id, message: e?.message ?? "Retell call failed" });
        await sb.from("leads").update({ status: "need_to_call", updated_at: now }).eq("id", lead.id);
      }
    }

    return { fired: placed, failed, errors };
  });
