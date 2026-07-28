/**
 * Campaign minutes-used aggregation — server fetch layer.
 *
 * Wraps the pure core in campaign-usage.shared.ts with workspace-scoped
 * fetching. Same invariants as analytics-hub.server.ts:
 *   • READ-ONLY, every query .eq("workspace_id", workspaceId).
 *   • WBAH branch reads wbah_calls + the WeeBespoke campaign snapshot
 *     (WBAH has no WEBEE campaigns); standard branch reads calls+campaigns.
 *   • Fail closed: errors → zeroed structure with `error`, never throw.
 *   • Bounded paged fetches; short in-process cache to avoid re-summing raw
 *     calls on every page load.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isWbahWorkspaceId } from "@/lib/wbah-exclusion.shared";
import {
  type AnalyticsFilters,
  type ResolvedRange,
  resolveDateRange,
} from "./analytics-hub.server";
import {
  type UsageCallInput,
  type UsageGranularity,
  type CampaignUsageResult,
  aggregateCampaignUsage,
  buildUsageSeries,
} from "./campaign-usage.shared";

type Sb = any;

const PAGE = 1000;
const MAX_PAGES = 25;

export interface CampaignUsageFilters extends AnalyticsFilters {
  direction?: "inbound" | "outbound" | null;
  callStatus?: string | null;
  sentiment?: "positive" | "neutral" | "negative" | null;
  qualifiedOnly?: boolean | null;
  granularity?: UsageGranularity | null;
}

export interface CampaignUsageData extends CampaignUsageResult {
  workspaceId: string;
  range: ResolvedRange;
  mode: "standard" | "wbah_dialler";
  series: { bucket: string; minutesUsed: number; calls: number; connectedMinutes: number }[];
  granularity: UsageGranularity;
  truncated: boolean;
  /** WBAH only: weak-id sync rows dropped at read time because a Retell row for the same call exists. */
  crossSourceDuplicatesExcluded: number;
  /** WBAH only: most recent sync timestamp among counted rows. */
  lastSyncedAt: string | null;
  error: string | null;
}

// ── Short in-process cache (per instance; usage data is read-heavy) ─────────
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; data: CampaignUsageData }>();
const inflight = new Map<string, Promise<CampaignUsageData>>();

function cacheKey(workspaceId: string, f: CampaignUsageFilters): string {
  return [
    "cu2", workspaceId, f.dateFilter ?? "30d", f.customStart ?? "", f.customEnd ?? "",
    f.campaignId ?? "", f.agentId ?? "", f.direction ?? "", f.callStatus ?? "",
    f.sentiment ?? "", f.qualifiedOnly ? "q" : "", f.granularity ?? "day",
  ].join("|");
}

function classifyStandard(c: any): UsageCallInput["classification"] {
  if (c.is_voicemail === true || c.in_voicemail === true || c.call_status === "voicemail") return "voicemail";
  if (c.call_status === "completed") return "connected";
  if (c.call_status === "no_answer" || c.call_status === "busy") return "missed";
  if (c.call_status === "failed") return "failed";
  return "other";
}

function classifyWbah(c: any): UsageCallInput["classification"] {
  const reason = String(c.disconnection_reason ?? c.end_reason ?? "").toLowerCase();
  if (reason.includes("voicemail")) return "voicemail";
  const st = String(c.call_status ?? "").toLowerCase();
  if (st === "completed" || st === "answered" || st === "connected") return "connected";
  if (st === "failed" || reason.includes("error")) return "failed";
  if (st.includes("no_answer") || st.includes("no-answer") || st === "busy") return "missed";
  return "other";
}

