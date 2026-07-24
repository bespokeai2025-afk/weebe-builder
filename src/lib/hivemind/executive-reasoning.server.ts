/**
 * HiveMind Executive OS — reasoning run orchestrator (Stage 2).
 *
 * Implements the executive reasoning pipeline over LOCAL data only:
 *   collect classified events → validate source freshness (data-health layer)
 *   → gather department signals (windowed, capped, WBAH split respected)
 *   → deterministic metrics/baselines + cross-department correlation rules
 *   → build evidence packages → multi-factor priority scoring
 *   → optional AI phrasing (structured output, validated — deterministic
 *     fallback on any failure; the AI can only re-word, never add evidence)
 *   → quality gate (validateExecRecDraft) + volume caps
 *   → dedup against open recommendations AND non-completed tasks
 *   → persist hivemind_recommendations + accountability-shaped hivemind_tasks
 *   → mark consumed events, schedule reassessment.
 *
 * INVARIANTS:
 *   • runExecutiveReasoning NEVER throws (reconciliation tick safety).
 *   • Every read/write is scoped by workspace_id (service-role client).
 *   • WBAH: never query the oversized `leads` table; no external API calls.
 *   • AI failure or vague AI output degrades to the deterministic draft.
 */
import {
  adjustConfidenceForFreshness,
  buildEvidencePackage,
  capExecRecDrafts,
  compareToBaseline,
  computePriorityScore,
  runCorrelationRules,
  timeWaitingFactor,
  validateExecRecDraft,
  OPEN_REC_STATES,
  type DepartmentSignals,
  type EvidenceSourceFreshness,
  type ExecConclusion,
  type ExecRecDraft,
  type PriorityFactors,
} from "./executive-reasoning.shared";

type Sb = any;

const DAY = 86_400_000;
const REASSESS_DAYS = 7;

export interface ReasoningRunResult {
  ok: boolean;
  eventsConsidered: number;
  conclusions: number;
  drafts: number;
  rejectedByGate: number;
  dedupedRecs: number;
  insertedRecs: number;
  insertedTasks: number;
  dedupedTasks: number;
  proposedFollowThroughs: number;
  error?: string;
}

// ── Department signal gathering (local tables only, windowed + capped) ────────

