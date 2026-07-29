// ── Validated Business Briefing — server pipeline ─────────────────────────────
// Stages: gather → normalize → validate → verified KPIs → rank → recommend →
// voice + screen outputs from ONE shared object (see spec / shared module).
//
// This module NEVER fabricates figures: a rate with no denominator is omitted,
// missing financial data is reported as "not confirmed" (never £0), WBAH call
// data on error is reported unavailable (never silent zeros).

import {
  buildScreenSummary,
  buildVoiceSummary,
  countMetric,
  joinNatural,
  rateMetric,
  ratePct,
  sentimentUnknownCount,
  validateCallBreakdown,
  type DataWarning,
  type RecommendedBriefingAction,
  type UnverifiedMetric,
  type ValidatedBusinessBriefing,
  type VerifiedMetric,
  type CommercialRisk,
  type SourceFreshness,
} from "@/lib/hivemind/validated-briefing.shared";

/**
 * Build the validated briefing object for a workspace.
 * `platformData` is the return of fetchFullPlatformData — pass it in when the
 * caller already fetched it (morning briefing); otherwise it is fetched here
 * (stored briefing generator / scheduler).
 */
export async function buildValidatedBusinessBriefing(
  sb: any,
  workspaceId: string,
  platformData?: any,
): Promise<ValidatedBusinessBriefing> {
  let d = platformData;
  if (!d) {
    const { fetchFullPlatformData } = await import("@/lib/hivemind/hivemind.ai");
    d = await fetchFullPlatformData(sb, workspaceId);
  }

  const now = new Date();
  const isWbah: boolean = !!d.leads?.isWbah;
  const timezone = isWbah ? "Europe/London" : "server-local";
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);

  const verified: VerifiedMetric[] = [];
  const unverified: UnverifiedMetric[] = [];
  const warnings: DataWarning[] = [];
  const positives: string[] = [];
  const risks: CommercialRisk[] = [];
  const actions: RecommendedBriefingAction[] = [];
  const dataSources = new Set<string>();

  // ── Source freshness (from the data-health layer, honest degradation) ──────
  const sourceFreshness: SourceFreshness[] = ((d.dataHealth?.sources ?? []) as any[]).map((s) => ({
    source: s.source,
    status: s.status,
    lastActivityAt: s.lastActivityAt ?? null,
  }));
  for (const s of (d.dataHealth?.sources ?? []) as any[]) {
    if (s.status === "degraded") {
      warnings.push({
        code: `source_degraded_${s.source}`,
        severity: "warning",
        message: `The ${s.source} data source is degraded (${String(s.detail ?? "").slice(0, 120)}) — related figures may be incomplete.`,
      });
    }
  }

  // ── Calls (today) ───────────────────────────────────────────────────────────
  let connectedToday: number | null = null;
  let qualifiedToday: number | null = null;
  let totalCallsToday: number | null = null;

  if (isWbah) {
    const wc = d.wbahCalls;
    dataSources.add("wbah_calls (Supabase)");
    if (wc && wc.status === "ok") {
      const src = "wbah_calls";
      const range = "today (Europe/London)";
      totalCallsToday = wc.totalToday;
      connectedToday = wc.connectedToday;
      qualifiedToday = wc.qualifiedToday;

      verified.push(countMetric({ key: "calls_today", label: "Calls today", value: wc.totalToday, source: src, timeRange: range, note: "all outcomes" }));
      verified.push(countMetric({ key: "calls_month", label: "Calls this month", value: wc.monthTotal, source: src, timeRange: "this month (Europe/London)" }));

      const conn = rateMetric({ key: "connection_rate", label: "Connection rate", numerator: wc.connectedToday, denominator: wc.totalToday, formula: "connected (non-voicemail) ÷ total calls × 100", source: src, timeRange: range });
      if (conn) verified.push(conn);
      const vm = rateMetric({ key: "voicemail_rate", label: "Voicemail rate", numerator: wc.voicemailToday, denominator: wc.totalToday, formula: "voicemail outcomes ÷ total calls × 100", source: src, timeRange: range });
      if (vm) verified.push(vm);
      const qual = rateMetric({ key: "qualification_rate", label: "Qualification rate", numerator: wc.qualifiedToday, denominator: wc.connectedToday, formula: "qualified (positive sentiment) ÷ connected calls × 100", source: src, timeRange: range, note: "sentiment is a call classification, not a conversion" });
      if (qual) verified.push(qual);

      warnings.push(...validateCallBreakdown({ total: wc.totalToday, connected: wc.connectedToday, voicemail: wc.voicemailToday, failed: wc.failedToday, source: src }));

      const unknownSent = sentimentUnknownCount({ total: wc.totalToday, positive: wc.positiveToday, neutral: wc.neutralToday, negative: wc.negativeToday });
      if (unknownSent > 0) {
        warnings.push({ code: "sentiment_unclassified", severity: "info", message: `${unknownSent} of today's ${wc.totalToday} calls have no completed sentiment classification.` });
      }
      if (wc.stale) {
        warnings.push({ code: "wbah_calls_stale", severity: "warning", message: `Call data was last synced ${wc.newestSyncAt ?? "at an unknown time"} — today's figures may be delayed.` });
      }
      if (wc.totalToday > 0) positives.push(`the dialler handled ${wc.totalToday} calls today`);
      if (wc.qualifiedToday > 0) positives.push(`${wc.qualifiedToday} call${wc.qualifiedToday === 1 ? "" : "s"} qualified today`);
    } else {
      unverified.push({ key: "calls_today", label: "Call activity today", reason: "current WBAH call data is unavailable or delayed — no call count is being reported rather than a fabricated zero", source: "wbah_calls" });
      warnings.push({ code: "wbah_calls_unavailable", severity: "critical", message: "Current WBAH call activity is unavailable or delayed. Call figures are excluded from this briefing." });
    }
  } else {
    const src = "calls table";
    dataSources.add("calls (Supabase)");
    totalCallsToday = d.today?.calls ?? 0;
    verified.push(countMetric({ key: "calls_today", label: "Calls today", value: totalCallsToday ?? 0, source: src, timeRange: `today (${timezone})` }));
    const succ = rateMetric({ key: "call_success_rate", label: "Call success rate", numerator: d.calls?.success ?? 0, denominator: d.calls?.total ?? 0, formula: "successful calls ÷ total calls × 100", source: src, timeRange: "last 60 days" });
    if (succ) verified.push(succ);
    unverified.push({ key: "voicemail_rate", label: "Voicemail rate", reason: "this data source does not record voicemail outcomes separately", source: src });
    if ((d.today?.calls ?? 0) > 0) positives.push(`${d.today.calls} call${d.today.calls === 1 ? "" : "s"} made today`);
  }

  // ── Leads: today's new vs historical total, clearly separated ──────────────
  dataSources.add(isWbah ? "wbah_calls-derived leads" : "leads (Supabase)");
  const leadSrc = isWbah ? "wbah_calls-derived leads" : "leads table";
  verified.push(countMetric({ key: "leads_new_today", label: "New leads today", value: d.today?.leads ?? 0, source: leadSrc, timeRange: `today (${timezone})` }));
  verified.push(countMetric({ key: "leads_total", label: "Total leads (all time)", value: d.leads?.total ?? 0, source: leadSrc, timeRange: "all time", note: "historical total — separate from today's new leads" }));
  verified.push(countMetric({ key: "leads_new_month", label: "New leads this month", value: d.month?.leads ?? 0, source: leadSrc, timeRange: "this month" }));

  const convRate = rateMetric({
    key: "lead_conversion_rate", label: "Lead conversion rate",
    numerator: d.leads?.sales ?? 0, denominator: d.leads?.total ?? 0,
    formula: "leads reaching sale_done/completed ÷ total leads × 100",
    source: leadSrc, timeRange: "all time",
  });
  if (convRate) verified.push(convRate);

  const sent = d.leads?.sentiment;
  if (sent && (sent.unknown ?? 0) > 0 && !isWbah) {
    warnings.push({ code: "lead_sentiment_unclassified", severity: "info", message: `${sent.unknown} of the sampled leads have no sentiment classification.` });
  }
  const sampleSize = d.leads?.sampleSize ?? 0;
  if (!isWbah && sampleSize > 0 && (d.leads?.total ?? 0) > sampleSize) {
    warnings.push({ code: "lead_sample_capped", severity: "info", message: `Lead breakdowns are estimated from a sample of ${sampleSize} of ${d.leads.total} leads; the totals themselves are exact.` });
  }
  if ((d.today?.leads ?? 0) > 0) positives.push(`${d.today.leads} new lead${d.today.leads === 1 ? "" : "s"} arrived today`);

  // ── Bookings ────────────────────────────────────────────────────────────────
  const bookingSrc = isWbah ? "wbah_calls appointment fields" : "calendar_bookings";
  dataSources.add(bookingSrc);
  const bookingsToday = d.today?.bookings ?? 0;
  verified.push(countMetric({ key: "bookings_today", label: "Bookings today", value: bookingsToday, source: bookingSrc, timeRange: `today (${timezone})` }));
  if (qualifiedToday !== null && qualifiedToday > 0) {
    const br = rateMetric({ key: "booking_rate", label: "Booking rate (of qualified calls)", numerator: bookingsToday, denominator: qualifiedToday, formula: "confirmed bookings ÷ qualified calls × 100", source: bookingSrc, timeRange: `today (${timezone})`, note: "denominator = qualified calls today" });
    if (br) verified.push(br);
  }
  if (bookingsToday > 0) positives.push(`${bookingsToday} booking${bookingsToday === 1 ? "" : "s"} confirmed today`);
  if ((d.month?.sales ?? 0) > 0) positives.push(`${d.month.sales} sale${d.month.sales === 1 ? "" : "s"} closed this month`);

  // ── Agents: total / deployed / draft / active split ────────────────────────
  dataSources.add("agents (Supabase)");
  const agentScores: any[] = d.agentScores ?? [];
  const deployedAgents = agentScores.filter((a) => a.deployed);
  const draftAgents = agentScores.filter((a) => !a.deployed);
  const activeAgents = agentScores.filter((a) => a.deployed && (a.callCount ?? 0) > 0);
  verified.push(countMetric({ key: "agents_total", label: "Agents in workspace", value: agentScores.length, source: "agents table", timeRange: "current" }));
  verified.push(countMetric({ key: "agents_deployed", label: "Deployed agents", value: deployedAgents.length, source: "agents table", timeRange: "current" }));
  verified.push(countMetric({ key: "agents_draft", label: "Draft (undeployed) agents", value: draftAgents.length, source: "agents table", timeRange: "current", note: draftAgents.length ? `drafts: ${draftAgents.slice(0, 5).map((a) => a.name).join(", ")}${draftAgents.length > 5 ? ` +${draftAgents.length - 5} more` : ""}` : undefined }));
  verified.push(countMetric({ key: "agents_active", label: "Agents actively receiving calls", value: activeAgents.length, source: "agents + calls tables", timeRange: "last 60 days" }));

  // ── Financials: NEVER report missing data as £0 ─────────────────────────────
  const inv = d.invoiceSales;
  if (inv && typeof inv.invoiceCount === "number") {
    dataSources.add("accountsmind_invoices");
    if (inv.invoiceCount > 0) {
      verified.push(countMetric({ key: "revenue_paid_month", label: "Paid invoice revenue this month", value: Math.round((inv.paidThisMonthCents ?? 0)) / 100, unit: inv.currency === "USD" ? "usd" : "gbp", source: "accountsmind_invoices (paid only)", timeRange: "this month" }));
      verified.push(countMetric({ key: "revenue_paid_total", label: "Paid invoice revenue (all time)", value: Math.round((inv.paidSalesCents ?? 0)) / 100, unit: inv.currency === "USD" ? "usd" : "gbp", source: "accountsmind_invoices (paid only)", timeRange: "all time" }));
    } else {
      unverified.push({ key: "revenue", label: "Revenue", reason: "no invoices exist in AccountsMind yet — revenue could not be confirmed from the currently connected data", source: "accountsmind_invoices" });
    }
  } else {
    unverified.push({ key: "revenue", label: "Revenue", reason: "financial performance could not be confirmed from the currently connected data", source: "AccountsMind" });
  }

  const costDollars = d.costs?.totalDollars ?? 0;
  const costMinutes = d.costs?.totalMinutes ?? 0;
  if (costDollars > 0 || costMinutes > 0) {
    dataSources.add("usage_events");
    verified.push(countMetric({ key: "ai_costs_30d", label: "AI usage costs (30d)", value: costDollars, unit: "usd", source: "usage_events", timeRange: "last 30 days" }));
    if ((d.month?.leads ?? 0) > 0 && (d.costs?.costPerLead ?? 0) > 0) {
      verified.push(countMetric({ key: "cost_per_lead", label: "Cost per lead this month", value: d.costs.costPerLead, unit: "usd", source: "usage_events ÷ new leads this month", timeRange: "this month" }));
    }
  } else {
    unverified.push({ key: "ai_costs", label: "AI usage costs", reason: "no usage cost records were returned for this period — this is either genuinely zero usage or cost tracking is not connected, so no figure is being reported", source: "usage_events" });
  }

  // ── Rank commercial risks + build specific recommendations ─────────────────
  let rank = 1;
  if (qualifiedToday !== null && qualifiedToday > 0 && bookingsToday === 0) {
    risks.push({ rank: rank++, title: "Qualified calls produced no bookings today", detail: `${qualifiedToday} call${qualifiedToday === 1 ? " was" : "s were"} marked qualified today but none produced a booking — the most important commercial issue right now.` });
    actions.push({
      id: "rec_qualified_followup",
      title: `Create an immediate follow-up queue for the ${qualifiedToday} qualified call${qualifiedToday === 1 ? "" : "s"}`,
      issue: `${qualifiedToday} qualified call${qualifiedToday === 1 ? "" : "s"} today with zero bookings.`,
      action: "Review each qualified conversation, confirm the booking function was offered correctly, and place every unbooked qualified lead into an immediate follow-up queue.",
      expectedOutcome: "Recovered bookings from already-qualified conversations within 24–48 hours.",
      approvalRequired: true,
      department: "HiveMind",
      successCheck: "Bookings recorded against these leads within 48 hours.",
    });
  }
  const criticalWarn = warnings.find((w) => w.severity === "critical" || w.code === "call_failed_overlap");
  if (criticalWarn) {
    risks.push({ rank: rank++, title: "Reporting discrepancy in call data", detail: criticalWarn.message });
    actions.push({
      id: "rec_investigate_reporting",
      title: "Investigate the conflicting call-outcome figures",
      issue: criticalWarn.message,
      action: "Trace whether failed attempts are counted separately or duplicated inside the connected/voicemail categories, and correct the reporting mapping.",
      expectedOutcome: "Call outcome categories reconcile exactly to the total.",
      approvalRequired: false,
      department: "SystemMind",
      successCheck: "Connected + voicemail + failed outcomes sum consistently to the call total.",
    });
  }
  if (isWbah && d.wbahCalls?.status === "ok" && d.wbahCalls.voicemailToday > 0 && d.wbahCalls.totalToday > 0) {
    const vmPct = ratePct(d.wbahCalls.voicemailToday, d.wbahCalls.totalToday);
    if (vmPct !== null && vmPct >= 40) {
      risks.push({ rank: rank++, title: "High voicemail rate", detail: `${d.wbahCalls.voicemailToday} of ${d.wbahCalls.totalToday} calls (${vmPct}%) went to voicemail today.` });
      actions.push({
        id: "rec_retry_voicemails",
        title: "Retry voicemail outcomes during alternative calling windows",
        issue: `${vmPct}% of today's calls reached voicemail.`,
        action: "Schedule a retry pass for today's voicemail outcomes in a different calling window (e.g. early evening), and activate an SMS/WhatsApp follow-up where consent permits.",
        expectedOutcome: "Higher human connection rate on the retry pass.",
        approvalRequired: true,
        department: "HiveMind",
        successCheck: "Connection rate on retried numbers exceeds today's rate.",
      });
    }
  }
  if ((d.leads?.idle ?? 0) > 5) {
    risks.push({ rank: rank++, title: "Idle pipeline", detail: `${d.leads.idle} active leads have had no activity for 14+ days.` });
    actions.push({
      id: "rec_idle_reengagement",
      title: `Launch a re-engagement sequence for the ${d.leads.idle} idle leads`,
      issue: `${d.leads.idle} active leads untouched for 14+ days.`,
      action: "Enrol the idle leads into an email/WhatsApp re-engagement sequence with a call-back offer.",
      expectedOutcome: "A portion of the idle pipeline re-activated into calls or bookings.",
      approvalRequired: true,
      department: "GrowthMind",
      successCheck: "Idle-lead count falls and replies/bookings are recorded from the sequence.",
    });
  }
  const stalled = (d.campaigns?.stats ?? []).filter((c: any) => c.stalled);
  if (stalled.length > 0) {
    risks.push({ rank: rank++, title: "Stalled campaigns", detail: `${stalled.length} campaign${stalled.length === 1 ? "" : "s"} (${stalled.slice(0, 2).map((c: any) => `"${c.name}"`).join(", ")}) active with zero completed calls.` });
    actions.push({
      id: "rec_review_stalled_campaigns",
      title: `Review the ${stalled.length} stalled campaign${stalled.length === 1 ? "" : "s"}`,
      issue: "Active campaigns with zero completed calls after 14+ days.",
      action: `Check lead lists, agent assignment and schedule for ${stalled.slice(0, 2).map((c: any) => `"${c.name}"`).join(" and ")}, then restart or archive.`,
      expectedOutcome: "Campaigns either producing calls again or removed from the active list.",
      approvalRequired: false,
      department: "HiveMind",
      successCheck: "Completed-call counts increase or the campaigns are archived.",
    });
  }
  const disconnected = Object.entries(d.systemHealth ?? {}).filter(([, v]) => !v).map(([k]) => k);
  if (disconnected.length > 0 && rank <= 4) {
    risks.push({ rank: rank++, title: "Disconnected integrations", detail: `${joinNatural(disconnected)} ${disconnected.length === 1 ? "is" : "are"} not connected.` });
  }
  if (draftAgents.length > 0 && deployedAgents.length === 0) {
    risks.push({ rank: rank++, title: "No agents deployed", detail: `All ${agentScores.length} agent${agentScores.length === 1 ? " is" : "s are"} still in draft — no calls can be handled.` });
  }

  // ── Assemble the single validated object ────────────────────────────────────
  const core = {
    workspaceId,
    generatedAt: now.toISOString(),
    reportingPeriod: { label: "today", from: todayStart.toISOString(), to: now.toISOString(), timezone },
    dataSources: [...dataSources],
    sourceFreshness,
    verifiedMetrics: verified,
    unverifiedMetrics: unverified,
    dataWarnings: warnings,
    positiveOutcomes: positives,
    commercialRisks: risks,
    recommendedActions: actions.slice(0, 5),
  };

  // ── Voice output (natural COO, no markdown, no long lists) ─────────────────
  const assessment = buildAssessmentSentence({ totalCallsToday, connectedToday, qualifiedToday, bookingsToday, leadsToday: d.today?.leads ?? 0, risks });
  const closing = actions.length >= 2
    ? `Should I start with the ${lowerNoun(actions[0].title)}, or would you rather I ${lowerFirstWord(actions[1].title)} first?`
    : actions.length === 1
      ? `Shall I go ahead and ${lowerFirstWord(actions[0].title)}?`
      : "Is there anything you'd like me to dig into?";

  const voiceSummary = buildVoiceSummary({
    assessment,
    wentWell: positives,
    underperformed: risks.slice(0, 2).map((r) => lowerFirstWord(`${r.title} — ${r.detail}`)),
    dataWarnings: warnings.filter((w) => w.severity !== "info").slice(0, 2).map((w) => w.message),
    topActions: actions.slice(0, 3).map((a) => a.title),
    closingQuestion: closing,
  });

  const screenSummary = buildScreenSummary(core);

  return { ...core, voiceSummary, screenSummary };
}

