/**
 * Daily Marketing Operator — scheduled OBSERVE → DIAGNOSE → PRIORITISE →
 * MEASURE → LEARN tick.
 *
 * Loaded via ssrLoadModule in the dev campaign-scheduler plugin and statically
 * from the prod campaign executor route (same pattern as seo-campaign-tick).
 *
 * Rules (do not weaken):
 *  - CAS claim on workspace_settings.marketing_operator_last_run_at — exactly
 *    one instance runs a workspace per ~20h window (pg_cron double-fire safe).
 *  - Adequate-data thresholds everywhere: no single-day reactions; every
 *    finding carries the raw evidence that produced it.
 *  - Autopilot only ever SUBMITS low-risk recommended actions through
 *    submitMarketingActionForExecution — the Marketing Action Engine's
 *    autonomy level + guardrails remain the sole execution authority.
 *  - Measurement sweep classifies executed actions against their stored
 *    baseline; confounded windows (overlapping actions on the same platform)
 *    are honestly "inconclusive", never guessed.
 *  - Digest goes through the notification engine (marketing_operator_digest)
 *    and is only sent when there is something meaningful to say.
 */
import { createClient } from "@supabase/supabase-js";
import { emitCampaignNotification } from "../notifications/notification-engine.shared";
import { assessConversionPriority } from "../marketing/conversion-priority.shared";

type Sb = any;
const DAY = 24 * 60 * 60 * 1000;
const RUN_GAP_HOURS = 20;
const MIN_SIGNAL_DAYS = 3;          // a spend/UX signal must span ≥3 distinct days
const MIN_EVENTS_FOR_TREND = 5;     // conversion-trend findings need volume in both windows
const AUTOPILOT_SUBMIT_LIMIT = 3;   // max auto-submissions per workspace per tick
const MEASUREMENT_WINDOW_DAYS = 7;

function adminClient(): Sb {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase admin credentials missing");
  return createClient(url, key, { auth: { persistSession: false } }) as any;
}

const nowIso = () => new Date().toISOString();

// ── Findings ──────────────────────────────────────────────────────────────────

interface FindingDraft {
  finding_kind: string;
  severity: "info" | "attention" | "critical";
  title: string;
  detail: string;
  data: Record<string, unknown>;
  dedupe_key: string;
  objective_id?: string | null;
  marketing_action_id?: string | null;
}

/** Insert findings row-by-row; 23505 on the live partial-unique index = deduped. */
async function insertFindings(sb: Sb, workspaceId: string, drafts: FindingDraft[]): Promise<number> {
  let inserted = 0;
  const runDate = new Date().toISOString().slice(0, 10);
  for (const d of drafts) {
    const { error } = await sb.from("marketing_operator_findings").insert({
      workspace_id: workspaceId, run_date: runDate, ...d,
      objective_id: d.objective_id ?? null, marketing_action_id: d.marketing_action_id ?? null,
    });
    if (!error) inserted++;
    else if (String((error as any).code) !== "23505") {
      console.warn("[marketing-operator] finding insert failed:", (error as any).message);
    }
  }
  return inserted;
}

// ── Source checks (adequate-data thresholds) ─────────────────────────────────

