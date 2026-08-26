/**
 * Marketing objectives — SERVER ONLY.
 *
 * HiveMind converts plain commands ("Improve my Google Ads", "Get me more
 * demo bookings") into measurable objectives: metric + baseline + target +
 * constraints. Objectives delegate to GrowthMind through the existing
 * work-order/mind-task backbone, and every linked Marketing Action carries a
 * measurement window (see marketing-operator-tick.ts).
 *
 * Honesty rules:
 *  - Baselines come from real workspace data; when a metric has no data the
 *    baseline says so explicitly (adequate:false) — never a silent 0-target.
 *  - The seven-section status view only reports actions/results that exist in
 *    the DB; "RESULTS" only shows classified outcomes, never projections.
 *  - marketing_objectives / marketing_operator_findings are server-write-only
 *    (REVOKEd); members read via RLS.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Sb = any;

async function getAdmin(): Promise<Sb> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

const nowIso = () => new Date().toISOString();
const DAY = 24 * 60 * 60 * 1000;

// ── Metric catalogue ──────────────────────────────────────────────────────────

export const OBJECTIVE_METRICS = {
  qualified_opportunities: { label: "Qualified opportunities", source: "conversion_events", lowerIsBetter: false },
  booked_demos:            { label: "Booked demos",            source: "bookings",          lowerIsBetter: false },
  lead_volume:             { label: "New leads",               source: "conversion_events", lowerIsBetter: false },
  revenue:                 { label: "Ads-attributed revenue",  source: "google_ads",        lowerIsBetter: false },
  wasted_spend:            { label: "Wasted ad spend (zero-conversion campaigns)", source: "google_ads", lowerIsBetter: true },
  cost_per_conversion:     { label: "Cost per conversion (Google Ads)", source: "google_ads", lowerIsBetter: true },
  conversion_rate:         { label: "Conversion rate (Google Ads)",     source: "google_ads", lowerIsBetter: false },
} as const;

export type ObjectiveMetric = keyof typeof OBJECTIVE_METRICS;

export interface MetricWindowValue {
  value: number | null;
  adequate: boolean;
  detail: Record<string, unknown>;
}

/** Compute one metric over [startIso, endIso) from real workspace data. */
export async function computeMetricWindow(
  sb: Sb, workspaceId: string, metric: ObjectiveMetric, startIso: string, endIso: string,
): Promise<MetricWindowValue> {
  try {
    if (metric === "qualified_opportunities") {
      const [evRes, leadRes] = await Promise.all([
        sb.from("conversion_events").select("id", { count: "exact", head: true })
          .eq("workspace_id", workspaceId).eq("conversion_name", "ava_qualified_lead")
          .gte("created_at", startIso).lt("created_at", endIso),
        sb.from("leads").select("id", { count: "exact", head: true })
          .eq("workspace_id", workspaceId).in("status", ["interested", "qualified"])
          .gte("created_at", startIso).lt("created_at", endIso),
      ]);
      // Fail closed: an errored read is "no data", never a real zero.
      if (evRes.error || leadRes.error) {
        return { value: null, adequate: false, detail: { error: String(evRes.error?.message ?? leadRes.error?.message).slice(0, 200) } };
      }
      const value = Math.max(evRes.count ?? 0, leadRes.count ?? 0);
      return { value, adequate: true, detail: { qualified_conversion_events: evRes.count ?? 0, qualified_leads: leadRes.count ?? 0 } };
    }
    if (metric === "booked_demos") {
      const { data, error } = await sb.from("calendar_bookings").select("id,status")
        .eq("workspace_id", workspaceId).gte("created_at", startIso).lt("created_at", endIso).limit(2000);
      if (error) return { value: null, adequate: false, detail: { error: String(error.message).slice(0, 200) } };
      const cancelled = new Set(["cancelled", "canceled", "rejected", "declined"]);
      const value = (data ?? []).filter((b: any) => !cancelled.has(String(b.status ?? "").toLowerCase())).length;
      return { value, adequate: true, detail: { total_rows: (data ?? []).length } };
    }
    if (metric === "lead_volume") {
      const { count, error } = await sb.from("leads").select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId).gte("created_at", startIso).lt("created_at", endIso);
      if (error) return { value: null, adequate: false, detail: { error: String(error.message).slice(0, 200) } };
      return { value: count ?? 0, adequate: true, detail: {} };
    }
    // Google Ads-derived metrics — need synced daily rows to be adequate.
    const { data: rows, error: rowsError } = await sb.from("growthmind_gads_campaign_daily")
      .select("campaign_id,name,cost_micros,conversions,conversions_value,clicks,date")
      .eq("workspace_id", workspaceId)
      .gte("date", startIso.slice(0, 10)).lt("date", endIso.slice(0, 10))
      .limit(5000);
    if (rowsError) return { value: null, adequate: false, detail: { error: String(rowsError.message).slice(0, 200) } };
    const list = rows ?? [];
    if (!list.length) return { value: null, adequate: false, detail: { reason: "No synced Google Ads daily data in this window." } };
    const spend = list.reduce((s: number, r: any) => s + Number(r.cost_micros || 0), 0) / 1e6;
    const conv = list.reduce((s: number, r: any) => s + Number(r.conversions || 0), 0);
    const clicks = list.reduce((s: number, r: any) => s + Number(r.clicks || 0), 0);
    if (metric === "revenue") {
      const value = list.reduce((s: number, r: any) => s + Number(r.conversions_value || 0), 0);
      return { value: Math.round(value * 100) / 100, adequate: true, detail: { rows: list.length } };
    }
    if (metric === "wasted_spend") {
      const byCampaign = new Map<string, { spend: number; conv: number; name: string }>();
      for (const r of list) {
        const cur = byCampaign.get(r.campaign_id) ?? { spend: 0, conv: 0, name: r.name };
        cur.spend += Number(r.cost_micros || 0) / 1e6;
        cur.conv += Number(r.conversions || 0);
        byCampaign.set(r.campaign_id, cur);
      }
      const wasted = [...byCampaign.values()].filter((c) => c.conv === 0 && c.spend > 0);
      const value = wasted.reduce((s, c) => s + c.spend, 0);
      return {
        value: Math.round(value * 100) / 100, adequate: true,
        detail: { zero_conversion_campaigns: wasted.map((c) => ({ name: c.name, spend: Math.round(c.spend * 100) / 100 })).slice(0, 10) },
      };
    }
    if (metric === "cost_per_conversion") {
      if (conv <= 0) return { value: null, adequate: spend > 0, detail: { spend: Math.round(spend * 100) / 100, conversions: 0, reason: "No conversions in window." } };
      return { value: Math.round((spend / conv) * 100) / 100, adequate: true, detail: { spend: Math.round(spend * 100) / 100, conversions: conv } };
    }
    // conversion_rate
    if (clicks < 20) return { value: null, adequate: false, detail: { clicks, reason: "Fewer than 20 clicks in window — rate would be noise." } };
    return { value: Math.round((conv / clicks) * 10000) / 100, adequate: true, detail: { conversions: conv, clicks } };
  } catch (err: any) {
    return { value: null, adequate: false, detail: { error: String(err?.message ?? err).slice(0, 200) } };
  }
}