// ── Standard workspaces ───────────────────────────────────────────────────────
async function fetchStandardUsageCalls(
  sb: Sb, workspaceId: string, range: ResolvedRange, f: CampaignUsageFilters,
): Promise<{ calls: UsageCallInput[]; truncated: boolean }> {
  const rows: any[] = [];
  for (let p = 0; p < MAX_PAGES; p++) {
    let q = sb
      .from("calls")
      .select("id, retell_call_id, campaign_id, agent_id, call_type, call_status, call_successful, sentiment, is_voicemail, in_voicemail, duration_seconds, cost_cents, created_at, started_at")
      .eq("workspace_id", workspaceId)
      // Canonical reporting timestamp is started_at (call time), matching the
      // WBAH branch; rows that never started (no started_at) fall back to
      // created_at so pending/failed attempts still appear in their window.
      .or(
        `and(started_at.gte.${range.startIso},started_at.lte.${range.endIso}),` +
        `and(started_at.is.null,created_at.gte.${range.startIso},created_at.lte.${range.endIso})`,
      )
      .order("created_at", { ascending: false })
      .range(p * PAGE, p * PAGE + PAGE - 1);
    if (f.agentId) q = q.eq("agent_id", f.agentId);
    if (f.direction) q = q.eq("call_type", f.direction);
    if (f.callStatus) q = q.eq("call_status", f.callStatus);
    if (f.sentiment) q = q.eq("sentiment", f.sentiment);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as any[];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }
  const calls: UsageCallInput[] = rows.map((c) => ({
    id: String(c.id),
    providerCallId: c.retell_call_id ?? null,
    campaignId: c.campaign_id ?? null,
    agentId: c.agent_id ?? null,
    startedAt: c.started_at ?? c.created_at ?? null,
    durationSeconds: c.duration_seconds,
    direction: c.call_type === "inbound" ? "inbound" : c.call_type === "outbound" ? "outbound" : null,
    classification: classifyStandard(c),
    sentiment: (["positive", "neutral", "negative"].includes(c.sentiment) ? c.sentiment : null),
    qualified: c.call_successful === true,
    booked: false,
    costCents: c.cost_cents ?? null,
  }));
  const filtered = f.qualifiedOnly ? calls.filter((c) => c.qualified) : calls;
  return { calls: filtered, truncated: rows.length >= PAGE * MAX_PAGES };
}

