// SERVER ONLY — never import from a client component.
// GrowthMind call-script performance intelligence.
// Analyses call/transcript data for growth signals: qualification, booking and
// positive-sentiment rates per agent, time-of-day breakdown, plus AI-extracted
// objection and opening-line patterns from a cost-bounded transcript sample.
// Results are cached in growthmind_script_analysis (server-write-only table).
//
// WBAH routing: WBAH workspaces read wbah_calls; standard workspaces read calls.
// Production agents are NEVER modified — recommendations flow through the
// existing GrowthMind proposal tables as drafts requiring approval.

import { isWbahWorkspaceId } from "@/lib/wbah-exclusion.shared";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// ── Types ──────────────────────────────────────────────────────────────────────

export type AgentScriptMetrics = {
  agentKey:       string;
  agentName:      string;
  total:          number;
  connected:      number;
  connectionRate: number;
  positive:       number;
  positiveRate:   number;
  qualified:      number;
  qualifiedRate:  number;
  booked:         number;
  bookingRate:    number;
  avgDurationSeconds: number;
  byHour:         Array<{ hour: number; calls: number; connected: number; positive: number; booked: number }>;
  bestHours:      number[];
};

export type CampaignScriptMetrics = Omit<AgentScriptMetrics, "agentKey" | "agentName"> & {
  campaignKey:  string;
  campaignName: string;
};

export type ScriptPatterns = {
  openingLines: Array<{ line: string; agent: string | null; quality: "strong" | "weak" | "neutral"; note: string }>;
  objections:   Array<{ objection: string; frequency: "common" | "occasional" | "rare"; suggestedResponse: string }>;
  insights:     string[];
};

export type ScriptAnalysis = {
  id:            string | null;
  source:        "standard" | "wbah";
  periodStart:   string;
  periodEnd:     string;
  timezone:      string;
  sampleSize:    number;
  analyzedTranscripts: number;
  aiStatus:      "ok" | "skipped" | "failed";
  totals: {
    calls: number; connected: number; positiveRate: number;
    qualifiedRate: number; bookingRate: number;
  };
  agents:        AgentScriptMetrics[];
  campaigns:     CampaignScriptMetrics[];
  patterns:      ScriptPatterns | null;
  computedAt:    string;
};

const CACHE_TTL_MS      = 6 * 60 * 60 * 1000; // 6h
const ANALYSIS_DAYS     = 30;
const MAX_TRANSCRIPTS   = 18;      // cost bound: single AI call over a sample
const TRANSCRIPT_CHARS  = 1400;    // per-transcript truncation
const PAGE              = 1000;
const MAX_PAGES         = 15;

// ── Fetchers ───────────────────────────────────────────────────────────────────

async function fetchStandardRows(sb: any, workspaceId: string, startIso: string) {
  const rows: any[] = [];
  for (let p = 0; p < MAX_PAGES; p++) {
    const { data, error } = await sb
      .from("calls")
      .select("id, agent_id, agent_name, call_status, call_successful, sentiment, is_voicemail, in_voicemail, duration_seconds, disconnection_reason, created_at, started_at, lead_id")
      .eq("workspace_id", workspaceId)
      .gte("created_at", startIso)
      .order("created_at", { ascending: false })
      .range(p * PAGE, p * PAGE + PAGE - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as any[];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }
  return rows;
}

async function fetchWbahRows(sb: any, workspaceId: string, startIso: string) {
  const rows: any[] = [];
  for (let p = 0; p < MAX_PAGES; p++) {
    const { data, error } = await sb
      .from("wbah_calls")
      .select("id, agent_name, call_status, sentiment, duration_seconds, booking_status, appointment_date, disconnection_reason, end_reason, started_at, meta")
      .eq("workspace_id", workspaceId)
      .gte("started_at", startIso)
      .order("started_at", { ascending: false })
      .range(p * PAGE, p * PAGE + PAGE - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as any[];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }
  return rows;
}

// ── Classification helpers ─────────────────────────────────────────────────────

function isWbahVoicemail(c: any): boolean {
  const r = String(c.disconnection_reason ?? c.end_reason ?? "").toLowerCase();
  return r.includes("voicemail");
}

function isWbahConnected(c: any): boolean {
  if (isWbahVoicemail(c)) return false;
  const st = String(c.call_status ?? "").toLowerCase();
  return st === "completed" || st === "answered" || st === "connected" || st === "ended";
}

function isStandardConnected(c: any): boolean {
  if (c.is_voicemail === true || c.in_voicemail === true) return false;
  return c.call_status === "completed";
}

function hourIn(tz: string, iso: string | null): number | null {
  if (!iso) return null;
  try {
    const h = new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: tz }).format(new Date(iso));
    const n = parseInt(h, 10);
    return Number.isFinite(n) ? n % 24 : null;
  } catch { return null; }
}

