import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listCalls = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        status: z.string().optional(),
        direction: z.enum(["inbound", "outbound"]).optional(),
        limit: z.number().int().min(1).max(500).default(100),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const sb = supabase as any;
    let q = sb
      .from("calls")
      .select("*, lead:leads(id, full_name, phone)")
      .eq("workspace_id", workspaceId)
      .order("started_at", { ascending: false, nullsFirst: false })
      .limit(data.limit);
    if (data.status && data.status !== "all") q = q.eq("call_status", data.status as any);
    if (data.direction) q = q.eq("call_type", data.direction as any);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
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