function lowerFirstWord(s: string): string {
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}
function lowerNoun(title: string): string {
  // "Create an immediate follow-up queue…" → "immediate follow-up queue…" — keeps the closing question natural.
  return lowerFirstWord(title.replace(/^(Create|Launch|Review|Investigate|Retry|Activate|Inspect)\s+(an?\s+|the\s+)?/i, ""));
}

function buildAssessmentSentence(args: {
  totalCallsToday: number | null;
  connectedToday: number | null;
  qualifiedToday: number | null;
  bookingsToday: number;
  leadsToday: number;
  risks: CommercialRisk[];
}): string {
  const { totalCallsToday, connectedToday, qualifiedToday, bookingsToday, leadsToday, risks } = args;
  if (totalCallsToday === null) {
    return "I can't verify today's call activity yet, so this briefing covers what I can confirm.";
  }
  if (totalCallsToday === 0 && leadsToday === 0) {
    return "It's been a quiet day so far — no calls or new leads recorded yet.";
  }
  const busy = totalCallsToday >= 50 ? "busy" : totalCallsToday >= 10 ? "steady" : "quiet";
  const weak = risks.length > 0 && bookingsToday === 0;
  const connectedPart = connectedToday !== null && totalCallsToday > 0
    ? ` — ${totalCallsToday} calls, ${connectedToday} reaching a person`
    : totalCallsToday > 0 ? ` — ${totalCallsToday} calls` : "";
  return weak
    ? `Today was ${busy}, but the results were weaker than the activity level suggests${connectedPart}${qualifiedToday ? ` and ${qualifiedToday} qualified` : ""}.`
    : `Today has been ${busy}${connectedPart}${bookingsToday ? `, with ${bookingsToday} booking${bookingsToday === 1 ? "" : "s"} confirmed` : ""}.`;
}