function rate(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;
}

// ── Aggregation ────────────────────────────────────────────────────────────────

type Bucket = {
  agentName: string;
  total: number; connected: number; positive: number; qualified: number; booked: number;
  durationSum: number;
  byHour: Map<number, { calls: number; connected: number; positive: number; booked: number }>;
};

function newBucket(agentName: string): Bucket {
  return { agentName, total: 0, connected: 0, positive: 0, qualified: 0, booked: 0, durationSum: 0, byHour: new Map() };
}

function finishBucket(key: string, b: Bucket): AgentScriptMetrics {
  const byHour = Array.from(b.byHour.entries())
    .map(([hour, v]) => ({ hour, ...v }))
    .sort((a, z) => a.hour - z.hour);
  const bestHours = byHour
    .filter(h => h.calls >= 3)
    .sort((a, z) => (z.connected + z.positive * 2 + z.booked * 3) / z.calls - (a.connected + a.positive * 2 + a.booked * 3) / a.calls)
    .slice(0, 3)
    .map(h => h.hour);
  return {
    agentKey: key,
    agentName: b.agentName,
    total: b.total,
    connected: b.connected,
    connectionRate: rate(b.connected, b.total),
    positive: b.positive,
    positiveRate: rate(b.positive, b.connected || b.total),
    qualified: b.qualified,
    qualifiedRate: rate(b.qualified, b.connected || b.total),
    booked: b.booked,
    bookingRate: rate(b.booked, b.total),
    avgDurationSeconds: b.connected > 0 ? Math.round(b.durationSum / b.connected) : 0,
    byHour,
    bestHours,
  };
}

function aggregate(
  rows: any[],
  source: "standard" | "wbah",
  tz: string,
  resolveCampaign?: (c: any) => { key: string; name: string } | null,
) {
  const byAgent = new Map<string, Bucket>();
  const byCampaign = new Map<string, Bucket>();
  let totalCalls = 0, totalConnected = 0, totalPositive = 0, totalQualified = 0, totalBooked = 0;

  for (const c of rows) {
    const key = source === "standard" ? String(c.agent_id ?? c.agent_name ?? "unknown") : String(c.agent_name ?? "unknown");
    const name = String(c.agent_name ?? key);
    let b = byAgent.get(key);
    if (!b) { b = newBucket(name); byAgent.set(key, b); }

    const camp = resolveCampaign ? resolveCampaign(c) : null;
    let cb: Bucket | null = null;
    if (camp) {
      cb = byCampaign.get(camp.key) ?? null;
      if (!cb) { cb = newBucket(camp.name); byCampaign.set(camp.key, cb); }
    }

    const connected = source === "wbah" ? isWbahConnected(c) : isStandardConnected(c);
    const s = String(c.sentiment ?? "").toLowerCase();
    const positive = connected && s === "positive";
    // Qualification proxy: standard = call_successful flag; WBAH = positive sentiment
    // (mirrors the WBAH pipeline derivation used elsewhere in the platform).
    const qualified = source === "wbah" ? positive : connected && c.call_successful === true;
    const booked = source === "wbah"
      ? Boolean(c.booking_status || c.appointment_date)
      : connected && c.call_successful === true; // standard bookings live in calendar_bookings — counted separately below

    b.total++; totalCalls++;
    if (cb) cb.total++;
    if (connected) {
      b.connected++; totalConnected++; b.durationSum += Number(c.duration_seconds ?? 0);
      if (cb) { cb.connected++; cb.durationSum += Number(c.duration_seconds ?? 0); }
    }
    if (positive)  { b.positive++;  totalPositive++;  if (cb) cb.positive++; }
    if (qualified) { b.qualified++; totalQualified++; if (cb) cb.qualified++; }
    if (source === "wbah" && booked) { b.booked++; totalBooked++; if (cb) cb.booked++; }

    const h = hourIn(tz, c.started_at ?? c.created_at ?? null);
    if (h !== null) {
      const tally = (target: Bucket) => {
        let e = target.byHour.get(h);
        if (!e) { e = { calls: 0, connected: 0, positive: 0, booked: 0 }; target.byHour.set(h, e); }
        e.calls++;
        if (connected) e.connected++;
        if (positive) e.positive++;
        if (source === "wbah" && booked) e.booked++;
      };
      tally(b);
      if (cb) tally(cb);
    }
  }

  return { byAgent, byCampaign, totalCalls, totalConnected, totalPositive, totalQualified, totalBooked };
}