// ── Create / delegate ─────────────────────────────────────────────────────────

export interface CreateObjectiveInput {
  commandText: string;
  title?: string;
  metric: ObjectiveMetric;
  targetDirection?: "increase" | "decrease";
  targetPct?: number;
  deadline?: string;
  constraints?: Array<{ metric: string; rule: "maintain" | "max" | "min"; value?: number; label?: string }>;
  priority?: number;
  delegate?: boolean;
}

export interface UpdateMarketingObjectiveInput {
  objectiveId?: string;
  objectiveName?: string;
  status?: "active" | "paused" | "achieved" | "not_achieved" | "abandoned";
  targetPct?: number | null;
  deadline?: string | null;
}

function isIsoCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Update an objective through the same owner/admin gate used by the UI.
 * Names must resolve uniquely so conversational references never change the
 * wrong objective.
 */
export async function updateMarketingObjectiveCore(
  sbAdmin: Sb,
  workspaceId: string,
  userId: string | null,
  input: UpdateMarketingObjectiveInput,
): Promise<any> {
  const { resolvePermissions, isOwnerOrAdmin } = await import("@/lib/permissions/permissions.server");
  const perms = await resolvePermissions(workspaceId, userId);
  if (!isOwnerOrAdmin(perms)) throw new Error("Only a workspace owner or admin can change a marketing objective.");

  if (!input.objectiveId && !input.objectiveName?.trim()) {
    throw new Error("Provide an objective id or name.");
  }
  if (input.status === undefined && input.targetPct === undefined && input.deadline === undefined) {
    throw new Error("Provide a status, target percentage, or deadline to change.");
  }
  if (typeof input.deadline === "string" && !isIsoCalendarDate(input.deadline)) {
    throw new Error("Deadline must be a valid ISO calendar date (YYYY-MM-DD).");
  }

  let lookup = sbAdmin.from("marketing_objectives")
    .select("id,title,status,target")
    .eq("workspace_id", workspaceId);
  if (input.objectiveId) lookup = lookup.eq("id", input.objectiveId);
  else lookup = lookup.eq("title", input.objectiveName!.trim());
  const { data: matches, error: lookupError } = await lookup.limit(2);
  if (lookupError) throw lookupError;
  if (!matches?.length) throw new Error("Marketing objective not found in this workspace.");
  if (matches.length > 1) throw new Error("More than one marketing objective has that name. Use the objective id instead.");

  const objective = matches[0] as any;
  const patch: Record<string, unknown> = { updated_at: nowIso() };
  if (input.status !== undefined) patch.status = input.status;
  if (input.targetPct !== undefined || input.deadline !== undefined) {
    patch.target = {
      ...(objective.target && typeof objective.target === "object" ? objective.target : {}),
      ...(input.targetPct !== undefined ? { pct: input.targetPct } : {}),
      ...(input.deadline !== undefined ? { deadline: input.deadline } : {}),
    };
  }

  const { data: updated, error } = await sbAdmin.from("marketing_objectives")
    .update(patch)
    .eq("workspace_id", workspaceId)
    .eq("id", objective.id)
    .select("id,title,status,target,updated_at")
    .single();
  if (error) throw error;
  return updated;
}

