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

export type FunnelSnapshot = {
  id:         string;
  name:       string;
  stages:     FunnelStage[];
  snapshotAt: string;
  createdAt:  string;
};

// ── Compute funnel stages from GrowthMind data ─────────────────────────────────
// No server fn needed — pure computation run on client using already-fetched data

export function computeFunnelStages(data: any): FunnelStage[] {
  if (!data) return [];

  const leads    = data.leads    ?? {};
  const bookings = data.bookings ?? {};

  const totalLeads   = leads.total     ?? 0;
  const qualifiedLeads =
    (data as any).__rawLeadCounts?.qualified ?? estimateQualified(leads);
  const appointments = bookings.total  ?? 0;
  const sales        = leads.sales     ?? 0;

  const stageCounts = [
    { key: "traffic",   label: "Traffic / Leads",     count: totalLeads },
    { key: "qualified", label: "Qualified",            count: qualifiedLeads },
    { key: "appointment",label: "Appointment",         count: appointments },
    { key: "sale",      label: "Sale",                 count: sales },
  ];

  return stageCounts.map((stage, i) => {
    const prev = i === 0 ? null : stageCounts[i - 1].count;
    if (prev === null) {
      return { ...stage, convFromPrev: null, dropPct: null, dropColor: "none" };
    }
    const convFromPrev = prev > 0 ? Math.round((stage.count / prev) * 100) : 0;
    const dropPct      = prev > 0 ? Math.round(((prev - stage.count) / prev) * 100) : 0;
    const dropColor: FunnelStage["dropColor"] =
      dropPct < 20  ? "green" :
      dropPct < 50  ? "amber" : "red";
    return { ...stage, convFromPrev, dropPct, dropColor };
  });
}

function estimateQualified(leads: any): number {
  const active = leads.active ?? 0;
  const total  = leads.total  ?? 0;
  const sales  = leads.sales  ?? 0;
  const notConverted = total - sales;
  return Math.max(0, Math.round(notConverted * 0.4));
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