// ── Recommendation → hivemind_tasks (through the universal quality gate) ─────
export async function createBriefingRecommendationTask(
  sb: any,
  workspaceId: string,
  rec: RecommendedBriefingAction,
  opts?: { briefingId?: string | null; createdByUserId?: string | null },
): Promise<{ taskId: string }> {
  const { prepareMindTaskInsert, buildIntelligencePacket } = await import("@/lib/minds/intelligence-packet.server");

  const packet = buildIntelligencePacket({
    mind: "hivemind",
    objective: rec.title,
    intentSource: "validated_daily_briefing",
    instruction: rec.action,
    diagnosis: rec.issue,
    planSteps: [{ title: rec.action }],
    deliverables: [rec.expectedOutcome],
    successCriteria: [rec.successCheck],
    evidence: [{
      source: "validated_business_briefing",
      label: "Briefing recommendation",
      data: { recommendation_id: rec.id, briefing_id: opts?.briefingId ?? null, department: rec.department, approval_required: rec.approvalRequired },
    } as any],
    limitations: ["Proposed from the validated daily briefing — execution requires the normal approval workflow."],
  });

  const row = prepareMindTaskInsert({
    workspace_id: workspaceId,
    title: rec.title,
    description: `${rec.issue}\n\nProposed action: ${rec.action}\nExpected outcome: ${rec.expectedOutcome}\nSuccess check: ${rec.successCheck}\nDepartment: ${rec.department}`,
    status: "suggested",
    priority: rec.approvalRequired ? "high" : "medium",
    source: "briefing",
    trigger_type: "validated_briefing_recommendation",
    task_category: "informational",
    assigned_mind: "hivemind",
    metadata: { briefing_recommendation_id: rec.id, briefing_id: opts?.briefingId ?? null, department: rec.department },
  }, packet);

  const { data, error } = await sb.from("hivemind_tasks").insert(row).select("id").single();
  if (error) throw new Error(`Failed to create task from recommendation: ${error.message}`);
  return { taskId: data.id };
}