async function gatherSignals(
  sb: Sb,
  workspaceId: string,
  isWbah: boolean,
): Promise<DepartmentSignals> {
  const now = Date.now();
  const cur14 = new Date(now - 14 * DAY).toISOString();
  const prev14 = new Date(now - 28 * DAY).toISOString();

  const signals: DepartmentSignals = {};

  // System: failing providers + repeatedly failing workflows (7d).
  const [provRes, wfRes] = await Promise.all([
    sb.from("provider_settings")
      .select("provider_category, provider_name, status")
      .eq("workspace_id", workspaceId)
      .eq("status", "error")
      .limit(50),
    sb.from("workflow_runs")
      .select("workflow_id, workflow:workspace_workflows(name)")
      .eq("workspace_id", workspaceId)
      .eq("status", "failed")
      .gte("completed_at", new Date(now - 7 * DAY).toISOString())
      .limit(200),
  ]);
  const failedIntegrations = (provRes.data ?? []).map((p: any) => ({
    id: `${p.provider_category}:${p.provider_name}`,
    name: `${p.provider_category}:${p.provider_name}`,
  }));
  const wfCounts = new Map<string, { id: string; name: string; failures: number }>();
  for (const r of wfRes.data ?? []) {
    const id = String(r.workflow_id ?? "");
    if (!id) continue;
    const cur = wfCounts.get(id) ?? { id, name: r.workflow?.name ?? "workflow", failures: 0 };
    cur.failures++;
    wfCounts.set(id, cur);
  }
  signals.system = {
    failedIntegrations,
    failedWorkflows: [...wfCounts.values()],
    bookingIntegrationDown: failedIntegrations.some((f: { id: string }) => /cal|calendar|booking/i.test(f.id)),
  };

  // Growth + CRM: lead windows. WBAH split — derive from wbah_calls, never `leads`.
  if (isWbah) {
    const [curRes, prevRes] = await Promise.all([
      sb.from("wbah_calls").select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId).gte("started_at", cur14),
      sb.from("wbah_calls").select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId).gte("started_at", prev14).lt("started_at", cur14),
    ]);
    signals.growth = {
      leadVolumeCurrent: curRes.count ?? 0,
      leadVolumeBaseline: prevRes.count ?? 0,
      activeCampaigns: 0,
    };
    signals.crm = { qualifiedLeadsNoBooking: 0, staleLeads: 0, oldestStaleSinceIso: null };
    return signals;
  }

  const staleCutoff = new Date(now - 7 * DAY).toISOString();
  const [curCount, prevCount, curQual, prevQual, campRes, staleRes, oldestStaleRes] =
    await Promise.all([
      sb.from("leads").select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId).gte("created_at", cur14),
      sb.from("leads").select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId).gte("created_at", prev14).lt("created_at", cur14),
      sb.from("leads").select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId).in("status", ["interested", "qualified"])
        .gte("created_at", cur14),
      sb.from("leads").select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId).in("status", ["interested", "qualified"])
        .gte("created_at", prev14).lt("created_at", cur14),
      sb.from("campaigns").select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId).eq("status", "active"),
      sb.from("leads").select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId).eq("status", "need_to_call")
        .lt("updated_at", staleCutoff),
      sb.from("leads").select("updated_at")
        .eq("workspace_id", workspaceId).eq("status", "need_to_call")
        .lt("updated_at", staleCutoff)
        .order("updated_at", { ascending: true }).limit(1),
    ]);

  const volCur = curCount.count ?? 0;
  const volPrev = prevCount.count ?? 0;
  const qualCur = curQual.count ?? 0;
  const qualPrev = prevQual.count ?? 0;
  signals.growth = {
    leadVolumeCurrent: volCur,
    leadVolumeBaseline: volPrev,
    qualifiedRateCurrentPct: volCur > 0 ? Math.round((qualCur / volCur) * 1000) / 10 : undefined,
    qualifiedRateBaselinePct: volPrev > 0 ? Math.round((qualPrev / volPrev) * 1000) / 10 : undefined,
    activeCampaigns: campRes.count ?? 0,
  };

  // Qualified leads with no booking (bounded, mirrors exec-intelligence logic).
  let qualifiedNoBooking = 0;
  try {
    const s60 = new Date(now - 60 * DAY).toISOString();
    const [qleadsRes, bookingsRes] = await Promise.all([
      sb.from("leads").select("id")
        .eq("workspace_id", workspaceId).in("status", ["interested", "qualified"])
        .gte("created_at", s60).limit(300),
      sb.from("calendar_bookings").select("lead_id,status")
        .eq("workspace_id", workspaceId).gte("created_at", s60)
        .not("lead_id", "is", null).limit(500),
    ]);
    const booked = new Set(
      (bookingsRes.data ?? [])
        .filter((b: any) => !["cancelled", "canceled", "rejected", "declined"].includes(String(b.status ?? "").toLowerCase()))
        .map((b: any) => b.lead_id),
    );
    qualifiedNoBooking = (qleadsRes.data ?? []).filter((l: any) => !booked.has(l.id)).length;
  } catch { /* signal stays 0 — rules simply don't fire */ }

  signals.crm = {
    qualifiedLeadsNoBooking: qualifiedNoBooking,
    staleLeads: staleRes.count ?? 0,
    oldestStaleSinceIso: oldestStaleRes.data?.[0]?.updated_at ?? null,
  };

  return signals;
}

// ── Deterministic issue findings (beyond correlation rules) ──────────────────