async function gadsFindings(sb: Sb, workspaceId: string): Promise<FindingDraft[]> {
  const since = new Date(Date.now() - 7 * DAY).toISOString().slice(0, 10);
  const { data: rows } = await sb.from("growthmind_gads_campaign_daily")
    .select("campaign_id,name,cost_micros,conversions,clicks,date")
    .eq("workspace_id", workspaceId).gte("date", since).limit(5000);
  const list = rows ?? [];
  if (!list.length) return [];
  const byCampaign = new Map<string, { name: string; spend: number; conv: number; clicks: number; days: Set<string> }>();
  for (const r of list) {
    const c = byCampaign.get(r.campaign_id) ?? { name: r.name, spend: 0, conv: 0, clicks: 0, days: new Set<string>() };
    c.spend += Number(r.cost_micros || 0) / 1e6;
    c.conv += Number(r.conversions || 0);
    c.clicks += Number(r.clicks || 0);
    if (Number(r.cost_micros || 0) > 0) c.days.add(r.date);
    byCampaign.set(r.campaign_id, c);
  }
  const out: FindingDraft[] = [];
  for (const [id, c] of byCampaign) {
    // Wasted spend: money on ≥MIN_SIGNAL_DAYS distinct days, zero conversions.
    if (c.conv === 0 && c.spend >= 20 && c.days.size >= MIN_SIGNAL_DAYS) {
      out.push({
        finding_kind: "wasted_spend",
        severity: c.spend >= 100 ? "critical" : "attention",
        title: `"${c.name}" spent ${c.spend.toFixed(2)} over ${c.days.size} days with zero conversions`,
        detail: "Zero-conversion spend across the last 7 days. Review the campaign or delegate a Google Ads analysis to draft change requests.",
        data: { campaign_id: id, campaign_name: c.name, spend_7d: Math.round(c.spend * 100) / 100, clicks: c.clicks, active_days: c.days.size },
        dedupe_key: `wasted_spend:${id}`,
      });
    }
  }
  return out;
}

export async function conversionTrendFindings(sb: Sb, workspaceId: string): Promise<FindingDraft[]> {
  const now = Date.now();
  const cur = new Date(now - 7 * DAY).toISOString();
  const prev = new Date(now - 14 * DAY).toISOString();
  const [curRes, prevRes] = await Promise.all([
    sb.from("conversion_events").select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId).gte("created_at", cur),
    sb.from("conversion_events").select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId).gte("created_at", prev).lt("created_at", cur),
  ]);
  // Fail closed: an errored read is "unknown", never a real zero — a failed
  // current-window query must not manufacture a 100% "conversion drop".
  if (curRes.error || prevRes.error) {
    console.warn("[marketing-operator] conversion trend source unavailable:", curRes.error?.message ?? prevRes.error?.message);
    return [];
  }
  const c = curRes.count ?? 0;
  const p = prevRes.count ?? 0;
  if (p < MIN_EVENTS_FOR_TREND || c + p < MIN_EVENTS_FOR_TREND * 2) return [];
  const dropPct = ((p - c) / p) * 100;
  if (dropPct < 30) return [];
  return [{
    finding_kind: "conversion_drop",
    severity: dropPct >= 50 ? "critical" : "attention",
    title: `Conversions dropped ${Math.round(dropPct)}% week-over-week (${p} → ${c})`,
    detail: "Confirmed conversion events (leads, qualified calls, bookings) fell versus the prior 7 days. Both windows had enough volume for this to be a real trend, not noise.",
    data: { current_7d: c, previous_7d: p, drop_pct: Math.round(dropPct) },
    dedupe_key: `conversion_drop:${new Date().toISOString().slice(0, 10)}`,
  }];
}

async function pendingWorkFindings(sb: Sb, workspaceId: string): Promise<{ drafts: FindingDraft[]; approvals: number; completed24h: number }> {
  const since24 = new Date(Date.now() - DAY).toISOString();
  const [{ count: approvals }, { count: completed }] = await Promise.all([
    sb.from("marketing_actions").select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId).eq("status", "awaiting_approval"),
    sb.from("marketing_actions").select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId).in("status", ["executed", "verified", "measuring", "success"])
      .gte("executed_at", since24),
  ]);
  const drafts: FindingDraft[] = [];
  if ((approvals ?? 0) > 0) {
    drafts.push({
      finding_kind: "approval_pending",
      severity: "attention",
      title: `${approvals} marketing action(s) awaiting your approval`,
      detail: "Nothing executes without approval. Review them in the Action Centre.",
      data: { awaiting_approval: approvals },
      dedupe_key: `approval_pending:${new Date().toISOString().slice(0, 10)}`,
    });
  }
  return { drafts, approvals: approvals ?? 0, completed24h: completed ?? 0 };
}