// ── Campaign attribution ───────────────────────────────────────────────────────
//
// Standard workspaces: calls have no campaign_id column — campaigns own an
// agent (campaigns.agent_id), so a call is attributed to the most recently
// updated campaign using that agent. WBAH: reuse the platform's dialler
// attribution (same agent_id + nearest scheduled London slot).

async function buildCampaignResolver(
  sb: any,
  workspaceId: string,
  source: "standard" | "wbah",
): Promise<(c: any) => { key: string; name: string } | null> {
  if (source === "standard") {
    const { data } = await sb
      .from("campaigns")
      .select("id, name, agent_id, updated_at")
      .eq("workspace_id", workspaceId)
      .not("agent_id", "is", null)
      .order("updated_at", { ascending: false })
      .limit(200);
    const byAgentId = new Map<string, { key: string; name: string }>();
    for (const row of (data ?? []) as any[]) {
      if (row.agent_id && !byAgentId.has(row.agent_id)) {
        byAgentId.set(row.agent_id, { key: row.id, name: row.name ?? "Campaign" });
      }
    }
    return (c: any) => (c.agent_id ? byAgentId.get(String(c.agent_id)) ?? null : null);
  }

  // WBAH — dialler campaign snapshot + slot-based attribution.
  try {
    const { loadWbahCampaignSnapshot, attributeWbahCampaign } =
      await import("@/lib/integrations/webespokeEnterprise/wbah-campaign-reporting.server");
    const snapshot = await loadWbahCampaignSnapshot(sb);
    if (snapshot.length === 0) return () => null;
    return (c: any) => {
      const agentId = (c.meta as any)?.agent_id ?? null;
      const camp = attributeWbahCampaign(snapshot, agentId, c.started_at ?? null);
      return camp ? { key: camp.id, name: camp.name ?? "Campaign" } : null;
    };
  } catch {
    return () => null;
  }
}

function finishCampaignBucket(key: string, b: Bucket): CampaignScriptMetrics {
  const m = finishBucket(key, b);
  const { agentKey: _k, agentName: _n, ...rest } = m;
  return { ...rest, campaignKey: key, campaignName: b.agentName };
}

// ── AI transcript pattern extraction (cost-bounded, one call) ─────────────────

