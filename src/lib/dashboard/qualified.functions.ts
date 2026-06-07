import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listQualifiedLeads = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        search: z.string().optional(),
        qualificationStatus: z.string().optional(),
        limit: z.number().int().min(1).max(500).default(200),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const sb = supabase as any;
    let q = sb
      .from("leads")
      .select("*")
      .eq("workspace_id", workspaceId)
      .in("status", ["interested", "qualified"])
      .order("updated_at", { ascending: false })
      .limit(data.limit);
    if (data.search)
      q = q.or(
        `full_name.ilike.%${data.search}%,phone.ilike.%${data.search}%,email.ilike.%${data.search}%`,
      );
    if (data.qualificationStatus && data.qualificationStatus !== "all")
      q = q.eq("qualification_status", data.qualificationStatus);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const listQualifiedRecords = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const sb = supabase as any;

    const { data: calls, error: callsErr } = await sb
      .from("calls")
      .select("id, to_number")
      .eq("workspace_id", workspaceId)
      .in("sentiment", ["neutral", "positive"])
      .order("started_at", { ascending: false, nullsFirst: false })
      .limit(2000);
    if (callsErr) throw new Error(callsErr.message);

    const callsList = (calls ?? []) as any[];
    if (callsList.length === 0) return [];

    const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

    const phones = new Set<string>();
    for (const c of callsList) {
      const key = digits(c.to_number);
      if (key) phones.add(key);
    }

    const { data: records, error: recErr } = await sb
      .from("data_records")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("is_deleted", false)
      .limit(5000);
    if (recErr) throw new Error(recErr.message);

    return (records ?? []).filter((r: any) => phones.has(digits(r.mobile_number)));
  });

export const getQualificationStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const sb = supabase as any;

    const { data: rows, error } = await sb
      .from("leads")
      .select("status, qualification_status, qualification_score, sentiment")
      .eq("workspace_id", workspaceId)
      .in("status", ["interested", "qualified"]);
    if (error) throw new Error(error.message);

    const all = (rows ?? []) as any[];
    const qualified = all.filter((r: any) => r.qualification_status === "qualified");
    const partial = all.filter((r: any) => r.qualification_status === "partially_qualified");
    const withScore = all.filter((r: any) => r.qualification_score != null);
    const avgScore =
      withScore.length > 0
        ? Math.round(withScore.reduce((a: number, r: any) => a + r.qualification_score, 0) / withScore.length)
        : null;

    return {
      total: all.length,
      qualified: qualified.length,
      partiallyQualified: partial.length,
      avgScore,
      qualificationRate: all.length > 0 ? Math.round((qualified.length / all.length) * 100) : 0,
    };
  });
