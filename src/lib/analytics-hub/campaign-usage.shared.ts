/**
 * Campaign minutes-used aggregation — pure, testable core.
 *
 * INVARIANTS (spec — do not weaken):
 *   • Real durations only: a call contributes duration_seconds ≥ 0 from the
 *     provider. No estimates, no placeholders.
 *   • Dedup: a provider call id (retell_call_id) is counted exactly once.
 *   • Attribution order: explicit campaign id on the call → unambiguous
 *     agent→campaign mapping (only when the agent belongs to exactly ONE
 *     campaign) → "Unassigned Campaign".
 *   • Reconciliation: sum(campaign minutes) + unassigned minutes ==
 *     workspace total minutes for the same call set (full precision
 *     internally; rounding only at display).
 *   • Costs are never invented: cost fields are only emitted when real
 *     cost data (cost_cents) exists on the counted calls.
 */

export interface UsageCallInput {
  /** Stable local row id. */
  id: string;
  /** Authoritative provider call id (dedup key when present). */
  providerCallId: string | null;
  campaignId: string | null;
  agentId: string | null;
  startedAt: string | null;
  durationSeconds: number | null;
  direction: "inbound" | "outbound" | null;
  classification: "connected" | "voicemail" | "failed" | "missed" | "other";
  sentiment: "positive" | "neutral" | "negative" | null;
  qualified: boolean;
  booked: boolean;
  costCents: number | null;
}

export interface UsageBucket {
  totalCalls: number;
  /** Calls counted that have NO provider duration (e.g. no-answer attempts). */
  missingDurationCalls: number;
  totalDurationSeconds: number;
  minutesUsed: number;
  connectedMinutes: number;
  voicemailMinutes: number;
  failedMinutes: number;
  inboundMinutes: number;
  outboundMinutes: number;
  averageDurationSeconds: number;
  longestCallSeconds: number;
  shortestValidCallSeconds: number | null;
  qualifiedMinutes: number;
  positiveMinutes: number;
  neutralMinutes: number;
  negativeMinutes: number;
  bookedMinutes: number;
  /** Real cost of counted calls (only from stored cost data); null when no cost data exists. */
  totalCostCents: number | null;
  costPerMinuteCents: number | null;
  /** Deterministic billed cost: minutes used × BILLING_RATE_GBP_PER_MINUTE. */
  rateCostGbp: number;
}

export interface CampaignUsageRow extends UsageBucket {
  campaignId: string | null; // null = Unassigned Campaign
  campaignName: string;
  /** Deleted campaigns keep their attributed minutes but are hidden from the table UI. */
  isDeleted?: boolean;
  percentageOfWorkspaceMinutes: number;
  minutesToday: number;
  minutesThisWeek: number;
  minutesThisMonth: number;
}

export const UNASSIGNED_CAMPAIGN = "Unassigned Campaign";

/**
 * Platform billing rate: £0.36 per minute of call time. Rate cost is a
 * deterministic derived figure (minutes × rate) — distinct from
 * totalCostCents, which is only real recorded provider cost.
 */
export const BILLING_RATE_GBP_PER_MINUTE = 0.36;

/** Rate-based cost in GBP (2dp) for a duration in seconds. */
export function rateCostGbpFor(totalDurationSeconds: number): number {
  return Math.round((totalDurationSeconds / 60) * BILLING_RATE_GBP_PER_MINUTE * 100) / 100;
}

export function roundMinutes(seconds: number): number {
  return Math.round((seconds / 60) * 100) / 100;
}