async function extractPatterns(
  sb: any,
  workspaceId: string,
  source: "standard" | "wbah",
  startIso: string,
): Promise<{ patterns: ScriptPatterns | null; analyzed: number; status: "ok" | "skipped" | "failed" }> {
  // Sample recent transcripts (small select — transcripts only for the sample)
  const table = source === "wbah" ? "wbah_calls" : "calls";
  const tsCol = source === "wbah" ? "started_at" : "created_at";
  const { data } = await sb
    .from(table)
    .select("id, agent_name, sentiment, transcript")
    .eq("workspace_id", workspaceId)
    .gte(tsCol, startIso)
    .not("transcript", "is", null)
    .neq("transcript", "")
    .order(tsCol, { ascending: false })
    .limit(MAX_TRANSCRIPTS * 3);

  const sample = ((data ?? []) as any[])
    .filter(r => String(r.transcript ?? "").trim().length > 80)
    .slice(0, MAX_TRANSCRIPTS);

  if (sample.length === 0) return { patterns: null, analyzed: 0, status: "skipped" };

  // Per-workspace key fallback mirrors the model router convention.
  const { data: ws } = await sb
    .from("workspace_settings")
    .select("openai_api_key, gemini_api_key, anthropic_api_key")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  const settings: Record<string, string> = {
    openai_api_key:    ws?.openai_api_key ?? "",
    gemini_api_key:    ws?.gemini_api_key ?? "",
    anthropic_api_key: ws?.anthropic_api_key ?? "",
  };
  const hasAnyKey = Boolean(
    process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY ||
    settings.openai_api_key || settings.gemini_api_key || settings.anthropic_api_key,
  );
  if (!hasAnyKey) return { patterns: null, analyzed: 0, status: "skipped" };

  const excerpts = sample.map((r, i) =>
    `--- CALL ${i + 1} (agent: ${r.agent_name ?? "unknown"}, sentiment: ${r.sentiment ?? "n/a"}) ---\n` +
    String(r.transcript).slice(0, TRANSCRIPT_CHARS)
  ).join("\n\n");

  const system = `You are GrowthMind, an AI CMO analysing AI-agent call transcripts for script performance. Extract concrete, actionable patterns. Return ONLY valid JSON with this exact shape:
{
  "openingLines": [{ "line": "verbatim or close paraphrase of the opening approach", "agent": "agent name or null", "quality": "strong"|"weak"|"neutral", "note": "why it works or fails" }],
  "objections": [{ "objection": "the customer objection pattern", "frequency": "common"|"occasional"|"rare", "suggestedResponse": "a better scripted response" }],
  "insights": ["short actionable insight", "..."]
}
Max 5 openingLines, 6 objections, 5 insights. Base everything strictly on the transcripts.`;

  try {
    const { routeGenerate } = await import("@/lib/growthmind/model-router.server");
    const result = await routeGenerate({
      system,
      user: `Analyse these ${sample.length} call transcripts:\n\n${excerpts}`,
      contentType: "script_performance_analysis",
      maxTokens: 1600,
      mode: "manual",
      provider: "openai",
      model: "gpt-4.1-mini",
      settings,
      workspaceId,
      sb,
    });
    const raw = result.text.replace(/^```(?:json)?/m, "").replace(/```$/m, "").trim();
    const parsed = JSON.parse(raw);
    const patterns: ScriptPatterns = {
      openingLines: Array.isArray(parsed.openingLines) ? parsed.openingLines.slice(0, 5).map((o: any) => ({
        line: String(o.line ?? ""), agent: o.agent ? String(o.agent) : null,
        quality: ["strong", "weak", "neutral"].includes(o.quality) ? o.quality : "neutral",
        note: String(o.note ?? ""),
      })) : [],
      objections: Array.isArray(parsed.objections) ? parsed.objections.slice(0, 6).map((o: any) => ({
        objection: String(o.objection ?? ""),
        frequency: ["common", "occasional", "rare"].includes(o.frequency) ? o.frequency : "occasional",
        suggestedResponse: String(o.suggestedResponse ?? ""),
      })) : [],
      insights: Array.isArray(parsed.insights) ? parsed.insights.slice(0, 5).map(String) : [],
    };
    return { patterns, analyzed: sample.length, status: "ok" };
  } catch {
    return { patterns: null, analyzed: 0, status: "failed" };
  }
}

// ── Cache read / main compute ──────────────────────────────────────────────────

function rowToAnalysis(row: any): ScriptAnalysis {
  const m = row.metrics ?? {};
  return {
    id:                  row.id,
    source:              row.source,
    periodStart:         row.period_start,
    periodEnd:           row.period_end,
    timezone:            m.timezone ?? "UTC",
    sampleSize:          row.sample_size ?? 0,
    analyzedTranscripts: row.analyzed_transcripts ?? 0,
    aiStatus:            row.ai_status ?? "skipped",
    totals:              m.totals ?? { calls: 0, connected: 0, positiveRate: 0, qualifiedRate: 0, bookingRate: 0 },
    agents:              m.agents ?? [],
    campaigns:           m.campaigns ?? [],
    patterns:            row.patterns && Object.keys(row.patterns).length > 0 ? row.patterns : null,
    computedAt:          row.computed_at,
  };
}