function deterministicFindings(
  workspaceId: string,
  s: DepartmentSignals,
  freshness: EvidenceSourceFreshness[],
): ExecConclusion[] {
  const out: ExecConclusion[] = [];
  const crm = s.crm ?? {};
  const g = s.growth ?? {};

  // Stale-lead backlog with waiting-time factor.
  if ((crm.staleLeads ?? 0) >= 5) {
    const waiting = timeWaitingFactor(crm.oldestStaleSinceIso, 21);
    out.push({
      ruleKey: "stale_lead_backlog",
      department: "crm",
      title: `${crm.staleLeads} leads have waited 7+ days without a first call`,
      business_issue:
        `${crm.staleLeads} leads are still at "need to call" and have not been touched for over 7 days` +
        (crm.oldestStaleSinceIso ? `; the oldest has waited since ${crm.oldestStaleSinceIso.slice(0, 10)}.` : "."),
      recommended_action:
        `Assign the ${crm.staleLeads} untouched leads to an owner today and start the standard call-and-email recovery sequence, oldest first.`,
      next_step: "Open the leads list filtered to status \"need to call\", sorted by last update ascending.",
      risk_of_inaction: "Lead intent decays daily — conversion probability drops sharply after the first week.",
      commercial_impact: null,
      metrics: { staleLeads: crm.staleLeads ?? 0, daysWaitingFactor: Math.round(waiting * 100) / 100 },
      relatedEntities: [],
      sourceSystems: ["leads"],
      factors: {
        pipelineImpact: 0.6, revenueImpact: 0.4, urgency: 0.5 + waiting * 0.3,
        timeWaiting: waiting, confidence: 0.85, riskOfInaction: 0.6,
      },
      correlation_key: "crm:stale_lead_backlog",
    });
  }

  // Lead volume decline vs baseline.
  const vol = compareToBaseline(g.leadVolumeCurrent ?? 0, g.leadVolumeBaseline ?? 0, { anomalyPct: 30, minBaseline: 10 });
  if (vol.direction === "down" && vol.anomalous) {
    out.push({
      ruleKey: "lead_volume_drop",
      department: "growth",
      title: `Lead volume down ${Math.abs(vol.deltaPct ?? 0)}% versus the previous 14 days`,
      business_issue:
        `${vol.current} leads arrived in the last 14 days versus ${vol.baseline} in the preceding window — a ${Math.abs(vol.deltaPct ?? 0)}% decline.`,
      recommended_action:
        "Review the top-of-funnel channels that produced the previous window's volume and restore the paused or underperforming source before pipeline thins further.",
      next_step: "Compare lead sources for the two 14-day windows in GrowthMind Forecast.",
      risk_of_inaction: "A thinner top of funnel now becomes a revenue gap next month.",
      commercial_impact: null,
      metrics: { leadVolumeCurrent: vol.current, leadVolumeBaseline: vol.baseline, deltaPct: vol.deltaPct ?? 0 },
      relatedEntities: [],
      sourceSystems: ["leads"],
      factors: { pipelineImpact: 0.7, revenueImpact: 0.5, urgency: 0.6, confidence: 0.8, riskOfInaction: 0.7 },
      correlation_key: "growth:lead_volume_drop",
    });
  }

  // Disconnected/degraded critical sources called out honestly.
  const broken = freshness.filter((f) => ["degraded", "disconnected"].includes(f.status));
  if (broken.length >= 2) {
    out.push({
      ruleKey: "data_sources_degraded",
      department: "system",
      title: `${broken.length} data sources are degraded or disconnected`,
      business_issue:
        `The following sources are not reporting healthy data: ${broken.map((b) => b.source).join(", ")}. Executive conclusions drawn from them are lower confidence until restored.`,
      recommended_action:
        `Reconnect or repair the affected integrations (${broken.map((b) => b.source).join(", ")}) so executive analysis regains full data coverage.`,
      next_step: "Open SystemMind integration health and re-run each failing connection check.",
      risk_of_inaction: "Decisions continue to be made on incomplete data.",
      commercial_impact: null,
      metrics: { degradedSources: broken.length, healthySources: freshness.length - broken.length },
      relatedEntities: broken.map((b) => ({ type: "data_source", id: b.source })),
      sourceSystems: broken.map((b) => b.source),
      factors: { operationalImpact: 0.6, urgency: 0.5, confidence: 0.9, riskOfInaction: 0.5 },
      correlation_key: "system:data_sources_degraded",
    });
  }

  return out;
}

// ── Conclusion → draft ────────────────────────────────────────────────────────

