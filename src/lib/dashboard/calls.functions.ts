import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { cacheWrap, cacheDel } from "@/lib/cache/redis.server";
import { resolvePermissions } from "@/lib/permissions/permissions.server";

const CALLS_TTL      = 2 * 60;  // 2 minutes
const TEST_CALLS_TTL = 5 * 60;  // 5 minutes

export const listCalls = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        status: z.string().optional(),
        direction: z.enum(["inbound", "outbound"]).optional(),
        limit: z.number().int().min(1).max(10000).default(5000),
        // "exclude" = hide voicemails (default), "all" = show everything, "only" = voicemails only
        voicemailFilter: z.enum(["exclude", "all", "only"]).default("exclude"),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId, userId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    // Assigned-record visibility: restricted roles only see calls belonging
    // to leads assigned to them (calls have no direct assignment column).
    const perms = await resolvePermissions(workspaceId, userId);
    const assignedOnly = perms.assignedRecordsOnly === true;
    let assignedLeadIds: string[] | null = null;
    if (assignedOnly) {
      const { data: myLeads } = await (supabase as any)
        .from("leads")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("assigned_to", userId)
        .limit(1000);
      assignedLeadIds = (myLeads ?? []).map((l: any) => l.id);
      if (assignedLeadIds.length === 0) return [];
    }
    const cacheKey = `webee:calls:${workspaceId}:${assignedOnly ? `au:${userId}:` : ""}vm:${data.voicemailFilter}:st:${data.status ?? ""}:dir:${data.direction ?? ""}:lim:${data.limit}:from:${data.dateFrom ?? ""}:to:${data.dateTo ?? ""}`;
    return cacheWrap(cacheKey, CALLS_TTL, async () => {
      const sb = supabase as any;
      let q = sb
        .from("calls")
        .select("*, lead:leads(id, full_name, phone)")
        .eq("workspace_id", workspaceId)
        // Exclude test/builder calls. Web calls have no real phone number and are
        // stored with to_number = "unknown". Only live phone calls should appear.
        .neq("to_number", "unknown")
        .order("started_at", { ascending: false, nullsFirst: false })
        .limit(data.limit);
      if (data.status && data.status !== "all") q = q.eq("call_status", data.status as any);
      if (data.direction) q = q.eq("call_type", data.direction as any);
      // Apply voicemail filter — "exclude" hides voicemails (default), "only" shows only voicemails
      if (data.voicemailFilter === "exclude") {
        q = q.eq("is_voicemail", false);
      } else if (data.voicemailFilter === "only") {
        q = q.eq("is_voicemail", true);
      }
      // "all" applies no filter — all rows including voicemails are returned
      if (data.dateFrom) q = q.gte("started_at", data.dateFrom);
      if (data.dateTo) q = q.lte("started_at", data.dateTo);
      if (assignedLeadIds) q = q.in("lead_id", assignedLeadIds);
      const { data: rows, error } = await q;
      if (error) throw new Error(error.message);
      return rows ?? [];
    });
  });

export const listTestCalls = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({ limit: z.number().int().min(1).max(10000).default(5000) })
      .parse(input ?? {}),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    return cacheWrap(`webee:calls:test:${workspaceId}:lim:${data.limit}`, TEST_CALLS_TTL, async () => {
    const sb = supabase as any;
    const { data: rows, error } = await sb
      .from("calls")
      .select("id, agent_id, agent_name, call_status, call_type, duration_seconds, started_at, ended_at, recording_url, transcript, call_summary, retell_call_id, from_number, to_number, sentiment, disconnection_reason, cost_cents")
      .eq("workspace_id", workspaceId)
      .eq("to_number", "unknown")
      .order("started_at", { ascending: false, nullsFirst: false })
      .limit(data.limit);
    if (error) throw new Error(error.message);
    return (rows ?? []) as Array<{
      id: string;
      agent_id: string | null;
      agent_name: string | null;
      call_status: string | null;
      call_type: string | null;
      duration_seconds: number | null;
      started_at: string | null;
      ended_at: string | null;
      recording_url: string | null;
      transcript: string | null;
      call_summary: string | null;
      retell_call_id: string | null;
      from_number: string | null;
      to_number: string | null;
      sentiment: string | null;
      disconnection_reason: string | null;
      cost_cents: number | null;
    }>;
    });
  });

export const deleteTestCalls = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({ ids: z.array(z.string().uuid()).min(1).max(500) })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const sb = supabase as any;
    // Only test/builder calls (to_number = "unknown") in the caller's own
    // workspace can be deleted — live call records are never touched.
    const { data: deleted, error } = await sb
      .from("calls")
      .delete()
      .eq("workspace_id", workspaceId)
      .eq("to_number", "unknown")
      .in("id", data.ids)
      .select("id");
    if (error) throw new Error(error.message);
    // Invalidate the cached test-calls list (UI always requests the default limit).
    await cacheDel(`webee:calls:test:${workspaceId}:lim:5000`).catch(() => {});
    return { deletedCount: (deleted ?? []).length };
  });

export const listCalledQualifiedRecords = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const sb = supabase as any;

    const { data: calls, error: callsErr } = await sb
      .from("calls")
      .select(
        "id, to_number, sentiment, call_status, call_outcome, call_summary, started_at, ended_at, duration_seconds, agent_name",
      )
      .eq("workspace_id", workspaceId)
      .in("sentiment", ["neutral", "positive"])
      .order("started_at", { ascending: false, nullsFirst: false })
      .limit(2000);
    if (callsErr) throw new Error(callsErr.message);

    const callsList = (calls ?? []) as any[];
    if (callsList.length === 0) return [];

    const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

    const latestByPhone = new Map<string, any>();
    for (const c of callsList) {
      const key = digits(c.to_number);
      if (!key) continue;
      if (!latestByPhone.has(key)) latestByPhone.set(key, c);
    }

    const { data: records, error: recErr } = await sb
      .from("data_records")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("is_deleted", false)
      .limit(5000);
    if (recErr) throw new Error(recErr.message);

    const out: any[] = [];
    for (const r of (records ?? []) as any[]) {
      const key = digits(r.mobile_number);
      const call = key ? latestByPhone.get(key) : undefined;
      if (call) out.push({ record: r, call });
    }

    out.sort((a, b) => {
      const ta = a.call.started_at ? new Date(a.call.started_at).getTime() : 0;
      const tb = b.call.started_at ? new Date(b.call.started_at).getTime() : 0;
      return tb - ta;
    });

    return out;
  });