export async function createMarketingObjectiveCore(
  sbAdmin: Sb, workspaceId: string, userId: string | null, input: CreateObjectiveInput,
): Promise<{ objective: any; delegated: { workOrderId: string | null; note: string } }> {
  const def = OBJECTIVE_METRICS[input.metric];
  if (!def) throw new Error(`Unknown objective metric: ${input.metric}`);

  const windowDays = 14;
  const end = new Date();
  const start = new Date(end.getTime() - windowDays * DAY);
  const baselineWindow = await computeMetricWindow(sbAdmin, workspaceId, input.metric, start.toISOString(), end.toISOString());

  const direction = input.targetDirection ?? (def.lowerIsBetter ? "decrease" : "increase");
  const title = (input.title?.trim() || `${direction === "increase" ? "Increase" : "Reduce"} ${def.label.toLowerCase()}`).slice(0, 200);

  const { data: objective, error } = await sbAdmin.from("marketing_objectives").insert({
    workspace_id: workspaceId,
    title,
    command_text: input.commandText.slice(0, 2000),
    metric: input.metric,
    metric_source: def.source,
    baseline: {
      value: baselineWindow.value,
      adequate: baselineWindow.adequate,
      window_days: windowDays,
      computed_at: nowIso(),
      detail: baselineWindow.detail,
    },
    target: {
      direction,
      pct: input.targetPct ?? null,
      deadline: input.deadline ?? null,
    },
    constraints: (input.constraints ?? []).slice(0, 10),
    priority: Math.min(5, Math.max(1, Math.round(input.priority ?? 3))),
    created_by_user_id: userId,
  }).select("*").single();
  if (error) throw error;

  // Delegate to GrowthMind through the existing work-order backbone.
  let delegated: { workOrderId: string | null; note: string } = {
    workOrderId: null,
    note: "Not delegated — the daily marketing operator will surface findings for this objective.",
  };
  if (input.delegate !== false && def.source === "google_ads") {
    try {
      const { createGadsAnalysisWorkOrderCore } = await import("@/lib/hivemind/work-orders.server");
      const { workOrder } = await createGadsAnalysisWorkOrderCore(sbAdmin, workspaceId, userId, {
        objective: `Objective "${title}": ${input.commandText}`.slice(0, 500),
        objectiveId: objective.id,
        source: "hivemind_tool",
      });
      delegated = {
        workOrderId: workOrder.id,
        note: "Delegated to GrowthMind as a Google Ads analysis work order (awaiting analysis approval). Resulting change requests flow through the Marketing Action Engine.",
      };
      await sbAdmin.from("marketing_objectives")
        .update({ work_order_ids: [workOrder.id], updated_at: nowIso() })
        .eq("id", objective.id);
      (objective as any).work_order_ids = [workOrder.id];
    } catch (err: any) {
      delegated = { workOrderId: null, note: `Delegation failed honestly: ${String(err?.message ?? err).slice(0, 200)}` };
    }
  }
  return { objective, delegated };
}

