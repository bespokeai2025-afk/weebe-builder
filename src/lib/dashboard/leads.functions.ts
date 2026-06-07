import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
          "interested",
          "not_interested",
          "qualified",
          "completed",
          "do_not_call",
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