export async function getLatestScriptAnalysis(sb: any, workspaceId: string): Promise<ScriptAnalysis | null> {
  const { data } = await sb
    .from("growthmind_script_analysis")
    .select("id, source, period_start, period_end, metrics, patterns, sample_size, analyzed_transcripts, ai_status, computed_at")
    .eq("workspace_id", workspaceId)
    .order("computed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? rowToAnalysis(data) : null;
}

export async function computeScriptPerformance(
  sb: any,
  workspaceId: string,
  opts?: { force?: boolean },
): Promise<ScriptAnalysis> {
  // Serve fresh cache unless forced
  if (!opts?.force) {
    const cached = await getLatestScriptAnalysis(sb, workspaceId);
    if (cached && Date.now() - new Date(cached.computedAt).getTime() < CACHE_TTL_MS) return cached;
  }

  const isWbah = isWbahWorkspaceId(workspaceId);
  const source: "standard" | "wbah" = isWbah ? "wbah" : "standard";
  const tz = isWbah ? "Europe/London" : "UTC";
  const periodEnd = new Date();
  const periodStart = new Date(Date.now() - ANALYSIS_DAYS * 86400000);
  const startIso = periodStart.toISOString();

  const [rows, resolveCampaign] = await Promise.all([
    isWbah ? fetchWbahRows(sb, workspaceId, startIso) : fetchStandardRows(sb, workspaceId, startIso),
    buildCampaignResolver(sb, workspaceId, source),
  ]);

  const agg = aggregate(rows, source, tz, resolveCampaign);

  // Standard workspaces: bookings live in calendar_bookings (count only — booking
  // rate is computed against total calls in the same window).
  let totalBooked = agg.totalBooked;
  if (!isWbah) {
    const { count } = await sb
      .from("calendar_bookings")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .gte("created_at", startIso);
    totalBooked = count ?? 0;
  }

  const agents = Array.from(agg.byAgent.entries())
    .map(([key, b]) => finishBucket(key, b))
    .sort((a, z) => z.total - a.total)
    .slice(0, 25);

  const campaigns = Array.from(agg.byCampaign.entries())
    .map(([key, b]) => finishCampaignBucket(key, b))
    .sort((a, z) => z.total - a.total)
    .slice(0, 25);

  const { patterns, analyzed, status } = await extractPatterns(sb, workspaceId, source, startIso);

  const totals = {
    calls:         agg.totalCalls,
    connected:     agg.totalConnected,
    positiveRate:  rate(agg.totalPositive, agg.totalConnected || agg.totalCalls),
    qualifiedRate: rate(agg.totalQualified, agg.totalConnected || agg.totalCalls),
    bookingRate:   rate(totalBooked, agg.totalCalls),
  };

  const analysis: ScriptAnalysis = {
    id: null,
    source,
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    timezone: tz,
    sampleSize: agg.totalCalls,
    analyzedTranscripts: analyzed,
    aiStatus: status,
    totals,
    agents,
    campaigns,
    patterns,
    computedAt: new Date().toISOString(),
  };

  // Persist snapshot (server-write-only table → admin client) and prune old rows.
  try {
    const admin = supabaseAdmin as any;
    const { data: inserted } = await admin
      .from("growthmind_script_analysis")
      .insert({
        workspace_id: workspaceId,
        period_start: analysis.periodStart,
        period_end:   analysis.periodEnd,
        source,
        metrics:      { timezone: tz, totals, agents, campaigns },
        patterns:     patterns ?? {},
        sample_size:  agg.totalCalls,
        analyzed_transcripts: analyzed,
        ai_status:    status,
      })
      .select("id")
      .maybeSingle();
    if (inserted?.id) analysis.id = inserted.id;

    // Keep only the 5 most recent snapshots per workspace.
    const { data: old } = await admin
      .from("growthmind_script_analysis")
      .select("id")
      .eq("workspace_id", workspaceId)
      .order("computed_at", { ascending: false })
      .range(5, 50);
    const oldIds = (old ?? []).map((r: any) => r.id);
    if (oldIds.length > 0) {
      await admin.from("growthmind_script_analysis").delete().in("id", oldIds);
    }
  } catch { /* cache persistence is best-effort */ }

  // Executive bridge: surface conversion risk to HiveMind when there is a real
  // signal (enough volume + weak conversion), never on tiny samples.
  try {
    if (agg.totalCalls >= 50 && (totals.bookingRate < 5 || totals.positiveRate < 20)) {
      const { insertExecutiveEvent } = await import("@/lib/executives/executive-bridge.server");
      await insertExecutiveEvent(sb, workspaceId, {
        source: "growthmind",
        event_type: "script_conversion_risk",
        summary: `Call-script analysis (${agg.totalCalls} calls, 30d): booking rate ${totals.bookingRate}%, positive-sentiment rate ${totals.positiveRate}%. GrowthMind recommends reviewing the call script — a revision draft can be generated from the Script Performance page.`,
        severity: "warning",
      });
    } else if (agg.totalCalls >= 50 && status === "ok" && patterns && patterns.objections.length >= 3) {
      const { insertExecutiveEvent } = await import("@/lib/executives/executive-bridge.server");
      await insertExecutiveEvent(sb, workspaceId, {
        source: "growthmind",
        event_type: "script_objection_patterns",
        summary: `Call-script analysis found ${patterns.objections.length} recurring objection patterns across ${analyzed} sampled transcripts. Top objection: "${patterns.objections[0]?.objection ?? ""}". Script-revision proposals are available in GrowthMind → Script Performance.`,
        severity: "info",
      });
    }
  } catch { /* event publishing is best-effort */ }

  return analysis;
}

// ── Script recommendation → existing proposal flow (drafts-until-approval) ────

export async function generateScriptRecommendation(
  sb: any,
  workspaceId: string,
  input: { kind: "revision" | "ab_experiment"; agentKey?: string | null; campaignKey?: string | null },
): Promise<{ ok: boolean; proposalId?: string; title?: string; error?: string }> {
  const analysis = await getLatestScriptAnalysis(sb, workspaceId);
  if (!analysis || analysis.totals.calls === 0) {
    return { ok: false, error: "No script analysis available yet — run the analysis first." };
  }

  const campaign = input.campaignKey
    ? (analysis.campaigns ?? []).find(c => c.campaignKey === input.campaignKey) ?? null
    : null;

  const agent = input.agentKey
    ? analysis.agents.find(a => a.agentKey === input.agentKey) ?? null
    : campaign ? null : analysis.agents[0] ?? null;

  const p = analysis.patterns;
  const objectionBlock = p?.objections?.length
    ? p.objections.map(o => `• "${o.objection}" (${o.frequency}) → suggested response: ${o.suggestedResponse}`).join("\n")
    : "No AI-extracted objection patterns available.";
  const openingBlock = p?.openingLines?.length
    ? p.openingLines.map(o => `• [${o.quality}] "${o.line}"${o.agent ? ` (${o.agent})` : ""} — ${o.note}`).join("\n")
    : "No AI-extracted opening-line patterns available.";

  const scope = campaign
    ? `campaign "${campaign.campaignName}"`
    : agent ? `agent "${agent.agentName}"` : "all agents";
  const focus = campaign ?? agent;
  const stats = focus
    ? `${focus.total} calls, ${focus.connectionRate}% connected, ${focus.positiveRate}% positive, ${focus.qualifiedRate}% qualified, ${focus.bookingRate}% booked; best hours: ${focus.bestHours.map(h => `${h}:00`).join(", ") || "n/a"}`
    : `${analysis.totals.calls} calls, ${analysis.totals.positiveRate}% positive, ${analysis.totals.qualifiedRate}% qualified, ${analysis.totals.bookingRate}% booked`;

  const isAb = input.kind === "ab_experiment";
  const focusName = campaign?.campaignName ?? agent?.agentName ?? "Call Campaign";
  const title = isAb
    ? `A/B Script Experiment — ${focusName}`
    : `Script Revision — ${focusName}`;

  // Deterministic body (always available); AI enrichment is a bonus, not a dependency.
  let contentPlan = isAb
    ? `Variant A (control): current script unchanged.\nVariant B (challenger): revised opening + objection handling below.\n\nOpening-line findings:\n${openingBlock}\n\nObjection handling to add:\n${objectionBlock}\n\nProtocol: split call list 50/50 for 2 weeks, minimum 100 calls per variant. Success metric: booking rate; secondary: positive-sentiment rate. Apply the winner only after human approval.`
    : `Recommended script changes for ${scope}:\n\n1. Opening line — lead with the strongest observed pattern:\n${openingBlock}\n\n2. Objection handling — add scripted responses:\n${objectionBlock}\n\n3. Timing — concentrate call attempts in the best-performing hours (${(focus?.bestHours ?? []).map(h => `${h}:00`).join(", ") || "insufficient hourly data"}).\n\nApply changes via the agent builder only after approval — production agents are never modified automatically.`;

  // Optional AI-drafted revision text
  try {
    const { data: ws } = await sb
      .from("workspace_settings")
      .select("openai_api_key, gemini_api_key, anthropic_api_key")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    const settings: Record<string, string> = {
      openai_api_key: ws?.openai_api_key ?? "", gemini_api_key: ws?.gemini_api_key ?? "", anthropic_api_key: ws?.anthropic_api_key ?? "",
    };
    const hasKey = Boolean(process.env.OPENAI_API_KEY || settings.openai_api_key || process.env.GEMINI_API_KEY || settings.gemini_api_key || process.env.ANTHROPIC_API_KEY || settings.anthropic_api_key);
    if (hasKey && p) {
      const { routeGenerate } = await import("@/lib/growthmind/model-router.server");
      const result = await routeGenerate({
        system: `You are GrowthMind, an AI CMO. Draft a concrete ${isAb ? "A/B experiment challenger script section" : "call-script revision"} using the performance data and extracted patterns. Be specific and ready to paste into a script. Plain text, max 350 words.`,
        user: `Scope: ${scope}\nPerformance: ${stats}\n\nOpening lines observed:\n${openingBlock}\n\nObjections observed:\n${objectionBlock}\n\nInsights:\n${(p.insights ?? []).join("\n")}`,
        contentType: "script_revision_draft",
        maxTokens: 900,
        mode: "manual",
        provider: "openai",
        model: "gpt-4.1-mini",
        settings,
        workspaceId,
        sb,
      });
      if (result.text.trim().length > 50) {
        contentPlan = `${result.text.trim()}\n\n──────────\nEvidence basis:\n${contentPlan}`;
      }
    }
  } catch { /* deterministic body already set */ }

  const proposal = {
    workspace_id: workspaceId,
    title,
    reason: isAb
      ? `Structured A/B test to validate script improvements for ${scope} before any production change.`
      : `Call-script analysis of the last 30 days shows conversion can improve for ${scope}. Current: ${stats}.`,
    evidence: `30-day window (${analysis.sampleSize} calls, ${analysis.analyzedTranscripts} transcripts AI-analysed). ${stats}.`,
    audience: `Prospects called by ${scope}`,
    expected_outcome: isAb
      ? `A statistically grounded winner between current and revised script; expected 10–25% relative booking-rate lift if the challenger wins.`
      : `Improved booking rate (target: +2–5 points) and higher positive-sentiment rate from better opening and objection handling.`,
    budget_estimate: "No ad spend — script/setup time only",
    content_plan: contentPlan,
    video_plan: "n/a — voice call-script initiative",
    channels: ["AI Calling"],
    status: "draft",
    generated_at: new Date().toISOString(),
  };

  const { data: ins, error } = await sb
    .from("growthmind_campaign_proposals")
    .insert(proposal)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };

  // Approval-queue visibility (best-effort, matches existing proposal drafts)
  try {
    await sb.from("hivemind_actions").insert({
      workspace_id: workspaceId,
      action_type: "campaign_proposal",
      title: `${isAb ? "A/B Script Experiment" : "Script Revision"} Proposal: ${title}`,
      description: `GrowthMind generated a ${isAb ? "script A/B experiment" : "script revision"} draft from call-script performance analysis.\n\n${proposal.reason}\n\nNo production agent is modified until this is approved and applied manually.`,
      action_payload: { proposalId: ins?.id ?? null, kind: `script_${input.kind}`, agentKey: input.agentKey ?? null, campaignKey: input.campaignKey ?? null },
      status: "pending",
      proposed_by: "growthmind",
      sensitive: false,
    });
  } catch { /* queue item is best-effort */ }

  return { ok: true, proposalId: ins?.id ?? undefined, title };
}