// ── Objective ↔ action linkage ────────────────────────────────────────────────

/**
 * Backfill `marketing_actions.objective_id` for Google Ads objectives.
 *
 * Why: engine actions are produced downstream (gads recommendations → bridge)
 * with no objective context, so linkage is resolved here instead — and ONLY
 * when it is unambiguous: exactly one active google_ads objective in the
 * workspace claims unattributed google_ads actions created after it. With
 * two+ active gads objectives we refuse to guess (actions stay unlinked and
 * the status view says so).
 */
export async function linkGadsActionsToObjectives(sbAdmin: Sb, workspaceId: string): Promise<number> {
  const { data: objs, error } = await sbAdmin.from("marketing_objectives")
    .select("id,created_at").eq("workspace_id", workspaceId)
    .eq("status", "active").eq("metric_source", "google_ads");
  if (error || (objs ?? []).length !== 1) return 0;
  const obj = objs![0] as any;
  const { data: linked } = await sbAdmin.from("marketing_actions")
    .update({ objective_id: obj.id, updated_at: nowIso() })
    .eq("workspace_id", workspaceId).eq("platform", "google_ads")
    .is("objective_id", null).gte("created_at", obj.created_at)
    .select("id");
  return linked?.length ?? 0;
}

// ── Seven-section status ──────────────────────────────────────────────────────

export interface ObjectiveStatusView {
  objective: Record<string, unknown>;
  currentPerformance: Record<string, unknown>;
  diagnosis: string[];
  actionsTaken: Array<Record<string, unknown>>;
  actionsAwaitingApproval: Array<Record<string, unknown>>;
  results: Record<string, unknown>;
  nextActions: string[];
}