// ── WBAH ──────────────────────────────────────────────────────────────────────
async function fetchWbahUsage(
  sb: Sb, workspaceId: string, range: ResolvedRange, f: CampaignUsageFilters,
): Promise<{
  calls: UsageCallInput[];
  campaigns: { id: string; name: string; agentId?: string | null }[];
  truncated: boolean;
  crossSourceDuplicatesExcluded: number;
  lastSyncedAt: string | null;
}> {
  const rows: any[] = [];
  for (let p = 0; p < MAX_PAGES; p++) {
    let q = sb
      .from("wbah_calls")
      .select("id, phone, sentiment, call_status, disconnection_reason, end_reason, booking_status, appointment_date, duration_seconds, started_at, synced_at, meta")
      .eq("workspace_id", workspaceId)
      .gte("started_at", range.startIso)
      .lte("started_at", range.endIso)
      .order("started_at", { ascending: false })
      .range(p * PAGE, p * PAGE + PAGE - 1);
    if (f.sentiment) q = q.eq("sentiment", f.sentiment);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as any[];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }

  // ── Cross-source dedup ────────────────────────────────────────────────────
  // Older syncs created weak-id rows (id not "call_…") for calls that ALSO
  // have an authoritative Retell row — same phone within a short window.
  // Count the Retell row once and drop the weak twin (read-time guard; the
  // durable cleanup lives in scripts/cleanup-wbah-weak-duplicates.mjs).
  const WEAK_DUP_WINDOW_MS = 600_000;
  const retellByPhone = new Map<string, number[]>();
  for (const r of rows) {
    if (typeof r.id === "string" && r.id.startsWith("call_") && r.phone) {
      const t = new Date(r.started_at ?? 0).getTime();
      if (!Number.isNaN(t)) {
        const arr = retellByPhone.get(String(r.phone)) ?? [];
        arr.push(t);
        retellByPhone.set(String(r.phone), arr);
      }
    }
  }
  let crossSourceDuplicatesExcluded = 0;
  const dedupedRows = rows.filter((r) => {
    if (typeof r.id === "string" && r.id.startsWith("call_")) return true;
    const times = r.phone ? retellByPhone.get(String(r.phone)) : undefined;
    if (!times || !r.started_at) return true;
    const t = new Date(r.started_at).getTime();
    if (Number.isNaN(t)) return true;
    const isDup = times.some((rt) => Math.abs(rt - t) <= WEAK_DUP_WINDOW_MS);
    if (isDup) crossSourceDuplicatesExcluded += 1;
    return !isDup;
  });

  let lastSyncedAt: string | null = null;
  for (const r of rows) {
    if (r.synced_at && (!lastSyncedAt || r.synced_at > lastSyncedAt)) lastSyncedAt = r.synced_at;
  }

  // Campaign attribution via the WeeBespoke campaign snapshot (agent + nearest
  // scheduled London call slot) — same rules as the dialler analytics view.
  // Deleted campaigns are INCLUDED for attribution: their historical calls
  // must stay attributed to them, not drift to a surviving same-agent
  // campaign or Unassigned.
  let snapshot: any[] = [];
  let attribute: ((agentId: any, startedAt: any) => any) | null = null;
  try {
    const mod = await import("@/lib/integrations/webespokeEnterprise/wbah-campaign-reporting.server");
    snapshot = await mod.loadWbahCampaignSnapshot(sb, { includeDeleted: true });
    if (snapshot.length > 0) {
      attribute = (agentId, startedAt) => mod.attributeWbahCampaign(snapshot, agentId, startedAt);
    }
  } catch { /* snapshot unavailable — everything lands in Unassigned */ }

  const calls: UsageCallInput[] = dedupedRows.map((c) => {
    const camp = attribute ? attribute((c.meta as any)?.agent_id ?? null, c.started_at) : null;
    const s = String(c.sentiment ?? "").toLowerCase();
    return {
      id: String(c.id),
      providerCallId: String(c.id), // wbah_calls id IS the provider call id
      campaignId: camp ? String(camp.id) : null,
      agentId: (c.meta as any)?.agent_id ?? null,
      startedAt: c.started_at ?? null,
      durationSeconds: c.duration_seconds,
      direction: "outbound", // WeeBespoke dialler is outbound-only
      classification: classifyWbah(c),
      sentiment: (["positive", "neutral", "negative"].includes(s) ? s : null) as any,
      qualified: s === "positive", // WBAH: qualified = positive sentiment
      booked: Boolean(c.booking_status || c.appointment_date),
      costCents: null, // no per-call cost data for WBAH — never invent
    };
  });
  const campaigns = snapshot.map((s: any) => ({
    id: String(s.id),
    name: `${String(s.name ?? "Campaign")}${s.is_deleted ? " (deleted)" : ""}`,
  }));
  const filtered = f.qualifiedOnly ? calls.filter((c) => c.qualified) : calls;
  return {
    calls: filtered,
    campaigns,
    truncated: rows.length >= PAGE * MAX_PAGES,
    crossSourceDuplicatesExcluded,
    lastSyncedAt,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────
export async function getCampaignUsageData(
  workspaceId: string,
  filters?: CampaignUsageFilters,
): Promise<CampaignUsageData> {
  const f = filters ?? {};
  const key = cacheKey(workspaceId, f);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;
  const running = inflight.get(key);
  if (running) return running;

  const p = computeCampaignUsage(workspaceId, f)
    .then((data) => {
      if (!data.error) cache.set(key, { at: Date.now(), data });
      return data;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** Invalidate the in-process usage cache for a workspace (call after syncs/corrections). */
export function invalidateCampaignUsageCache(workspaceId: string): void {
  for (const k of cache.keys()) {
    if (k.startsWith(`cu2|${workspaceId}|`)) cache.delete(k);
  }
}

async function computeCampaignUsage(
  workspaceId: string,
  f: CampaignUsageFilters,
): Promise<CampaignUsageData> {
  const sb = supabaseAdmin as any;
  const range = resolveDateRange(f);
  const granularity: UsageGranularity =
    f.granularity ?? (range.days <= 2 ? "hour" : range.days <= 62 ? "day" : range.days <= 200 ? "week" : "month");
  const isWbah = isWbahWorkspaceId(workspaceId);
  const empty: CampaignUsageData = {
    workspaceId, range, mode: isWbah ? "wbah_dialler" : "standard",
    campaigns: [], unassigned: null as any, workspace: null as any,
    dedupedCallCount: 0, excludedInvalidCount: 0, duplicatesRemoved: 0,
    reconciliation: {
      attributedSeconds: 0, workspaceSeconds: 0, reconciled: true,
      attributedCalls: 0, workspaceCalls: 0,
    },
    unassignedReasons: { noAgent: 0, agentNotInAnyCampaign: 0, ambiguousAgent: 0 },
    series: [], granularity, truncated: false,
    crossSourceDuplicatesExcluded: 0, lastSyncedAt: null, error: null,
  };
  try {
    if (isWbah) {
      const { calls, campaigns, truncated, crossSourceDuplicatesExcluded, lastSyncedAt } =
        await fetchWbahUsage(sb, workspaceId, range, f);
      const agg = aggregateCampaignUsage({ calls, campaigns });
      if (f.campaignId) {
        // Campaign-scoped view — tiles/unassigned/series reflect only the
        // selected campaign's calls (WBAH attribution is per-row already).
        const scoped = calls.filter((c) => c.campaignId === f.campaignId);
        const scopedAgg = aggregateCampaignUsage({ calls: scoped, campaigns });
        return {
          ...empty,
          ...scopedAgg,
          campaigns: agg.campaigns.filter((c) => c.campaignId === f.campaignId),
          series: buildUsageSeries(scoped, granularity),
          truncated,
          crossSourceDuplicatesExcluded,
          lastSyncedAt,
        };
      }
      return {
        ...empty,
        ...agg,
        series: buildUsageSeries(calls, granularity),
        truncated,
        crossSourceDuplicatesExcluded,
        lastSyncedAt,
      };
    }

    const [{ calls, truncated }, campaignsRes] = await Promise.all([
      fetchStandardUsageCalls(sb, workspaceId, range, f),
      sb.from("campaigns")
        .select("id, name, status, agent_id")
        .eq("workspace_id", workspaceId)
        .limit(500),
    ]);
    const campaigns = ((campaignsRes.data ?? []) as any[]).map((c) => ({
      id: String(c.id), name: String(c.name ?? "Campaign"),
      agentId: c.agent_id ? String(c.agent_id) : null, status: c.status ?? null,
    }));

    // calls.agent_id stores PROVIDER (Retell) agent ids while campaigns.agent_id
    // is the local agents-row uuid — resolve every campaign agent to its
    // provider ids so the unambiguous-agent fallback actually matches.
    const agentCampaignPairs: { agentId: string; campaignId: string }[] = [];
    const localAgentIds = [...new Set(campaigns.map((c) => c.agentId).filter(Boolean))] as string[];
    if (localAgentIds.length > 0) {
      const { data: agentRows } = await sb
        .from("agents")
        .select("id, retell_agent_id, settings")
        .eq("workspace_id", workspaceId)
        .in("id", localAgentIds);
      const stripPrefix = (s: string) => s.replace(/^(published_|draft_)/, "");
      for (const c of campaigns) {
        if (!c.agentId) continue;
        const a = ((agentRows ?? []) as any[]).find((r) => r.id === c.agentId);
        const keys = new Set<string>([c.agentId]);
        if (a?.retell_agent_id) keys.add(stripPrefix(String(a.retell_agent_id)));
        const dep = (a?.settings as any)?.deployedRetellAgentId;
        if (dep) keys.add(String(dep));
        for (const k of keys) agentCampaignPairs.push({ agentId: k, campaignId: c.id });
      }
    }

    const agg = aggregateCampaignUsage({ calls, campaigns, agentCampaignPairs });

    // Re-derive attribution for scoping (same rules as aggregate).
    const knownIds = new Set(campaigns.map((c) => c.id));
    const agentMap = new Map<string, Set<string>>();
    for (const p of agentCampaignPairs) {
      const s = agentMap.get(p.agentId) ?? new Set<string>();
      s.add(p.campaignId); agentMap.set(p.agentId, s);
    }
    const attributed = (c: UsageCallInput): string | null => {
      if (c.campaignId && knownIds.has(c.campaignId)) return c.campaignId;
      if (c.agentId) {
        const s = agentMap.get(c.agentId);
        if (s && s.size === 1) return [...s][0];
      }
      return null;
    };

    if (f.campaignId) {
      // Campaign-scoped view: tiles, unassigned and series all reflect ONLY
      // the selected campaign's calls (percentages stay workspace-relative
      // via the unscoped row list).
      const scoped = calls.filter((c) => attributed(c) === f.campaignId);
      const scopedAgg = aggregateCampaignUsage({ calls: scoped, campaigns, agentCampaignPairs });
      return {
        ...empty,
        ...scopedAgg,
        campaigns: agg.campaigns.filter((c) => c.campaignId === f.campaignId),
        unassigned: scopedAgg.unassigned,
        workspace: scopedAgg.workspace,
        series: buildUsageSeries(scoped, granularity),
        truncated,
      };
    }

    return {
      ...empty,
      ...agg,
      series: buildUsageSeries(calls, granularity),
      truncated,
    };
  } catch (err: any) {
    const agg = aggregateCampaignUsage({ calls: [], campaigns: [] });
    return { ...empty, ...agg, error: err?.message ?? "Campaign usage unavailable" };
  }
}