// ── Autopilot (guardrails enforced by the engine, never here) ────────────────

async function autopilotSubmit(sb: Sb, workspaceId: string): Promise<{ submitted: number; executed: number; queued: number }> {
  const res = { submitted: 0, executed: 0, queued: 0 };
  try {
    const { getMarketingAutonomyConfig, submitMarketingActionForExecution } =
      await import("@/lib/marketing/action-engine.server");
    const cfg = await getMarketingAutonomyConfig(sb, workspaceId);
    if (cfg.level !== "autopilot") return res; // only autopilot workspaces auto-submit
    const { data: candidates } = await sb.from("marketing_actions")
      .select("id").eq("workspace_id", workspaceId)
      .eq("status", "recommended").eq("risk_level", "low")
      .order("created_at", { ascending: true }).limit(AUTOPILOT_SUBMIT_LIMIT);
    for (const a of candidates ?? []) {
      const r = await submitMarketingActionForExecution(sb, workspaceId, (a as any).id);
      res.submitted++;
      if (r.outcome === "executed" || r.outcome === "executed_unverified") res.executed++;
      else if (r.outcome === "awaiting_approval") res.queued++;
    }
  } catch (err: any) {
    console.warn("[marketing-operator] autopilot submit failed:", err?.message ?? err);
  }
  return res;
}

// ── Measurement + learning sweep ─────────────────────────────────────────────

type Classification = "successful" | "partial" | "no_change" | "unsuccessful" | "inconclusive";

async function measureWindow(
  sb: Sb, workspaceId: string, action: any, startIso: string, endIso: string,
): Promise<{ ok: boolean; errors: string[]; conversions: number; spend: number | null; clicks: number | null; qualified: number; bookings: number }> {
  const platform = String(action.platform ?? "");
  const errors: string[] = [];
  let spend: number | null = null, clicks: number | null = null, conversions = 0;
  if (platform === "google_ads") {
    const campaignId = String((action.target as any)?.campaign_id ?? (action.target as any)?.id ?? "");
    let q = sb.from("growthmind_gads_campaign_daily")
      .select("cost_micros,conversions,clicks")
      .eq("workspace_id", workspaceId)
      .gte("date", startIso.slice(0, 10)).lt("date", endIso.slice(0, 10)).limit(2000);
    if (campaignId) q = q.eq("campaign_id", campaignId);
    const { data, error } = await q;
    if (error) errors.push(`gads_daily: ${error.message}`);
    spend = (data ?? []).reduce((s: number, r: any) => s + Number(r.cost_micros || 0), 0) / 1e6;
    clicks = (data ?? []).reduce((s: number, r: any) => s + Number(r.clicks || 0), 0);
    conversions = (data ?? []).reduce((s: number, r: any) => s + Number(r.conversions || 0), 0);
  } else {
    const { count, error } = await sb.from("conversion_events").select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId).gte("created_at", startIso).lt("created_at", endIso);
    if (error) errors.push(`conversion_events: ${error.message}`);
    conversions = count ?? 0;
  }
  const [qualRes, bookRes] = await Promise.all([
    sb.from("conversion_events").select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId).eq("conversion_name", "ava_qualified_lead")
      .gte("created_at", startIso).lt("created_at", endIso),
    sb.from("calendar_bookings").select("id,status")
      .eq("workspace_id", workspaceId).gte("created_at", startIso).lt("created_at", endIso).limit(1000),
  ]);
  if (qualRes.error) errors.push(`qualified: ${qualRes.error.message}`);
  if (bookRes.error) errors.push(`bookings: ${bookRes.error.message}`);
  const cancelled = new Set(["cancelled", "canceled", "rejected", "declined"]);
  const bookings = (bookRes.data ?? []).filter((b: any) => !cancelled.has(String(b.status ?? "").toLowerCase())).length;
  // Fail closed: any errored source makes the whole window unmeasurable.
  return { ok: errors.length === 0, errors, conversions, spend, clicks, qualified: qualRes.count ?? 0, bookings };
}