function conclusionToDraft(
  workspaceId: string,
  c: ExecConclusion,
  freshness: EvidenceSourceFreshness[],
  sourceEventIds: string[] = [],
): ExecRecDraft {
  const evidence = buildEvidencePackage({
    workspaceId,
    metrics: c.metrics,
    facts: { ruleKey: c.ruleKey },
    relatedEntities: c.relatedEntities,
    sourceSystems: c.sourceSystems,
    freshness,
  });
  const factors: PriorityFactors = { ...c.factors };
  const baseConfidence = factors.confidence ?? 0.7;
  const confidence = adjustConfidenceForFreshness(baseConfidence, evidence);
  factors.confidence = confidence;
  const scored = computePriorityScore(factors);
  const now = Date.now();
  return {
    title: c.title,
    department: c.department,
    priority: scored.priority,
    business_issue: c.business_issue,
    evidence,
    commercial_impact: c.commercial_impact,
    risk_of_inaction: c.risk_of_inaction,
    recommended_action: c.recommended_action,
    next_step: c.next_step,
    suggested_owner: null,
    due_date: new Date(now + (scored.priority === "critical" ? 1 : scored.priority === "high" ? 3 : 7) * DAY).toISOString(),
    approval_required: true,
    confidence,
    correlation_key: c.correlation_key,
    dedupe_key: `${c.ruleKey}:${new Date().toISOString().slice(0, 10)}`,
    reassess_at: new Date(now + REASSESS_DAYS * DAY).toISOString(),
    source_event_ids: sourceEventIds,
  };
}

// ── Optional AI phrasing (re-word only, never invent evidence) ────────────────

async function aiPhraseDraft(sb: Sb, workspaceId: string, draft: ExecRecDraft): Promise<ExecRecDraft> {
  const hasKey = !!(process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY);
  if (!hasKey) return draft;
  try {
    const { routeGenerate } = await import("@/lib/growthmind/model-router.server");
    const system =
      "You are an executive analyst. Rewrite the recommendation fields for clarity and business impact. " +
      "STRICT RULES: cite ONLY the numbers given in the evidence metrics — never invent figures. " +
      "Return ONLY JSON: {\"title\":string,\"business_issue\":string,\"recommended_action\":string,\"next_step\":string,\"risk_of_inaction\":string}. " +
      "recommended_action must be specific and at least 30 characters.";
    const user = JSON.stringify({
      title: draft.title,
      business_issue: draft.business_issue,
      recommended_action: draft.recommended_action,
      next_step: draft.next_step,
      risk_of_inaction: draft.risk_of_inaction,
      evidence_metrics: draft.evidence.metrics,
    });
    const res = await routeGenerate({
      system, user, contentType: "analysis", maxTokens: 700,
      mode: "smart", settings: {}, workspaceId, sb,
    });
    const jsonText = res.text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const parsed = JSON.parse(jsonText);
    const candidate: ExecRecDraft = {
      ...draft,
      title: typeof parsed.title === "string" && parsed.title.length >= 10 ? parsed.title.slice(0, 300) : draft.title,
      business_issue: typeof parsed.business_issue === "string" && parsed.business_issue.length >= 20 ? parsed.business_issue.slice(0, 2000) : draft.business_issue,
      recommended_action: typeof parsed.recommended_action === "string" && parsed.recommended_action.length >= 30 ? parsed.recommended_action.slice(0, 2000) : draft.recommended_action,
      next_step: typeof parsed.next_step === "string" && parsed.next_step.length >= 10 ? parsed.next_step.slice(0, 1000) : draft.next_step,
      risk_of_inaction: typeof parsed.risk_of_inaction === "string" && parsed.risk_of_inaction.length >= 10 ? parsed.risk_of_inaction.slice(0, 1000) : draft.risk_of_inaction,
    };
    // The rephrased draft must still pass the deterministic gate.
    return validateExecRecDraft(candidate) ? candidate : draft;
  } catch {
    return draft; // AI failure degrades honestly to the deterministic draft
  }
}

// ── Event-driven task candidates ──────────────────────────────────────────────

