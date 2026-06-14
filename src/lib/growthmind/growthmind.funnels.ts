import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ── Types ───────────────────────────────────────────────────────────────────────

export type FunnelStage = {
  key:          string;
  label:        string;
  count:        number;
  convFromPrev: number | null;
  dropPct:      number | null;
  dropColor:    "green" | "amber" | "red" | "none";
};

export type FunnelLiveData = {
  traffic:      number;
  leads:        number;
  qualifiedLeads: number;
  appointments: number;
  proposals:    number;
  sales:        number;
};

export type FunnelSnapshot = {
  id:         string;
  name:       string;
  stages:     FunnelStage[];
  snapshotAt: string;
  createdAt:  string;
};

// ── Server function: fetch real status-mapped funnel counts ────────────────────

export const getFunnelLiveData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const [leadsRes, bookingsRes] = await Promise.all([
      sb.from("leads")
        .select("id, status")
        .eq("workspace_id", workspaceId)
        .limit(5000),
      sb.from("calendar_bookings")
        .select("id, status")
        .eq("workspace_id", workspaceId)
        .limit(1000),
    ]);

    const allLeads    = leadsRes.data    ?? [];
    const allBookings = bookingsRes.data ?? [];

    // Stage 1 & 2: Traffic / Lead — total leads entering the CRM
    const totalLeads = allLeads.length;

    // Stage 3: Qualified Lead — explicitly screened and progressed
    const qualifiedStatuses = new Set([
      "qualified", "in_progress", "contacted",
      "callback_requested", "calling", "interested",
    ]);
    const qualifiedLeads = allLeads.filter((l: any) => qualifiedStatuses.has(l.status)).length;

    // Stage 4: Appointment — all bookings scheduled
    const appointments = allBookings.length;

    // Stage 5: Proposal — confirmed bookings (appointment kept; not no_show/cancelled)
    const proposals = allBookings.filter(
      (b: any) => b.status !== "no_show" && b.status !== "cancelled",
    ).length;

    // Stage 6: Sale
    const sales = allLeads.filter((l: any) => l.status === "sale_done").length;

    return { traffic: totalLeads, leads: totalLeads, qualifiedLeads, appointments, proposals, sales };
  });

// ── Pure computation: build FunnelStage array from live data ───────────────────

export function computeFunnelStages(data: FunnelLiveData): FunnelStage[] {
  const rawStages = [
    { key: "traffic",     label: "Traffic / Enquiries",   count: data.traffic },
    { key: "lead",        label: "Lead",                  count: data.leads },
    { key: "qualified",   label: "Qualified Lead",        count: data.qualifiedLeads },
    { key: "appointment", label: "Appointment",           count: data.appointments },
    { key: "proposal",    label: "Proposal",              count: data.proposals },
    { key: "sale",        label: "Sale",                  count: data.sales },
  ];

  return rawStages.map((stage, i) => {
    const prev = i === 0 ? null : rawStages[i - 1].count;
    if (prev === null) {
      return { ...stage, convFromPrev: null, dropPct: null, dropColor: "none" as const };
    }
    const convFromPrev = prev > 0 ? Math.round((stage.count / prev) * 100) : 0;
    const dropPct      = prev > 0 ? Math.round(((prev - stage.count) / prev) * 100) : 0;
    const dropColor: FunnelStage["dropColor"] =
      dropPct < 20  ? "green" :
      dropPct <= 50 ? "amber" : "red";
    return { ...stage, convFromPrev, dropPct, dropColor };
  });
}

// ── Save a funnel snapshot ─────────────────────────────────────────────────────

export const saveFunnelSnapshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      name:   z.string().min(1).max(100).default("Funnel Snapshot"),
      stages: z.array(z.object({
        key:          z.string(),
        label:        z.string(),
        count:        z.number(),
        convFromPrev: z.number().nullable(),
        dropPct:      z.number().nullable(),
        dropColor:    z.string(),
      })),
    }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { error } = await sb.from("growthmind_funnels").insert({
      workspace_id: workspaceId,
      name:         data.name,
      stages:       data.stages,
      snapshot_at:  new Date().toISOString(),
    });

    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── List saved funnel snapshots ────────────────────────────────────────────────

export const getFunnelSnapshots = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { data, error } = await sb
      .from("growthmind_funnels")
      .select("id, name, stages, snapshot_at, created_at")
      .eq("workspace_id", workspaceId)
      .order("snapshot_at", { ascending: false })
      .limit(20);

    if (error) throw new Error(error.message);

    const snapshots: FunnelSnapshot[] = (data ?? []).map((r: any) => ({
      id:         r.id,
      name:       r.name,
      stages:     r.stages ?? [],
      snapshotAt: r.snapshot_at,
      createdAt:  r.created_at,
    }));

    return { snapshots };
  });

// ── Delete a snapshot ──────────────────────────────────────────────────────────

export const deleteFunnelSnapshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { error } = await sb
      .from("growthmind_funnels")
      .delete()
      .eq("id", data.id)
      .eq("workspace_id", workspaceId);

    if (error) throw new Error(error.message);
    return { ok: true };
  });