export async function runMarketingMeasurementSweep(sb: Sb, workspaceId: string): Promise<{ measured: number; stamped: number }> {
  const out = { measured: 0, stamped: 0 };
  const { data: due } = await sb.from("marketing_actions")
    .select("id,platform,action_type,target,executed_at,reassess_at,baseline,objective_id,existing_value")
    .eq("workspace_id", workspaceId)
    .in("status", ["executed", "verified", "measuring", "success"])
    .is("outcome_classification", null)
    .not("executed_at", "is", null)
    .limit(50);

  for (const action of due ?? []) {
    const executedAt = new Date(action.executed_at).getTime();
    // Stamp the measurement window + retrospective baseline once.
    if (!action.reassess_at || !action.baseline) {
      const baseStart = new Date(executedAt - MEASUREMENT_WINDOW_DAYS * DAY).toISOString();
      const baseEnd = new Date(executedAt).toISOString();
      const before = await measureWindow(sb, workspaceId, action, baseStart, baseEnd);
      const patch: Record<string, unknown> = { updated_at: nowIso() };
      // Fail closed: never persist a baseline built from errored reads —
      // retry on the next sweep instead of freezing bogus zeros.
      if (!action.baseline && before.ok) patch.baseline = { ...before, window_days: MEASUREMENT_WINDOW_DAYS, computed_at: nowIso(), retrospective: true };
      if (!action.reassess_at) patch.reassess_at = new Date(executedAt + MEASUREMENT_WINDOW_DAYS * DAY).toISOString();
      await sb.from("marketing_actions").update(patch).eq("id", action.id).is("outcome_classification", null);
      out.stamped++;
      continue; // measure on a later sweep once the window has closed
    }
    if (new Date(action.reassess_at).getTime() > Date.now()) continue;

    // Confound check: other executed actions on the same platform overlapping the window.
    const winStart = new Date(executedAt).toISOString();
    const winEnd = action.reassess_at;
    const { count: overlapping } = await sb.from("marketing_actions")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId).eq("platform", action.platform)
      .neq("id", action.id).not("executed_at", "is", null)
      .gte("executed_at", winStart).lte("executed_at", winEnd);

    const after = await measureWindow(sb, workspaceId, action, winStart, winEnd);
    const before = action.baseline as any;

    let classification: Classification;
    let detail: Record<string, unknown> = { before, after, overlapping_actions: overlapping ?? 0 };
    const assessment = assessConversionPriority(
      { qualifiedOpportunities: after.qualified, bookedDemos: after.bookings, conversions: after.conversions, clicks: after.clicks, spend: after.spend },
      { qualifiedOpportunities: before?.qualified, bookedDemos: before?.bookings, conversions: before?.conversions, clicks: before?.clicks, spend: before?.spend },
    );
    detail.priorityAssessment = { score: assessment.score, topSignal: assessment.topSignal?.metric ?? null };

    if (!after.ok || (before as any)?.ok === false) {
      classification = "inconclusive";
      detail.reason = `Data source unavailable for the measurement window — refusing to judge. Errors: ${[...after.errors, ...(((before as any)?.errors as string[]) ?? [])].join("; ").slice(0, 300)}`;
    } else if ((overlapping ?? 0) > 0) {
      // The overlap query already excludes this action, so ANY other executed
      // action on the same platform in the window confounds attribution.
      classification = "inconclusive";
      detail.reason = "Another action executed on the same platform in this window — the effect cannot be attributed to this action alone.";
    } else if (!assessment.adequateData) {
      // Fall back to raw conversion counts when priority metrics lack volume.
      // Both windows must independently carry signal: a burst entirely inside
      // the after-window is not evidence the action worked.
      const b = Number(before?.conversions ?? 0);
      const a = Number(after.conversions ?? 0);
      if (b < 1 || b + a < 3) { classification = "inconclusive"; detail.reason = "Not enough conversion volume independently in both the before and after windows to judge."; }
      else if (a > b * 1.1) classification = "successful";
      else if (a > b) classification = "partial";
      else if (a >= b * 0.9) classification = "no_change";
      else classification = "unsuccessful";
    } else if (assessment.score >= 10) classification = "successful";
    else if (assessment.score > 2) classification = "partial";
    else if (assessment.score >= -5) classification = "no_change";
    else classification = "unsuccessful";

    // CAS write — only one sweeper classifies.
    const { data: casRows } = await sb.from("marketing_actions")
      .update({ outcome: { classification, detail, assessed_at: nowIso() }, outcome_classification: classification, measured_at: nowIso(), updated_at: nowIso() })
      .eq("id", action.id).is("outcome_classification", null).select("id");
    if (!casRows?.length) continue;
    out.measured++;

    // Bounded confidence learning (same store + clamp as HiveMind actions).
    try {
      const { applyOutcomeToConfidence } = await import("@/lib/hivemind/action-learning.server");
      await applyOutcomeToConfidence(sb, workspaceId, `marketing:${action.action_type}`, classification);
    } catch { /* best-effort */ }

    // GrowthMind memory: propose (never auto-accept) a learned pattern.
    try {
      const key = `marketing_action:${action.action_type}`;
      const { data: existing } = await sb.from("growthmind_learned_patterns")
        .select("id,sample_size,evidence").eq("workspace_id", workspaceId)
        .eq("pattern_kind", "marketing_action_outcome").eq("pattern_key", key)
        .eq("status", "proposed").maybeSingle();
      const delta = classification === "successful" ? 0.05 : classification === "partial" ? 0.02
        : classification === "unsuccessful" ? -0.05 : classification === "no_change" ? -0.02 : 0;
      if (existing?.id) {
        await sb.from("growthmind_learned_patterns").update({
          sample_size: Number(existing.sample_size ?? 0) + 1,
          evidence: [...(Array.isArray(existing.evidence) ? existing.evidence : []), { action_id: action.id, classification, at: nowIso() }].slice(-20),
          updated_at: nowIso(),
        }).eq("id", existing.id);
      } else if (delta !== 0) {
        await sb.from("growthmind_learned_patterns").insert({
          workspace_id: workspaceId,
          pattern_kind: "marketing_action_outcome",
          pattern_key: key,
          insight: `"${action.action_type}" actions on ${action.platform} measured ${classification} against their pre-execution baseline.`,
          adjustment: delta,
          confidence: 0.5,
          sample_size: 1,
          evidence: [{ action_id: action.id, classification, at: nowIso() }],
          status: "proposed",
        });
      }
    } catch { /* best-effort */ }
  }
  return out;
}