function eventDepartment(sourceSystem: string): string {
  if (/growth|campaign|gads/.test(sourceSystem)) return "growth";
  if (/system|workflow|provider|n8n/.test(sourceSystem)) return "system";
  if (/account|billing|invoice/.test(sourceSystem)) return "accounts";
  if (/lead|crm|calendar|booking|email/.test(sourceSystem)) return "crm";
  return "operations";
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function runExecutiveReasoning(
  sb: Sb,
  workspaceId: string,
  isWbah: boolean,
): Promise<ReasoningRunResult> {
  const out: ReasoningRunResult = {
    ok: true, eventsConsidered: 0, conclusions: 0, drafts: 0,
    rejectedByGate: 0, dedupedRecs: 0, insertedRecs: 0,
    insertedTasks: 0, dedupedTasks: 0, proposedFollowThroughs: 0,
  };
  let modeCfg: import("@/lib/hivemind/mode-gate.server").HiveMindModeConfig;
  try {
    // 0. Observe mode gate — HiveMind watches only; the reasoning engine must
    //    not write recommendations or tasks.
    try {
      const { getHiveMindModeConfig } = await import("@/lib/hivemind/mode-gate.server");
      modeCfg = await getHiveMindModeConfig(sb, workspaceId);
      if (modeCfg.mode === "observe") return out;
    } catch {
      // Fail CLOSED: if the gate cannot be evaluated, do not write anything.
      return out;
    }

    // 1-2. Collect classified events + source freshness.
    const [eventsRes, health] = await Promise.all([
      sb.from("hivemind_executive_events")
        .select("id, event_type, source_system, severity, classification, title, summary, entity_type, entity_id, evidence, occurred_at")
        .eq("workspace_id", workspaceId)
        .eq("processing_status", "classified")
        .in("classification", ["recommendation_candidate", "task_candidate", "warning", "critical"])
        .order("created_at", { ascending: true })
        .limit(100),
      (async () => {
        try {
          const { getWorkspaceDataHealth } = await import("@/lib/hivemind/data-health.server");
          return await getWorkspaceDataHealth(workspaceId, isWbah);
        } catch { return { computedAt: new Date().toISOString(), isWbah, sources: [] }; }
      })(),
    ]);
    const events: any[] = eventsRes.data ?? [];
    out.eventsConsidered = events.length;
    const freshness: EvidenceSourceFreshness[] = (health.sources ?? []).map((s: any) => ({
      source: s.source, status: s.status, lastActivityAt: s.lastActivityAt,
    }));

    // 3-7. Signals → deterministic metrics, correlations, findings.
    const signals = await gatherSignals(sb, workspaceId, isWbah);
    const conclusions = [
      ...runCorrelationRules(signals),
      ...deterministicFindings(workspaceId, signals, freshness),
    ];
    out.conclusions = conclusions.length;

    // 8-12. Build scored drafts with evidence packages.
    let drafts = conclusions.map((c) => conclusionToDraft(workspaceId, c, freshness));

    // Event-backed recommendation candidates (warning/critical/rec candidates
    // with enough numeric evidence become drafts too).
    for (const ev of events) {
      if (!["recommendation_candidate", "warning", "critical"].includes(ev.classification)) continue;
      const metrics: Record<string, number> = {};
      for (const [k, v] of Object.entries((ev.evidence ?? {}) as Record<string, unknown>)) {
        if (typeof v === "number" && Number.isFinite(v)) metrics[k] = v;
      }
      metrics.occurrences = (metrics.occurrences ?? 0) + 1;
      if (Object.keys(metrics).length < 2) continue; // no evidence → no recommendation
      const sev = String(ev.severity);
      const conclusion: ExecConclusion = {
        ruleKey: `event:${ev.event_type}:${ev.entity_id ?? "aggregate"}`,
        department: eventDepartment(String(ev.source_system)) as any,
        title: String(ev.title).slice(0, 300),
        business_issue: String(ev.summary ?? ev.title).slice(0, 2000),
        recommended_action:
          `Investigate and resolve "${String(ev.title).slice(0, 120)}" (${ev.source_system}); confirm the underlying ${ev.entity_type ?? "signal"} has recovered before closing.`,
        next_step: "Open the affected record and verify current status.",
        risk_of_inaction: sev === "critical"
          ? "A critical platform signal is unresolved — direct operational or revenue risk."
          : "The warning persists and can compound into a larger failure.",
        commercial_impact: null,
        metrics,
        relatedEntities: ev.entity_id ? [{ type: String(ev.entity_type ?? "entity"), id: String(ev.entity_id) }] : [],
        sourceSystems: [String(ev.source_system)],
        factors: sev === "critical"
          ? { operationalImpact: 0.8, revenueImpact: 0.8, urgency: 0.9, confidence: 0.85, riskOfInaction: 0.8 }
          : { operationalImpact: 0.5, urgency: 0.5, confidence: 0.75, riskOfInaction: 0.5 },
        correlation_key: `event:${ev.event_type}`,
      };
      drafts.push(conclusionToDraft(workspaceId, conclusion, freshness, [ev.id]));
    }

    // 13-15. AI phrasing (optional; validated; deterministic fallback), gate, caps.
    const phrased: ExecRecDraft[] = [];
    for (const d of drafts) phrased.push(await aiPhraseDraft(sb, workspaceId, d));
    const valid = phrased.filter(validateExecRecDraft);
    out.rejectedByGate = phrased.length - valid.length;
    const capped = capExecRecDrafts(valid);
    out.drafts = capped.length;

    // 16. Dedup against open recommendations (rule-level, ignoring the date
    // suffix) and existing non-completed tasks.
    const [openRecsRes, openTasksRes] = await Promise.all([
      sb.from("hivemind_recommendations")
        .select("dedupe_key")
        .eq("workspace_id", workspaceId)
        .in("status", OPEN_REC_STATES),
      sb.from("hivemind_tasks")
        .select("trigger_type, entity_id")
        .eq("workspace_id", workspaceId)
        .neq("status", "completed"),
    ]);
    const ruleOf = (key: string) => key.replace(/:\d{4}-\d{2}-\d{2}$/, "");
    const openRules = new Set((openRecsRes.data ?? []).map((r: any) => ruleOf(String(r.dedupe_key))));
    const openTasks = (openTasksRes.data ?? []) as Array<{ trigger_type: string | null; entity_id: string | null }>;

    const toInsert = capped.filter((d) => {
      if (openRules.has(ruleOf(d.dedupe_key))) { out.dedupedRecs++; return false; }
      return true;
    });

    // 16b. Learning loop: temper confidence by past outcome adjustments for
    // this department (bounded ±0.2, clamped to [0.05, 0.99]).
    if (toInsert.length) {
      try {
        const { getConfidenceAdjustment } = await import("@/lib/hivemind/action-learning.server");
        const deps = [...new Set(toInsert.map((d) => d.department))];
        const adjByDep = new Map<string, number>();
        for (const dep of deps) {
          adjByDep.set(dep, await getConfidenceAdjustment(sb, workspaceId, `rec:${dep}`));
        }
        for (const d of toInsert) {
          const adj = adjByDep.get(d.department) ?? 0;
          if (adj !== 0) {
            d.confidence = Math.max(0.05, Math.min(0.99, Number((d.confidence + adj).toFixed(3))));
          }
        }
      } catch { /* learning adjustments are best-effort */ }
    }

    // 17. Save recommendations.
    if (toInsert.length) {
      const rows = toInsert.map((d) => ({
        workspace_id: workspaceId,
        title: d.title,
        department: d.department,
        priority: d.priority,
        business_issue: d.business_issue,
        evidence: d.evidence,
        related_entities: d.evidence.relatedEntities,
        commercial_impact: d.commercial_impact,
        risk_of_inaction: d.risk_of_inaction,
        recommended_action: d.recommended_action,
        next_step: d.next_step,
        suggested_owner: d.suggested_owner,
        due_date: d.due_date,
        approval_required: d.approval_required,
        confidence: d.confidence,
        data_freshness: { computedAt: health.computedAt, sources: d.evidence.freshness },
        source_systems: d.evidence.sourceSystems,
        source_event_ids: d.source_event_ids,
        correlation_key: d.correlation_key,
        dedupe_key: d.dedupe_key,
        status: "new",
        source: "executive_reasoning",
        reassess_at: d.reassess_at,
      }));
      const { data: inserted, error } = await sb
        .from("hivemind_recommendations")
        .upsert(rows, { onConflict: "workspace_id,dedupe_key", ignoreDuplicates: true })
        .select("id");
      if (error) throw new Error(error.message);
      out.insertedRecs = inserted?.length ?? 0;
      out.dedupedRecs += rows.length - (inserted?.length ?? 0);

      // Assistant/operator modes: auto-propose the follow-through action for
      // each newly inserted recommendation. The engine only ever PROPOSES —
      // every action lands "pending" and executes solely through the
      // hivemind_actions approval pipeline (sensitive actions always need an
      // explicit human approval there). Recommend mode leaves follow-through
      // to the user via actOnExecutiveRecommendation.
      const insertedIds = (inserted ?? []).map((r: any) => r.id as string);
      if (insertedIds.length && (modeCfg.mode === "assistant" || modeCfg.mode === "operator" || modeCfg.mode === "executive_operator")) {
        try {
          const { proposeFollowThroughForRecommendation } =
            await import("@/lib/hivemind/executive-followthrough.server");
          const { data: fullRecs } = await sb
            .from("hivemind_recommendations")
            .select("id, workspace_id, title, department, priority, business_issue, recommended_action, next_step, dedupe_key, correlation_key, status, confidence")
            .eq("workspace_id", workspaceId)
            .in("id", insertedIds);
          for (const rec of (fullRecs ?? []) as any[]) {
            const res = await proposeFollowThroughForRecommendation(sb, workspaceId, rec, modeCfg, {
              isWbah, proposedBy: "executive_reasoning",
            });
            if (res.ok) out.proposedFollowThroughs++;
          }
        } catch { /* follow-through proposal is best-effort; reasoning output stands */ }
      }
    }

    // Task candidates → accountability-shaped hivemind_tasks (deduped).
    const taskEvents = events.filter((e) => e.classification === "task_candidate");
    const newTasks: any[] = [];
    for (const ev of taskEvents) {
      const dup = openTasks.some(
        (t) => t.trigger_type === ev.event_type && t.entity_id === String(ev.entity_id ?? ""),
      );
      if (dup) { out.dedupedTasks++; continue; }
      newTasks.push({
        workspace_id: workspaceId,
        title: String(ev.title).slice(0, 300),
        description: ev.summary ? String(ev.summary).slice(0, 2000) : null,
        status: "suggested",
        priority: ev.severity === "critical" ? "critical" : ev.severity === "warning" ? "high" : "medium",
        source: "executive_reasoning",
        trigger_type: ev.event_type,
        entity_type: ev.entity_type,
        entity_id: String(ev.entity_id ?? ""),
        entity_name: null,
        department: eventDepartment(String(ev.source_system)),
        reason: `Executive event "${ev.event_type}" from ${ev.source_system} on ${String(ev.occurred_at).slice(0, 10)}`,
        evidence: ev.evidence ?? {},
        reassess_at: new Date(Date.now() + REASSESS_DAYS * DAY).toISOString(),
        metadata: { source_event_id: ev.id },
      });
      openTasks.push({ trigger_type: ev.event_type, entity_id: String(ev.entity_id ?? "") });
    }
    // Row-by-row insert so the partial unique index
    // (workspace_id, trigger_type, entity_id WHERE status <> 'completed')
    // makes dedup atomic under concurrent runs: a 23505 conflict simply
    // counts as deduped instead of failing the run.
    for (const row of newTasks) {
      const { error } = await sb.from("hivemind_tasks").insert(row);
      if (!error) out.insertedTasks++;
      else if (error.code === "23505") out.dedupedTasks++;
      else throw new Error(error.message);
    }

    // 18-19. Mark events consumed (notification + reassessment happen on their
    // own layers: notifications are Stage-1 scope; reassess_at is stored).
    if (events.length) {
      await sb.from("hivemind_executive_events")
        .update({ processing_status: "consumed" })
        .in("id", events.map((e) => e.id))
        .eq("workspace_id", workspaceId)
        .eq("processing_status", "classified");
    }
  } catch (err: any) {
    out.ok = false;
    out.error = String(err?.message ?? err).slice(0, 500);
    console.warn("[exec-reasoning] run failed (non-fatal):", out.error);
  }
  return out;
}