export async function buildObjectiveStatusCore(
  sbAdmin: Sb, workspaceId: string, objectiveId: string, opts: { persist?: boolean } = {},
): Promise<ObjectiveStatusView> {
  const { data: obj, error } = await sbAdmin.from("marketing_objectives")
    .select("*").eq("workspace_id", workspaceId).eq("id", objectiveId).single();
  if (error || !obj) throw new Error("Objective not found in this workspace.");

  // Resolve unattributed engine actions into this objective when unambiguous.
  if (obj.metric_source === "google_ads" && obj.status === "active") {
    try { await linkGadsActionsToObjectives(sbAdmin, workspaceId); } catch { /* best-effort */ }
  }

  const metric = obj.metric as ObjectiveMetric;
  const windowDays = Number((obj.baseline as any)?.window_days ?? 14);
  const end = new Date();
  const curStart = new Date(end.getTime() - windowDays * DAY);
  const current = await computeMetricWindow(sbAdmin, workspaceId, metric, curStart.toISOString(), end.toISOString());
  const baselineValue = (obj.baseline as any)?.value ?? null;

  // Constraint metrics (e.g. "maintain CPA") — recompute each honestly.
  const constraintChecks: Array<Record<string, unknown>> = [];
  for (const c of (Array.isArray(obj.constraints) ? obj.constraints : []).slice(0, 5)) {
    const cm = (c as any).metric as ObjectiveMetric;
    if (!OBJECTIVE_METRICS[cm]) continue;
    const v = await computeMetricWindow(sbAdmin, workspaceId, cm, curStart.toISOString(), end.toISOString());
    constraintChecks.push({ ...(c as any), current: v.value, adequate: v.adequate });
  }

  const [{ data: taken }, { data: awaiting }, { data: openFindings }] = await Promise.all([
    sbAdmin.from("marketing_actions")
      .select("id,platform,action_type,target,status,executed_at,reassess_at,outcome_classification,outcome,expected_impact")
      .eq("workspace_id", workspaceId).eq("objective_id", objectiveId)
      .in("status", ["approved", "executing", "executed", "verified", "measuring", "success", "failed", "rolled_back"])
      .order("created_at", { ascending: false }).limit(25),
    sbAdmin.from("marketing_actions")
      .select("id,platform,action_type,target,expected_impact,risk_level,created_at")
      .eq("workspace_id", workspaceId).eq("objective_id", objectiveId)
      .eq("status", "awaiting_approval").limit(25),
    sbAdmin.from("marketing_operator_findings")
      .select("finding_kind,severity,title,status")
      .eq("workspace_id", workspaceId).eq("objective_id", objectiveId)
      .eq("status", "open").limit(10),
  ]);

  const classified = (taken ?? []).filter((a: any) => a.outcome_classification);
  const byClass: Record<string, number> = {};
  for (const a of classified) byClass[a.outcome_classification] = (byClass[a.outcome_classification] ?? 0) + 1;

  const def = OBJECTIVE_METRICS[metric];
  const deltaPct = baselineValue != null && current.value != null && Number(baselineValue) !== 0
    ? Math.round(((current.value - Number(baselineValue)) / Math.abs(Number(baselineValue))) * 1000) / 10
    : null;
  const movingRightWay = deltaPct == null ? null : (def.lowerIsBetter ? deltaPct < 0 : deltaPct > 0);

  const diagnosis: string[] = [];
  if (!current.adequate) diagnosis.push(`Not enough data to measure ${def.label.toLowerCase()} this window: ${JSON.stringify(current.detail).slice(0, 200)}`);
  else if (deltaPct == null) diagnosis.push(`Baseline was not measurable when the objective was created — progress is tracked from current data only.`);
  else diagnosis.push(`${def.label} is ${current.value} vs baseline ${baselineValue} (${deltaPct > 0 ? "+" : ""}${deltaPct}%) — ${movingRightWay ? "moving the right way" : "not improving yet"}.`);
  for (const c of constraintChecks) {
    if ((c as any).rule === "max" && (c as any).current != null && (c as any).value != null && (c as any).current > (c as any).value) {
      diagnosis.push(`Constraint at risk: ${(c as any).metric} is ${(c as any).current}, above the limit of ${(c as any).value}.`);
    }
  }
  if ((awaiting ?? []).length) diagnosis.push(`${(awaiting ?? []).length} proposed action(s) are waiting for your approval — nothing executes without it.`);

  const nextActions: string[] = [];
  for (const f of openFindings ?? []) nextActions.push(`[${(f as any).severity}] ${(f as any).title}`);
  if ((awaiting ?? []).length) nextActions.push("Review pending approvals in the Action Centre (Approve & Execute or reject).");
  if (!(taken ?? []).length && !(awaiting ?? []).length) {
    nextActions.push((Array.isArray(obj.work_order_ids) && obj.work_order_ids.length)
      ? "Delegated GrowthMind work order is in progress — actions will appear here once drafted."
      : "The daily marketing operator will analyse connected sources and propose actions for this objective.");
  }

  const view: ObjectiveStatusView = {
    objective: {
      id: obj.id, title: obj.title, metric, metricLabel: def.label, status: obj.status,
      target: obj.target, constraints: obj.constraints, createdAt: obj.created_at,
      workOrderIds: obj.work_order_ids,
    },
    currentPerformance: {
      baseline: obj.baseline, current: { value: current.value, adequate: current.adequate, windowDays, detail: current.detail },
      deltaPct, movingRightWay, constraintChecks,
    },
    diagnosis,
    actionsTaken: (taken ?? []) as any[],
    actionsAwaitingApproval: (awaiting ?? []) as any[],
    results: {
      classifiedOutcomes: byClass,
      measuring: (taken ?? []).filter((a: any) => !a.outcome_classification && a.reassess_at).length,
      note: classified.length ? "Outcomes compare each action's after-window against its stored baseline." : "No measurement windows have closed yet — results appear after each action's reassessment date.",
    },
    nextActions,
  };

  if (opts.persist !== false) {
    await sbAdmin.from("marketing_objectives")
      .update({ last_review: view as any, last_reviewed_at: nowIso(), updated_at: nowIso() })
      .eq("id", objectiveId).eq("workspace_id", workspaceId);
  }
  return view;
}