// ── Objective reviews ─────────────────────────────────────────────────────────

async function refreshObjectiveReviews(sb: Sb, workspaceId: string): Promise<number> {
  const { data: objectives } = await sb.from("marketing_objectives")
    .select("id").eq("workspace_id", workspaceId).eq("status", "active").limit(10);
  let refreshed = 0;
  for (const o of objectives ?? []) {
    try {
      const { buildObjectiveStatusCore } = await import("@/lib/hivemind/marketing-objectives.server");
      await buildObjectiveStatusCore(sb, workspaceId, (o as any).id);
      refreshed++;
    } catch { /* skip — surfaced on next manual view */ }
  }
  return refreshed;
}

// ── Main tick ─────────────────────────────────────────────────────────────────

export interface MarketingOperatorTickReport {
  ran: Array<{ workspaceId: string; findings: number; completed: number; approvals: number; autopilot: { submitted: number; executed: number; queued: number }; measured: number }>;
  skipped: number;
  failed: Array<{ workspaceId: string; error: string }>;
}

export async function runMarketingOperatorTick(): Promise<MarketingOperatorTickReport> {
  const sb = adminClient();
  const report: MarketingOperatorTickReport = { ran: [], skipped: 0, failed: [] };

  // Paginate the enabled-workspace scan so growth past one page can never
  // silently exclude workspaces from the daily loop.
  const enabled: Array<{ workspace_id: string }> = [];
  const PAGE = 200;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from("workspace_settings")
      .select("workspace_id")
      .eq("marketing_operator_enabled", true)
      .order("workspace_id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) { console.warn("[marketing-operator] workspace scan failed:", error.message); break; }
    enabled.push(...((data ?? []) as any));
    if ((data ?? []).length < PAGE) break;
  }

  const cutoffIso = new Date(Date.now() - RUN_GAP_HOURS * 60 * 60 * 1000).toISOString();
  for (const ws of enabled ?? []) {
    const workspaceId = (ws as any).workspace_id as string;
    try {
      // Atomic CAS claim — exactly one instance per window.
      const { data: claimed } = await sb.from("workspace_settings")
        .update({ marketing_operator_last_run_at: nowIso() })
        .eq("workspace_id", workspaceId)
        .eq("marketing_operator_enabled", true)
        .or(`marketing_operator_last_run_at.is.null,marketing_operator_last_run_at.lte.${cutoffIso}`)
        .select("workspace_id");
      if (!claimed?.length) { report.skipped++; continue; }

      // Expire stale open findings (>14 days) so the list stays current.
      await sb.from("marketing_operator_findings")
        .update({ status: "expired", updated_at: nowIso() })
        .eq("workspace_id", workspaceId).eq("status", "open")
        .lt("created_at", new Date(Date.now() - 14 * DAY).toISOString());

      const [gads, trend, pending] = await Promise.all([
        gadsFindings(sb, workspaceId),
        conversionTrendFindings(sb, workspaceId),
        pendingWorkFindings(sb, workspaceId),
      ]);
      const inserted = await insertFindings(sb, workspaceId, [...gads, ...trend, ...pending.drafts]);

      const autopilot = await autopilotSubmit(sb, workspaceId);
      // Resolve unattributed engine actions into the (single) active gads
      // objective before measuring, so outcomes flow into objective results.
      try {
        const { linkGadsActionsToObjectives } = await import("@/lib/hivemind/marketing-objectives.server");
        await linkGadsActionsToObjectives(sb, workspaceId);
      } catch { /* best-effort */ }
      const sweep = await runMarketingMeasurementSweep(sb, workspaceId);
      await refreshObjectiveReviews(sb, workspaceId);

      // Digest — only when there is something meaningful to say.
      const meaningful = inserted > 0 || pending.completed24h > 0 || pending.approvals > 0 || autopilot.executed > 0;
      if (meaningful) {
        const parts: string[] = [];
        if (pending.completed24h) parts.push(`${pending.completed24h} action(s) completed`);
        if (autopilot.executed) parts.push(`${autopilot.executed} executed on autopilot`);
        if (pending.approvals) parts.push(`${pending.approvals} approval(s) required`);
        if (inserted) parts.push(`${inserted} new finding(s)`);
        await emitCampaignNotification(sb, {
          workspaceId,
          eventKey: "marketing_operator_digest",
          summary: `Daily marketing check: ${parts.join(", ")}.`,
          kpis: {
            new_findings: inserted,
            completed_actions_24h: pending.completed24h,
            approvals_required: pending.approvals,
            autopilot_executed: autopilot.executed,
            outcomes_measured: sweep.measured,
          },
          recommendedAction: pending.approvals
            ? "Review and Approve & Execute pending actions in the Action Centre."
            : "Review new findings in the Marketing Operator panel.",
          severity: pending.approvals ? "warning" : "info",
        });
      }

      report.ran.push({ workspaceId, findings: inserted, completed: pending.completed24h, approvals: pending.approvals, autopilot, measured: sweep.measured });
    } catch (err: any) {
      report.failed.push({ workspaceId, error: String(err?.message ?? err).slice(0, 300) });
    }
  }
  return report;
}