/** Deduplicate calls by provider call id (fallback: local row id). */
export function dedupeCalls(calls: UsageCallInput[]): UsageCallInput[] {
  const seen = new Set<string>();
  const out: UsageCallInput[] = [];
  for (const c of calls) {
    const key = c.providerCallId && c.providerCallId.trim() !== ""
      ? `p:${c.providerCallId}`
      : `l:${c.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

/**
 * Countable as a call: every deduped provider record counts, EXCEPT records
 * with a corrupt (negative / non-finite) duration. A null duration is a real
 * call attempt with no recorded duration (e.g. no-answer) — it counts as a
 * call and contributes 0 seconds, flagged via missingDurationCalls.
 */
export function isValidUsageCall(c: UsageCallInput): boolean {
  const d = c.durationSeconds;
  return d == null || (Number.isFinite(d) && d >= 0);
}

/**
 * Attribute a call to a campaign id (or null = unassigned).
 * `agentCampaigns` maps agentId → set of campaign ids using that agent; the
 * agent fallback only applies when the mapping is unambiguous (exactly one).
 */
export function attributeCall(
  c: UsageCallInput,
  knownCampaignIds: Set<string>,
  agentCampaigns: Map<string, Set<string>>,
): string | null {
  if (c.campaignId && knownCampaignIds.has(c.campaignId)) return c.campaignId;
  if (c.agentId) {
    const set = agentCampaigns.get(c.agentId);
    if (set && set.size === 1) return [...set][0];
  }
  return null;
}

function emptyBucket(): UsageBucket & { _durs: number[] } {
  return {
    totalCalls: 0, missingDurationCalls: 0, totalDurationSeconds: 0, minutesUsed: 0,
    connectedMinutes: 0, voicemailMinutes: 0, failedMinutes: 0,
    inboundMinutes: 0, outboundMinutes: 0,
    averageDurationSeconds: 0, longestCallSeconds: 0, shortestValidCallSeconds: null,
    qualifiedMinutes: 0, positiveMinutes: 0, neutralMinutes: 0, negativeMinutes: 0,
    bookedMinutes: 0, totalCostCents: null, costPerMinuteCents: null,
    rateCostGbp: 0,
    _durs: [],
  };
}

function addToBucket(b: ReturnType<typeof emptyBucket>, c: UsageCallInput) {
  const d = c.durationSeconds ?? 0;
  b.totalCalls += 1;
  if (c.durationSeconds == null) b.missingDurationCalls += 1;
  b.totalDurationSeconds += d;
  if (c.classification === "connected") b.connectedMinutes += d;
  else if (c.classification === "voicemail") b.voicemailMinutes += d;
  else if (c.classification === "failed") b.failedMinutes += d;
  if (c.direction === "inbound") b.inboundMinutes += d;
  else if (c.direction === "outbound") b.outboundMinutes += d;
  if (c.qualified) b.qualifiedMinutes += d;
  if (c.booked) b.bookedMinutes += d;
  if (c.sentiment === "positive") b.positiveMinutes += d;
  else if (c.sentiment === "neutral") b.neutralMinutes += d;
  else if (c.sentiment === "negative") b.negativeMinutes += d;
  if (d > b.longestCallSeconds) b.longestCallSeconds = d;
  if (d > 0 && (b.shortestValidCallSeconds == null || d < b.shortestValidCallSeconds)) {
    b.shortestValidCallSeconds = d;
  }
  if (c.costCents != null && Number.isFinite(c.costCents)) {
    b.totalCostCents = (b.totalCostCents ?? 0) + c.costCents;
  }
  b._durs.push(d);
}

function finalizeBucket(b: ReturnType<typeof emptyBucket>): UsageBucket {
  const valid = b._durs.filter((d) => d > 0);
  const avg = valid.length > 0 ? Math.round(valid.reduce((a, x) => a + x, 0) / valid.length) : 0;
  const minutes = b.totalDurationSeconds / 60;
  const { _durs, ...rest } = b;
  return {
    ...rest,
    minutesUsed: roundMinutes(b.totalDurationSeconds),
    connectedMinutes: roundMinutes(b.connectedMinutes),
    voicemailMinutes: roundMinutes(b.voicemailMinutes),
    failedMinutes: roundMinutes(b.failedMinutes),
    inboundMinutes: roundMinutes(b.inboundMinutes),
    outboundMinutes: roundMinutes(b.outboundMinutes),
    qualifiedMinutes: roundMinutes(b.qualifiedMinutes),
    positiveMinutes: roundMinutes(b.positiveMinutes),
    neutralMinutes: roundMinutes(b.neutralMinutes),
    negativeMinutes: roundMinutes(b.negativeMinutes),
    bookedMinutes: roundMinutes(b.bookedMinutes),
    averageDurationSeconds: avg,
    totalCostCents: b.totalCostCents != null ? Math.round(b.totalCostCents) : null,
    costPerMinuteCents: b.totalCostCents != null && minutes > 0
      ? Math.round(b.totalCostCents / minutes)
      : null,
    rateCostGbp: rateCostGbpFor(b.totalDurationSeconds),
  };
}

export interface AggregateInput {
  calls: UsageCallInput[];
  campaigns: { id: string; name: string; agentId?: string | null; status?: string | null }[];
  /** Optional extra agent→campaign mapping rows (e.g. campaign_reports history). */
  agentCampaignPairs?: { agentId: string; campaignId: string }[];
  now?: Date;
}

export interface UsageReconciliation {
  /** Σ campaign seconds + unassigned seconds (must equal workspaceSeconds). */
  attributedSeconds: number;
  workspaceSeconds: number;
  /** True when the attributed sum matches the workspace total exactly. */
  reconciled: boolean;
  /** Same identity check on call counts. */
  attributedCalls: number;
  workspaceCalls: number;
}

export interface UnassignedReasons {
  /** No campaign id on the call and no agent id at all. */
  noAgent: number;
  /** Agent known but mapped to zero campaigns. */
  agentNotInAnyCampaign: number;
  /** Agent mapped to more than one campaign (ambiguous — never guessed). */
  ambiguousAgent: number;
}

export interface CampaignUsageResult {
  campaigns: CampaignUsageRow[];
  unassigned: CampaignUsageRow;
  workspace: UsageBucket & { minutesToday: number; minutesThisWeek: number; minutesThisMonth: number };
  dedupedCallCount: number;
  excludedInvalidCount: number;
  /** Duplicate provider records removed before counting. */
  duplicatesRemoved: number;
  reconciliation: UsageReconciliation;
  unassignedReasons: UnassignedReasons;
}

function inWindow(iso: string | null, from: Date, to: Date): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return !isNaN(t) && t >= from.getTime() && t <= to.getTime();
}

function windowStarts(now: Date) {
  const today = new Date(now); today.setUTCHours(0, 0, 0, 0);
  const week = new Date(today);
  // ISO week: Monday start.
  const dow = (week.getUTCDay() + 6) % 7;
  week.setUTCDate(week.getUTCDate() - dow);
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { today, week, month };
}

/**
 * Aggregate deduped, valid calls into per-campaign usage rows + an
 * "Unassigned Campaign" row + workspace totals. Full precision internally;
 * two-decimal minutes at the edges.
 */
export function aggregateCampaignUsage(input: AggregateInput): CampaignUsageResult {
  const now = input.now ?? new Date();
  const deduped = dedupeCalls(input.calls);
  const valid = deduped.filter(isValidUsageCall);
  const excludedInvalidCount = deduped.length - valid.length;

  const knownIds = new Set(input.campaigns.map((c) => c.id));
  const agentCampaigns = new Map<string, Set<string>>();
  for (const c of input.campaigns) {
    if (!c.agentId) continue;
    const s = agentCampaigns.get(c.agentId) ?? new Set<string>();
    s.add(c.id);
    agentCampaigns.set(c.agentId, s);
  }
  for (const p of input.agentCampaignPairs ?? []) {
    if (!p.agentId || !p.campaignId || !knownIds.has(p.campaignId)) continue;
    const s = agentCampaigns.get(p.agentId) ?? new Set<string>();
    s.add(p.campaignId);
    agentCampaigns.set(p.agentId, s);
  }

  const nameById = new Map(input.campaigns.map((c) => [c.id, c.name]));
  const deletedById = new Map(input.campaigns.map((c) => [c.id, Boolean((c as any).isDeleted)]));
  const buckets = new Map<string | null, ReturnType<typeof emptyBucket>>();
  const windows = windowStarts(now);
  const windowSecs = new Map<string | null, { today: number; week: number; month: number }>();
  const wsBucket = emptyBucket();
  let wsToday = 0, wsWeek = 0, wsMonth = 0;

  const unassignedReasons: UnassignedReasons = { noAgent: 0, agentNotInAnyCampaign: 0, ambiguousAgent: 0 };

  for (const c of valid) {
    const cid = attributeCall(c, knownIds, agentCampaigns);
    if (cid == null) {
      if (!c.agentId) unassignedReasons.noAgent += 1;
      else {
        const s = agentCampaigns.get(c.agentId);
        if (s && s.size > 1) unassignedReasons.ambiguousAgent += 1;
        else unassignedReasons.agentNotInAnyCampaign += 1;
      }
    }
    const b = buckets.get(cid) ?? emptyBucket();
    addToBucket(b, c);
    buckets.set(cid, b);
    addToBucket(wsBucket, c);

    const d = c.durationSeconds ?? 0;
    const w = windowSecs.get(cid) ?? { today: 0, week: 0, month: 0 };
    if (inWindow(c.startedAt, windows.today, now)) { w.today += d; wsToday += d; }
    if (inWindow(c.startedAt, windows.week, now)) { w.week += d; wsWeek += d; }
    if (inWindow(c.startedAt, windows.month, now)) { w.month += d; wsMonth += d; }
    windowSecs.set(cid, w);
  }

  const workspaceFinal = finalizeBucket(wsBucket);
  const wsSeconds = workspaceFinal.totalDurationSeconds;

  const toRow = (cid: string | null): CampaignUsageRow => {
    const b = buckets.get(cid) ?? emptyBucket();
    const fin = finalizeBucket(b);
    const w = windowSecs.get(cid) ?? { today: 0, week: 0, month: 0 };
    return {
      ...fin,
      campaignId: cid,
      campaignName: cid ? (nameById.get(cid) ?? "Campaign") : UNASSIGNED_CAMPAIGN,
      isDeleted: cid ? (deletedById.get(cid) ?? false) : false,
      percentageOfWorkspaceMinutes: wsSeconds > 0
        ? Math.round((fin.totalDurationSeconds / wsSeconds) * 1000) / 10
        : 0,
      minutesToday: roundMinutes(w.today),
      minutesThisWeek: roundMinutes(w.week),
      minutesThisMonth: roundMinutes(w.month),
    };
  };

  const campaignRows = [...buckets.keys()]
    .filter((k): k is string => k != null)
    .map(toRow)
    .sort((a, b) => b.totalDurationSeconds - a.totalDurationSeconds);
  // Include zero-usage campaigns so the table shows every campaign in range.
  for (const c of input.campaigns) {
    if (!buckets.has(c.id)) campaignRows.push(toRow(c.id));
  }

  const unassignedRow = toRow(null);
  const attributedSeconds =
    campaignRows.reduce((a, r) => a + r.totalDurationSeconds, 0) + unassignedRow.totalDurationSeconds;
  const attributedCalls =
    campaignRows.reduce((a, r) => a + r.totalCalls, 0) + unassignedRow.totalCalls;

  return {
    campaigns: campaignRows,
    unassigned: unassignedRow,
    workspace: {
      ...workspaceFinal,
      minutesToday: roundMinutes(wsToday),
      minutesThisWeek: roundMinutes(wsWeek),
      minutesThisMonth: roundMinutes(wsMonth),
    },
    dedupedCallCount: valid.length,
    excludedInvalidCount,
    duplicatesRemoved: input.calls.length - deduped.length,
    reconciliation: {
      attributedSeconds,
      workspaceSeconds: wsSeconds,
      reconciled: attributedSeconds === wsSeconds && attributedCalls === workspaceFinal.totalCalls,
      attributedCalls,
      workspaceCalls: workspaceFinal.totalCalls,
    },
    unassignedReasons,
  };
}

// ── Usage-over-time series ────────────────────────────────────────────────────
export type UsageGranularity = "hour" | "day" | "week" | "month";

export function bucketKeyFor(iso: string, granularity: UsageGranularity): string | null {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  switch (granularity) {
    case "hour": return `${y}-${mo}-${day}T${String(d.getUTCHours()).padStart(2, "0")}:00`;
    case "day": return `${y}-${mo}-${day}`;
    case "week": {
      const monday = new Date(Date.UTC(y, d.getUTCMonth(), d.getUTCDate()));
      const dow = (monday.getUTCDay() + 6) % 7;
      monday.setUTCDate(monday.getUTCDate() - dow);
      return `${monday.getUTCFullYear()}-${String(monday.getUTCMonth() + 1).padStart(2, "0")}-${String(monday.getUTCDate()).padStart(2, "0")}`;
    }
    case "month": return `${y}-${mo}`;
  }
}

export function buildUsageSeries(
  calls: UsageCallInput[],
  granularity: UsageGranularity,
): { bucket: string; minutesUsed: number; calls: number; connectedMinutes: number }[] {
  const map = new Map<string, { secs: number; calls: number; connSecs: number }>();
  for (const c of dedupeCalls(calls)) {
    if (!isValidUsageCall(c) || !c.startedAt) continue;
    const key = bucketKeyFor(c.startedAt, granularity);
    if (!key) continue;
    const e = map.get(key) ?? { secs: 0, calls: 0, connSecs: 0 };
    e.secs += c.durationSeconds ?? 0;
    e.calls += 1;
    if (c.classification === "connected") e.connSecs += c.durationSeconds ?? 0;
    map.set(key, e);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([bucket, e]) => ({
      bucket,
      minutesUsed: roundMinutes(e.secs),
      calls: e.calls,
      connectedMinutes: roundMinutes(e.connSecs),
    }));
}