// ── Server functions (UI) ─────────────────────────────────────────────────────

export const listMarketingObjectives = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    const userId = (context as any).userId;
    if (!workspaceId) throw new Error("No workspace");

    const { requirePageAccessEntitled } = await import("@/lib/packages/entitlements.server");
    await requirePageAccessEntitled(workspaceId, userId, "hivemind", "view");

    const [{ data: objectives }, { data: findings }, { data: settings }] = await Promise.all([
      sb.from("marketing_objectives").select("*").eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false }).limit(50),
      sb.from("marketing_operator_findings").select("*").eq("workspace_id", workspaceId)
        .in("status", ["open", "actioned"]).order("created_at", { ascending: false }).limit(50),
      sb.from("workspace_settings").select("marketing_operator_enabled, marketing_operator_last_run_at")
        .eq("workspace_id", workspaceId).maybeSingle(),
    ]);
    return {
      objectives: objectives ?? [],
      findings: findings ?? [],
      operatorEnabled: settings?.marketing_operator_enabled === true,
      operatorLastRunAt: settings?.marketing_operator_last_run_at ?? null,
    };
  });

export const getMarketingObjectiveStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ objectiveId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const workspaceId = context.workspaceId;
    const userId = (context as any).userId;
    if (!workspaceId) throw new Error("No workspace");

    const { requirePageAccessEntitled } = await import("@/lib/packages/entitlements.server");
    await requirePageAccessEntitled(workspaceId, userId, "hivemind", "view");

    const sbAdmin = await getAdmin();
    return await buildObjectiveStatusCore(sbAdmin, workspaceId, data.objectiveId);
  });

export const setMarketingObjectiveStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({
    objectiveId: z.string().uuid(),
    status: z.enum(["active", "paused", "achieved", "not_achieved", "abandoned"]),
  }).parse(input))
  .handler(async ({ context, data }) => {
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    const sbAdmin = await getAdmin();
    await updateMarketingObjectiveCore(
      sbAdmin,
      workspaceId,
      (context as any).userId ?? null,
      { objectiveId: data.objectiveId, status: data.status },
    );
    return { ok: true };
  });

export const setMarketingOperatorEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ enabled: z.boolean() }).parse(input))
  .handler(async ({ context, data }) => {
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    const { resolvePermissions, isOwnerOrAdmin } = await import("@/lib/permissions/permissions.server");
    const perms = await resolvePermissions(workspaceId, (context as any).userId ?? null);
    if (!isOwnerOrAdmin(perms)) throw new Error("Only a workspace owner or admin can change the marketing operator.");
    const sbAdmin = await getAdmin();
    const patch = { marketing_operator_enabled: data.enabled, updated_at: nowIso() };
    const { data: updated, error } = await sbAdmin.from("workspace_settings")
      .update(patch).eq("workspace_id", workspaceId).select("workspace_id");
    if (error) throw error;
    if (!updated?.length) {
      const { error: insErr } = await sbAdmin.from("workspace_settings")
        .insert({ workspace_id: workspaceId, ...patch });
      if (insErr) throw insErr;
    }
    return { ok: true };
  });

export const dismissOperatorFinding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ findingId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    const sbAdmin = await getAdmin();
    const { error } = await sbAdmin.from("marketing_operator_findings")
      .update({ status: "dismissed", updated_at: nowIso() })
      .eq("workspace_id", workspaceId).eq("id", data.findingId).in("status", ["open", "actioned"]);
    if (error) throw error;
    return { ok: true };
  });
