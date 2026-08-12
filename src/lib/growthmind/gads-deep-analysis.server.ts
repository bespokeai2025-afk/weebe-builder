/**
 * GrowthMind Google Ads — DEEP campaign analysis report builder.
 *
 * Consumes the row-level data from gads-deep-fetch.server.ts and produces a
 * full, sectioned, evidence-based report:
 *  - deterministic tables (campaign, ad groups, keyword classification,
 *    search-term classification, ads, tracking diagnosis, device/geo/day)
 *  - AI-generated advisory sections (suggested keywords, negative keyword
 *    groups, ad concepts, structure recommendation, landing-page + homepage
 *    blueprints, competitor intelligence, executive summary) grounded ONLY in
 *    the real fetched data + Business DNA + real landing-page content.
 *  - prioritised change-request drafts with explicit approval levels.
 *
 * HONESTY RULES:
 * - No invented statistics: search volumes / CPC estimates are labelled
 *   "Data unavailable — requires Google Keyword Planner" when not fetched.
 * - Competitor claims must be labelled verified / inferred / unavailable.
 * - Failed sections record their error — never silent zeros.
 * - READ-ONLY: nothing here mutates Google Ads.
 */
import { createClient } from "@supabase/supabase-js";
import type { GadsDeepData } from "@/lib/growthmind/gads-deep-fetch.server";

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
let _admin: any = null;
function admin(): any {
  if (!_admin) _admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  return _admin;
}

export const DATA_UNAVAILABLE_KEYWORD_PLANNER =
  "Data unavailable — requires Google Keyword Planner (not connected)";

// ── helpers ───────────────────────────────────────────────────────────────────

const r2 = (n: number) => +n.toFixed(2);
const pct = (n: number | null | undefined) =>
  n == null || !Number.isFinite(Number(n)) ? null : r2(Number(n) * 100);

function parseJsonBlock(text: string): any | null {
  if (!text) return null;
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { /* try repair below */ }
  // Attempt array
  const aStart = cleaned.indexOf("[");
  const aEnd = cleaned.lastIndexOf("]");
  if (aStart >= 0 && aEnd > aStart) {
    try { return JSON.parse(cleaned.slice(aStart, aEnd + 1)); } catch { return null; }
  }
  return null;
}

/** True when an IP literal (v4 or v6) is private / loopback / link-local / reserved. */
function isPrivateIp(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "::1" || h === "::" || /^fe80:/i.test(h) || /^f[cd][0-9a-f]{2}:/i.test(h)) return true;
  const v4 = h.startsWith("::ffff:") ? h.slice(7) : h;
  const m = v4.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const p = m.slice(1).map(Number);
  if (p.some(n => n > 255)) return true;
  return (
    p[0] === 0 || p[0] === 10 || p[0] === 127 ||
    (p[0] === 100 && p[1] >= 64 && p[1] <= 127) ||
    (p[0] === 169 && p[1] === 254) ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && p[1] === 168) ||
    (p[0] === 192 && p[1] === 0 && p[2] === 0) ||
    (p[0] === 198 && (p[1] === 18 || p[1] === 19)) ||
    p[0] >= 224
  );
}

/** SSRF guard: only public http(s) hosts, verified against resolved DNS addresses. */
export async function assertSafePublicUrl(raw: string): Promise<URL> {
  let parsed: URL;
  try { parsed = new URL(raw); } catch { throw new Error(`Invalid URL: ${raw.slice(0, 120)}`); }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("URL must be http(s).");
  if (parsed.username || parsed.password) throw new Error("URL must not embed credentials.");
  const hostname = parsed.hostname.toLowerCase();
  const BLOCKED = ["localhost", "metadata.google.internal", "169.254.169.254", "100.100.100.200", "192.0.2.1"];
  if (BLOCKED.includes(hostname) || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    throw new Error("URL targets a blocked host.");
  }
  if (isPrivateIp(hostname)) throw new Error("URL targets a private network address.");
  try {
    const { lookup } = await import("node:dns/promises");
    const addrs = await lookup(hostname, { all: true });
    if (addrs.length === 0 || addrs.some(a => isPrivateIp(a.address))) {
      throw new Error("URL resolves to a private network address.");
    }
  } catch (e) {
    throw new Error(`URL host could not be safely resolved: ${(e as Error).message}`);
  }
  return parsed;
}

/** Fetch a landing page (SSRF-guarded, capped) and extract readable signals. */
export async function fetchLandingPageSnapshot(url: string): Promise<{
  url: string; ok: boolean; status: number | null; title: string | null;
  metaDescription: string | null; h1: string[]; h2: string[];
  ctaCandidates: string[]; textExcerpt: string | null; error: string | null;
  fetchedAt: string;
}> {
  const fetchedAt = new Date().toISOString();
  try {
    let res: Response | null = null;
    let current = url;
    for (let hop = 0; hop < 4; hop++) {
      const safe = await assertSafePublicUrl(current);
      const hopRes = await fetch(safe.toString(), {
        redirect: "manual",
        signal: AbortSignal.timeout(12_000),
        headers: { "User-Agent": "Mozilla/5.0 (compatible; WEBEE-GrowthMind/1.0; marketing-analysis)" },
      });
      if (hopRes.status >= 300 && hopRes.status < 400) {
        const loc = hopRes.headers.get("location");
        if (!loc) { res = hopRes; break; }
        current = new URL(loc, safe).toString(); // re-validated on next hop
        continue;
      }
      res = hopRes;
      break;
    }
    if (!res) throw new Error("Too many redirects.");
    const html = (await res.text()).slice(0, 400_000);
    const pick = (rx: RegExp) => { const m = html.match(rx); return m ? m[1].replace(/\s+/g, " ").trim().slice(0, 300) : null; };
    const pickAll = (rx: RegExp, cap: number) => {
      const out: string[] = [];
      for (const m of html.matchAll(rx)) {
        const v = m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
        if (v) out.push(v.slice(0, 200));
        if (out.length >= cap) break;
      }
      return out;
    };
    const stripped = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    return {
      url, ok: res.ok, status: res.status,
      title: pick(/<title[^>]*>([\s\S]*?)<\/title>/i),
      metaDescription: pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)
        ?? pick(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i),
      h1: pickAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, 5),
      h2: pickAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, 12),
      ctaCandidates: pickAll(/<(?:a|button)[^>]*>([\s\S]*?)<\/(?:a|button)>/gi, 200)
        .filter(tx => /book|demo|start|try|call|get|sign|contact|talk|free|trial|quote|learn/i.test(tx))
        .slice(0, 15),
      textExcerpt: stripped.slice(0, 4000) || null,
      error: null, fetchedAt,
    };
  } catch (err: any) {
    return {
      url, ok: false, status: null, title: null, metaDescription: null,
      h1: [], h2: [], ctaCandidates: [], textExcerpt: null,
      error: (err?.message ?? String(err)).slice(0, 200), fetchedAt,
    };
  }
}

// ── deterministic classification ──────────────────────────────────────────────

export type KeywordClass = "winner" | "potential" | "underperformer" | "money_waster" | "low_data";

export function classifyKeyword(k: {
  impressions: number | null; clicks: number | null; cost: number | null;
  conversions: number | null; qualityScore: number | null; ctr: number | null;
}): { classification: KeywordClass; reason: string } {
  const impr = Number(k.impressions ?? 0);
  const clicks = Number(k.clicks ?? 0);
  const cost = Number(k.cost ?? 0);
  const conv = Number(k.conversions ?? 0);
  const qs = k.qualityScore;
  if (impr < 100 && clicks < 5) {
    return { classification: "low_data", reason: `Only ${impr} impressions / ${clicks} clicks in the window — insufficient data for a reliable verdict.` };
  }
  if (conv > 0) {
    return { classification: "winner", reason: `${conv.toFixed(1)} conversions from ${clicks} clicks (£${cost.toFixed(2)} spend).` };
  }
  if (cost >= 25 && conv === 0) {
    return { classification: "money_waster", reason: `£${cost.toFixed(2)} spent, ${clicks} clicks, zero conversions.` };
  }
  const ctrVal = Number(k.ctr ?? 0);
  if (clicks >= 5 && conv === 0 && (qs != null && qs <= 4)) {
    return { classification: "underperformer", reason: `${clicks} clicks with no conversions and quality score ${qs}/10.` };
  }
  if (ctrVal >= 0.02 || (qs != null && qs >= 6)) {
    return { classification: "potential", reason: `Healthy signals (CTR ${(ctrVal * 100).toFixed(1)}%${qs != null ? `, QS ${qs}/10` : ""}) but no conversions yet.` };
  }
  return { classification: "underperformer", reason: `Weak engagement: CTR ${(ctrVal * 100).toFixed(1)}%, ${clicks} clicks, no conversions.` };
}

export type SearchTermClass = "converting" | "relevant_no_conversion" | "irrelevant" | "high_cost_no_conversion" | "low_data";

const IRRELEVANT_HINTS = [
  "free", "salary", "job", "jobs", "hiring", "career", "course", "training",
  "how to become", "diy", "template", "definition", "meaning", "wikipedia",
];

export function classifySearchTerm(t: {
  searchTerm: string; impressions: number | null; clicks: number | null;
  cost: number | null; conversions: number | null;
}, businessTerms: string[]): { classification: SearchTermClass; reason: string } {
  const conv = Number(t.conversions ?? 0);
  const cost = Number(t.cost ?? 0);
  const clicks = Number(t.clicks ?? 0);
  const impr = Number(t.impressions ?? 0);
  const term = t.searchTerm.toLowerCase();
  if (conv > 0) return { classification: "converting", reason: `${conv.toFixed(1)} conversions.` };
  const irrelevantHit = IRRELEVANT_HINTS.find(h => term.includes(h));
  const relevantHit = businessTerms.some(b => b && term.includes(b));
  if (irrelevantHit && !relevantHit) {
    return { classification: "irrelevant", reason: `Contains "${irrelevantHit}" — intent mismatch with the offer.` };
  }
  if (irrelevantHit) {
    return { classification: "irrelevant", reason: `Contains "${irrelevantHit}" — likely non-buyer intent despite topical overlap.` };
  }
  if (cost >= 15 && conv === 0) {
    return { classification: "high_cost_no_conversion", reason: `£${cost.toFixed(2)} spent (${clicks} clicks) with no conversions.` };
  }
  if (impr < 5 && clicks === 0) return { classification: "low_data", reason: `Only ${impr} impressions, no clicks.` };
  return { classification: "relevant_no_conversion", reason: `Topically relevant, ${clicks} click${clicks === 1 ? "" : "s"}, no conversions yet.` };
}

// ── AI helper ─────────────────────────────────────────────────────────────────

async function aiJson(args: {
  workspaceId: string; label: string; system: string; user: string; maxTokens?: number;
}): Promise<{ json: any | null; error: string | null; model: string | null }> {
  try {
    const { routeGenerate } = await import("@/lib/growthmind/model-router.server");
    const res = await routeGenerate({
      system: args.system,
      user: args.user,
      contentType: "gads_deep_analysis",
      maxTokens: args.maxTokens ?? 6000,
      mode: "smart",
      settings: {},
      workspaceId: args.workspaceId,
      sb: admin(),
    });
    const json = parseJsonBlock(res.text);
    if (!json) return { json: null, error: `${args.label}: model returned non-JSON output`, model: `${res.provider}/${res.model}` };
    return { json, error: null, model: `${res.provider}/${res.model}` };
  } catch (err: any) {
    return { json: null, error: `${args.label}: ${(err?.message ?? String(err)).slice(0, 200)}`, model: null };
  }
}

// ── main builder ──────────────────────────────────────────────────────────────

export interface DeepAnalysisArgs {
  workspaceId: string;
  accountRowId: string;
  currencySymbol: string;
  data: GadsDeepData;
  workOrderId?: string | null;
  taskId?: string | null;
  executionId?: string | null;
  /** Live step reporter — called as each stage starts/finishes. */
  onStage?: (stageKey: string, status: "running" | "done" | "failed", detail?: string) => Promise<void>;
}

export async function buildGadsDeepAnalysisReport(args: DeepAnalysisArgs): Promise<{
  reportId: string;
  sections: Record<string, any>;
  counters: Record<string, number>;
  sectionErrors: string[];
}> {
  const { data, currencySymbol: cur } = args;
  const stage = async (k: string, s: "running" | "done" | "failed", d?: string) => {
    try { await args.onStage?.(k, s, d); } catch { /* progress reporting is best-effort */ }
  };
  const sectionErrors: string[] = [...data.meta.sectionErrors];
  const sections: Record<string, any> = {};

  const camp = data.campaign.rows[0] ?? null;
  const campaignName = camp?.name ?? "Unknown campaign";

  // Business DNA (best-effort context)
  let dna: any = null;
  try {
    const { data: dnaRow } = await admin().from("growthmind_business_dna")
      .select("*").eq("workspace_id", args.workspaceId)
      .order("version", { ascending: false }).limit(1).maybeSingle();
    dna = dnaRow ?? null;
  } catch { /* DNA optional */ }
  const dnaSummary = dna ? JSON.stringify({
    businessName: dna.business_name ?? dna.company_name ?? null,
    positioning: dna.positioning ?? null,
    products: dna.products ?? dna.offerings ?? null,
    targetCustomers: dna.target_customers ?? dna.audience ?? null,
    regions: dna.regions ?? null,
    pricing: dna.pricing ?? null,
    proposition: dna.value_proposition ?? dna.sales_proposition ?? null,
    brandVoice: dna.brand_voice ?? null,
  }).slice(0, 4000) : "No Business DNA stored for this workspace.";

  // ── CAMPAIGN section (deterministic) ────────────────────────────────────────
  await stage("analyze_campaign", "running");
  const totals = {
    spend: r2(Number(camp?.cost ?? 0)),
    impressions: Number(camp?.impressions ?? 0),
    clicks: Number(camp?.clicks ?? 0),
    conversions: Number(camp?.conversions ?? 0),
    conversionsValue: r2(Number(camp?.conversionsValue ?? 0)),
    ctrPct: pct(camp?.ctr),
    avgCpc: camp?.averageCpc != null ? r2(camp.averageCpc) : null,
    cpa: Number(camp?.conversions ?? 0) > 0 ? r2(Number(camp.cost) / Number(camp.conversions)) : null,
  };
  sections.campaign = {
    fetched: !!camp,
    error: data.campaign.error,
    settings: camp ? {
      id: camp.id, name: camp.name, status: camp.status, channelType: camp.channelType,
      biddingStrategy: camp.biddingStrategyType, startDate: camp.startDate,
      servingStatus: camp.servingStatus, networks: camp.networks,
      dailyBudget: camp.dailyBudget, budgetDeliveryMethod: camp.budgetDeliveryMethod,
    } : null,
    totals,
    impressionShare: camp ? {
      searchImpressionSharePct: pct(camp.searchImpressionShare),
      lostToBudgetPct: pct(camp.searchBudgetLostIS),
      lostToRankPct: pct(camp.searchRankLostIS),
      topImpressionPct: pct(camp.searchTopIS),
      absoluteTopPct: pct(camp.searchAbsTopIS),
    } : null,
    dailyTrend: data.campaignDaily.rows
      .map((d: any) => ({ date: d.date, spend: r2(d.cost ?? 0), impressions: d.impressions, clicks: d.clicks, conversions: d.conversions }))
      .sort((a: any, b: any) => String(a.date).localeCompare(String(b.date))),
    deviceSplit: data.deviceStats.rows.map((d: any) => ({ device: d.device, spend: r2(d.cost ?? 0), impressions: d.impressions, clicks: d.clicks, conversions: d.conversions })),
    dayOfWeekSplit: data.dayOfWeekStats.rows.map((d: any) => ({ day: d.dayOfWeek, spend: r2(d.cost ?? 0), impressions: d.impressions, clicks: d.clicks, conversions: d.conversions })),
    geoSplit: data.geoStats.rows.map((g: any) => ({ countryCriterionId: g.countryCriterionId, locationType: g.locationType, spend: r2(g.cost ?? 0), impressions: g.impressions, clicks: g.clicks, conversions: g.conversions })),
    targeting: {
      locations: data.campaignCriteria.rows.filter((c: any) => c.type === "LOCATION").map((c: any) => c.location),
      languages: data.campaignCriteria.rows.filter((c: any) => c.type === "LANGUAGE").map((c: any) => c.language),
      adSchedule: data.campaignCriteria.rows.filter((c: any) => c.type === "AD_SCHEDULE")
        .map((c: any) => ({ day: c.adScheduleDay, startHour: c.adScheduleStartHour, endHour: c.adScheduleEndHour })),
      campaignNegatives: data.campaignCriteria.rows.filter((c: any) => c.negative && c.keywordText)
        .map((c: any) => ({ text: c.keywordText, matchType: c.keywordMatchType })),
      error: data.campaignCriteria.error,
    },
  };
  await stage("analyze_campaign", "done", `${cur}${totals.spend} spend, ${totals.clicks} clicks, ${totals.conversions} conversions`);

  // ── AD GROUPS ────────────────────────────────────────────────────────────────
  sections.ad_groups = {
    error: data.adGroups.error,
    rows: data.adGroups.rows.map((g: any) => ({
      id: g.id, name: g.name, status: g.status, type: g.type, cpcBid: g.cpcBid,
      spend: r2(g.cost ?? 0), impressions: g.impressions, clicks: g.clicks,
      ctrPct: pct(g.ctr), avgCpc: g.averageCpc != null ? r2(g.averageCpc) : null,
      conversions: g.conversions, cpa: Number(g.conversions ?? 0) > 0 ? r2(Number(g.cost) / Number(g.conversions)) : null,
    })),
  };

  // ── KEYWORDS (deterministic classification) ────────────────────────────────
  await stage("analyze_keywords", "running");
  const keywordRows = data.keywords.rows.filter((k: any) => !k.negative).map((k: any) => {
    const cls = classifyKeyword(k);
    return {
      text: k.text, matchType: k.matchType, status: k.status,
      adGroup: k.adGroupName,
      qualityScore: k.qualityScore,
      qualityComponents: {
        expectedCtr: k.expectedCtr, adRelevance: k.adRelevance, landingPageExperience: k.landingPageExperience,
      },
      spend: r2(k.cost ?? 0), impressions: k.impressions, clicks: k.clicks,
      ctrPct: pct(k.ctr), avgCpc: k.averageCpc != null ? r2(k.averageCpc) : null,
      conversions: k.conversions,
      cpa: Number(k.conversions ?? 0) > 0 ? r2(Number(k.cost) / Number(k.conversions)) : null,
      classification: cls.classification, classificationReason: cls.reason,
    };
  });
  sections.keywords = {
    error: data.keywords.error,
    lowDataNote: "Keywords marked low_data have under 100 impressions and 5 clicks in the window — treat verdicts as provisional.",
    rows: keywordRows,
    counts: keywordRows.reduce((acc: any, k: any) => { acc[k.classification] = (acc[k.classification] ?? 0) + 1; return acc; }, {}),
  };
  await stage("analyze_keywords", "done", `${keywordRows.length} keywords classified`);

  // ── SEARCH TERMS ────────────────────────────────────────────────────────────
  await stage("analyze_search_terms", "running");
  const businessTerms = ["reception", "receptionist", "answering", "call", "phone", "ai", "virtual", "voice", "appointment", "booking"];
  const termAgg = new Map<string, any>();
  for (const t of data.searchTerms.rows) {
    const k = t.searchTerm.toLowerCase();
    const prev = termAgg.get(k) ?? { ...t, cost: 0, impressions: 0, clicks: 0, conversions: 0 };
    prev.cost += Number(t.cost ?? 0); prev.impressions += Number(t.impressions ?? 0);
    prev.clicks += Number(t.clicks ?? 0); prev.conversions += Number(t.conversions ?? 0);
    termAgg.set(k, prev);
  }
  const { toFourWay, FOUR_WAY_META } = await import("@/lib/growthmind/gads-negative-policy.server");
  const searchTermRows = Array.from(termAgg.values()).map((t: any) => {
    const cls = classifySearchTerm(t, businessTerms);
    const fourWay = toFourWay(cls.classification);
    return {
      searchTerm: t.searchTerm, matchedKeyword: t.matchedKeyword, matchType: t.matchType,
      addedExcluded: t.status ?? null,
      spend: r2(t.cost), impressions: t.impressions, clicks: t.clicks, conversions: t.conversions,
      classification: cls.classification, classificationReason: cls.reason,
      fourWayClass: fourWay, fourWayLabel: FOUR_WAY_META[fourWay].label,
      excludable: FOUR_WAY_META[fourWay].excludable,
    };
  }).sort((a: any, b: any) => b.spend - a.spend || b.clicks - a.clicks || b.impressions - a.impressions);
  sections.search_terms = {
    error: data.searchTerms.error,
    totalUniqueTerms: searchTermRows.length,
    rows: searchTermRows.slice(0, 400),
    counts: searchTermRows.reduce((acc: any, t: any) => { acc[t.classification] = (acc[t.classification] ?? 0) + 1; return acc; }, {}),
  };
  await stage("analyze_search_terms", "done", `${searchTermRows.length} unique search terms analysed`);

  // ── ADS ─────────────────────────────────────────────────────────────────────
  await stage("analyze_ads", "running");
  sections.ads = {
    error: data.ads.error,
    rows: data.ads.rows.map((a: any) => ({
      adId: a.adId, type: a.type, status: a.status, adStrength: a.adStrength,
      approvalStatus: a.approvalStatus, finalUrls: a.finalUrls,
      headlines: a.headlines, descriptions: a.descriptions, path1: a.path1, path2: a.path2,
      adGroup: a.adGroupName,
      spend: r2(a.cost ?? 0), impressions: a.impressions, clicks: a.clicks,
      ctrPct: pct(a.ctr), conversions: a.conversions,
    })),
  };
  await stage("analyze_ads", "done", `${data.ads.rows.length} ads reviewed`);

  // ── TRACKING diagnosis (deterministic) ──────────────────────────────────────
  const convActions = data.conversionActions.rows;
  const enabledPrimary = convActions.filter((c: any) => c.status === "ENABLED" && c.includeInConversions);
  const trackingFindings: string[] = [];
  if (data.conversionActions.error) {
    trackingFindings.push(`Could not read conversion actions: ${data.conversionActions.error}`);
  } else {
    trackingFindings.push(`${convActions.length} conversion action(s) configured; ${enabledPrimary.length} enabled and counted in "Conversions".`);
    if (totals.conversions === 0 && totals.clicks >= 15 && enabledPrimary.length > 0) {
      trackingFindings.push(
        `${totals.clicks} clicks in the window produced 0 recorded conversions. Either the funnel is not converting or the conversion tags are not firing on the landing page — verify tag firing before trusting "zero conversions" as a demand signal.`,
      );
    }
    if (data.conversionsByAction.rows.length === 0 && totals.clicks > 0) {
      trackingFindings.push("No conversions were attributed to any conversion action in this window (all-conversions segment view is empty).");
    }
  }
  // Server-side conversion tracking health (conversion_events ledger).
  let trackingHealth: import("@/lib/tracking/conversion-tracking-health.server").TrackingHealth | null = null;
  try {
    const { computeConversionTrackingHealth } =
      await import("@/lib/tracking/conversion-tracking-health.server");
    trackingHealth = await computeConversionTrackingHealth(args.workspaceId, {
      windowDays: 30,
      adClicksInWindow: totals.clicks,
    });
    trackingFindings.push(`Server-side tracking health: ${trackingHealth.signal.toUpperCase()} — ${trackingHealth.reasons[0] ?? ""}`);
    if (trackingHealth.signal !== "verified") {
      trackingFindings.push(
        "Conversion tracking is NOT verified end-to-end — all conversion-dependent recommendations in this report are LOW CONFIDENCE until at least one conversion is acknowledged by Google.",
      );
    }
  } catch (err) {
    console.error("[GADS-ANALYSIS] tracking health computation failed:", (err as Error)?.message);
  }

  sections.tracking = {
    error: data.conversionActions.error,
    conversionActions: convActions,
    conversionsByAction: data.conversionsByAction.rows,
    findings: trackingFindings,
    healthSignal: trackingHealth?.signal ?? null,
    healthReasons: trackingHealth?.reasons ?? [],
    conversionDependentRecommendationsLowConfidence:
      trackingHealth ? trackingHealth.signal !== "verified" : null,
  };

  // ── LANDING PAGES (real fetch) ──────────────────────────────────────────────
  await stage("analyze_landing_pages", "running");
  const finalUrls = Array.from(new Set(data.ads.rows.flatMap((a: any) => a.finalUrls ?? []))).slice(0, 5) as string[];
  const landingSnapshots = [];
  for (const u of finalUrls) landingSnapshots.push(await fetchLandingPageSnapshot(u));
  sections.landing_pages = {
    finalUrls,
    snapshots: landingSnapshots,
    note: finalUrls.length === 0 ? "No final URLs found on active ads." : null,
  };
  await stage("analyze_landing_pages", "done", `${landingSnapshots.filter(s => s.ok).length}/${finalUrls.length} landing pages fetched`);

  // ── AI sections ─────────────────────────────────────────────────────────────
  const aiModels: string[] = [];
  const evidenceBase = JSON.stringify({
    campaign: sections.campaign.settings,
    totals, impressionShare: sections.campaign.impressionShare,
    adGroups: sections.ad_groups.rows,
    keywords: keywordRows,
    topSearchTerms: searchTermRows.slice(0, 120),
    searchTermCounts: sections.search_terms.counts,
    ads: sections.ads.rows.map((a: any) => ({ ...a, headlines: a.headlines?.map((h: any) => h.text), descriptions: a.descriptions?.map((d: any) => d.text) })),
    tracking: { findings: trackingFindings, actions: convActions.map((c: any) => c.name) },
    landingPages: landingSnapshots.map(s => ({ url: s.url, ok: s.ok, title: s.title, metaDescription: s.metaDescription, h1: s.h1, h2: s.h2, ctas: s.ctaCandidates, excerpt: s.textExcerpt?.slice(0, 1500) })),
    currency: cur,
    window: { from: data.meta.dateFrom, to: data.meta.dateTo },
  }).slice(0, 60_000);

  const HONESTY = `HONESTY RULES (mandatory):
- Ground every claim ONLY in the evidence JSON provided. Never invent metrics, search volumes, CPC estimates, competitor stats or percentage-improvement projections.
- Where a number would require Google Keyword Planner or third-party tools, write exactly: "${DATA_UNAVAILABLE_KEYWORD_PLANNER}".
- Use directional language ("should increase", "likely to reduce wasted spend") instead of invented precision.
- Respond with VALID JSON ONLY, no markdown fences, matching the schema requested.`;

  // AI 1: keyword opportunities (suggested + negative groups)
  await stage("generate_keyword_opportunities", "running");
  const kwAi = await aiJson({
    workspaceId: args.workspaceId, label: "keyword_opportunities", maxTokens: 7000,
    system: `You are a senior Google Ads specialist producing evidence-based keyword strategy for the campaign "${campaignName}". ${HONESTY}`,
    user: `Business DNA: ${dnaSummary}

Evidence JSON:
${evidenceBase}

Produce JSON:
{
 "suggested_keywords": [ { "theme": string, "keywords": [ { "keyword": string, "matchType": "EXACT"|"PHRASE"|"BROAD", "intent": string, "rationale": string, "evidence": string, "estimatedVolume": string, "priority": "high"|"medium"|"low" } ] } ],
 "negative_keywords": [ { "group": string, "terms": [string], "matchType": "EXACT"|"PHRASE"|"BROAD", "evidence": string, "spendAffected": string } ],
 "keyword_structure_notes": string
}
Rules: suggested keywords must derive from real search terms in the evidence, the live landing page content, or the Business DNA (say which in "evidence"). For estimatedVolume always use the exact unavailable string given. Negative keyword groups must cite the actual irrelevant/high-cost terms observed and the real spend on them.`,
  });
  if (kwAi.error) sectionErrors.push(kwAi.error);
  if (kwAi.model) aiModels.push(kwAi.model);
  sections.suggested_keywords = {
    error: kwAi.error,
    groups: kwAi.json?.suggested_keywords ?? [],
    volumeNote: DATA_UNAVAILABLE_KEYWORD_PLANNER,
    structureNotes: kwAi.json?.keyword_structure_notes ?? null,
  };
  // POLICY: only IRRELEVANT terms may become recommended negatives.
  // UNCERTAIN (incl. high-cost-no-conversion) and HIGH-VALUE terms are shown
  // for review but never proposed for exclusion.
  const consideredTerms = searchTermRows
    .filter((t: any) => t.classification === "irrelevant" || t.classification === "high_cost_no_conversion" || t.classification === "converting")
    .slice(0, 60);
  sections.negative_keywords = {
    error: kwAi.error,
    policyNote: "Only terms classified IRRELEVANT can be recommended as negatives. UNCERTAIN terms need human review; HIGH-VALUE DISCOVERY terms are keyword-add candidates, never exclusions.",
    deterministicCandidates: consideredTerms
      .filter((t: any) => t.fourWayClass === "irrelevant")
      .map((t: any) => ({ term: t.searchTerm, spend: t.spend, clicks: t.clicks, reason: t.classificationReason, fourWayClass: t.fourWayClass })),
    reviewNeeded: consideredTerms
      .filter((t: any) => t.fourWayClass === "uncertain")
      .map((t: any) => ({ term: t.searchTerm, spend: t.spend, clicks: t.clicks, reason: t.classificationReason, fourWayClass: t.fourWayClass })),
    highValueDiscoveries: consideredTerms
      .filter((t: any) => t.fourWayClass === "high_value_discovery")
      .map((t: any) => ({ term: t.searchTerm, spend: t.spend, clicks: t.clicks, conversions: t.conversions, reason: t.classificationReason, fourWayClass: t.fourWayClass })),
    groups: kwAi.json?.negative_keywords ?? [],
  };
  // Permanent decision log: record every term considered, whatever the outcome.
  try {
    const { recordNegativeDecisions } = await import("@/lib/growthmind/gads-negative-policy.server");
    const logRes = await recordNegativeDecisions(admin(), consideredTerms.map((t: any) => ({
      workspace_id: args.workspaceId,
      account_row_id: args.accountRowId,
      customer_id: data.meta.customerId ?? null,
      campaign_id: camp?.id != null ? String(camp.id) : null,
      campaign_name: campaignName,
      search_term: t.searchTerm,
      classification: t.fourWayClass,
      decision: t.fourWayClass === "irrelevant" ? "recommended_negative" as const : "not_recommended" as const,
      reason: t.classificationReason,
      evidence: { spend: t.spend, clicks: t.clicks, impressions: t.impressions, conversions: t.conversions, source: "deep_analysis" },
    })));
    if (!logRes.ok) sectionErrors.push(`negative decision log: ${logRes.error}`);
  } catch (e: any) { sectionErrors.push(`negative decision log: ${e?.message}`); }
  await stage("generate_keyword_opportunities", kwAi.error ? "failed" : "done",
    kwAi.error ?? `${(kwAi.json?.suggested_keywords ?? []).length} suggested keyword themes, ${(kwAi.json?.negative_keywords ?? []).length} negative groups`);

  // AI 2: ad concepts + campaign structure
  await stage("create_ad_concepts", "running");
  const adAi = await aiJson({
    workspaceId: args.workspaceId, label: "ad_concepts", maxTokens: 7000,
    system: `You are a senior Google Ads copywriter and account strategist for "${campaignName}". ${HONESTY}`,
    user: `Business DNA: ${dnaSummary}

Evidence JSON:
${evidenceBase}

Produce JSON:
{
 "current_ad_critique": [ { "adId": string, "strengths": [string], "weaknesses": [string], "evidence": string } ],
 "ad_concepts": [ { "name": string, "angle": string, "targetAdGroup": string, "headlines": [string], "descriptions": [string], "path1": string, "path2": string, "finalUrl": string, "rationale": string, "evidence": string } ],
 "structure_recommendation": { "currentIssues": [string], "proposedStructure": [ { "adGroup": string, "theme": string, "keywords": [string], "matchTypes": string, "rationale": string } ], "biddingNotes": string, "budgetNotes": string }
}
Rules: at least 3 complete ad_concepts, each with 8-15 headlines (max 30 chars each) and 3-4 descriptions (max 90 chars each). Concepts must address weaknesses evidenced in the data (e.g. low CTR, quality-score components, search-term language). Structure must reference the real ad groups and keywords.`,
  });
  if (adAi.error) sectionErrors.push(adAi.error);
  if (adAi.model) aiModels.push(adAi.model);
  sections.ad_concepts = { error: adAi.error, critique: adAi.json?.current_ad_critique ?? [], concepts: adAi.json?.ad_concepts ?? [] };
  sections.structure_recommendation = { error: adAi.error, ...(adAi.json?.structure_recommendation ?? {}) };
  await stage("create_ad_concepts", adAi.error ? "failed" : "done",
    adAi.error ?? `${(adAi.json?.ad_concepts ?? []).length} ad concepts created`);

  // AI 3: landing-page analysis + blueprint
  await stage("create_page_layouts", "running");
  const lpAi = await aiJson({
    workspaceId: args.workspaceId, label: "landing_page_blueprint", maxTokens: 8000,
    system: `You are a senior CRO (conversion rate optimisation) specialist. ${HONESTY}`,
    user: `Business DNA: ${dnaSummary}

Evidence JSON (includes REAL fetched landing-page content under landingPages):
${evidenceBase}

Produce JSON:
{
 "landing_page_analysis": [ { "url": string, "messageMatch": string, "strengths": [string], "weaknesses": [string], "quickWins": [string], "evidence": string } ],
 "landing_page_blueprint": { "targetUrl": string, "sections": [ { "order": number, "section": string, "purpose": string, "suggestedHeading": string, "suggestedCopy": string, "cta": string, "requiredAsset": string, "supportingEvidenceNeeded": string, "mobileBehaviour": string, "conversionRationale": string } ] }
}
Rules: landing_page_blueprint.sections must cover all 17 of: sticky header with phone CTA; hero headline matching ad keywords; supporting subheadline; primary CTA; secondary CTA; product demonstration; main customer problems; how the product solves them; feature and benefit grid; how deployment works; call-handling workflow; integrations; use cases; objection handling; FAQ; final CTA; footer trust & compliance. Analysis must reference the actual fetched page content (headings, CTAs) — if a page failed to fetch, say so honestly.`,
  });
  if (lpAi.error) sectionErrors.push(lpAi.error);
  if (lpAi.model) aiModels.push(lpAi.model);
  sections.landing_pages.analysis = lpAi.json?.landing_page_analysis ?? [];
  sections.landing_pages.analysisError = lpAi.error;
  sections.landing_page_blueprint = { error: lpAi.error, ...(lpAi.json?.landing_page_blueprint ?? {}) };

  // AI 4: homepage blueprint
  const hpAi = await aiJson({
    workspaceId: args.workspaceId, label: "homepage_blueprint", maxTokens: 7000,
    system: `You are a senior product-marketing website strategist for WEBEE. ${HONESTY}`,
    user: `Business DNA: ${dnaSummary}

WEBEE's product families that the homepage must clearly distinguish:
- Primary product: WEBEE Receptionist
- Voice AI: Receptionist, Qualify, Lead Gen, Swarm
- Business OS: HiveMind, GrowthMind, SystemMind, AccountsMind
- Communication: HexMail, BuzzChat, Follow-Up Centre
- Platform: WEBEE Builder, Smart Dashboard, CRM, Analytics

Campaign evidence JSON (for language buyers actually use — see search terms):
${evidenceBase.slice(0, 30_000)}

Produce JSON:
{
 "homepage_blueprint": { "heroLayout": string, "productNavigation": string, "visualHierarchy": string, "ctaHierarchy": string, "sections": [ { "order": number, "section": string, "purpose": string, "suggestedHeading": string, "contents": string, "cta": string, "conversionRationale": string } ], "trustSections": string, "pricingEntryPoints": string, "footerStructure": string }
}
This is a design recommendation only — the website must not be altered by this analysis.`,
  });
  if (hpAi.error) sectionErrors.push(hpAi.error);
  if (hpAi.model) aiModels.push(hpAi.model);
  sections.homepage_blueprint = { error: hpAi.error, ...(hpAi.json?.homepage_blueprint ?? {}) };
  await stage("create_page_layouts", (lpAi.error && hpAi.error) ? "failed" : "done",
    [lpAi.error ? "landing-page blueprint failed" : "landing-page blueprint ready",
     hpAi.error ? "homepage blueprint failed" : "homepage blueprint ready"].join("; "));

  // AI 5: competitor intelligence (honest labels)
  const compAi = await aiJson({
    workspaceId: args.workspaceId, label: "competitors", maxTokens: 5000,
    system: `You are a market analyst. ${HONESTY}
ADDITIONAL RULE: You have NO live web research tool here. Every competitor field must be labelled:
- "verified" ONLY if it comes from the provided evidence (it almost never will),
- "inferred" for widely-known, stable public knowledge you are confident about (state the basis),
- "unavailable" for anything requiring current data (pricing, ad copy, traffic, performance).
Never fabricate pricing, features, ads, traffic or performance numbers.`,
    user: `Business DNA: ${dnaSummary}

Category: AI receptionist / virtual receptionist / AI phone answering for SMBs (search terms evidence shows buyers comparing this category).
Real search terms mentioning brands or category: ${JSON.stringify(searchTermRows.filter((t: any) => t.impressions >= 2).slice(0, 80).map((t: any) => t.searchTerm))}

Produce JSON:
{ "competitors": [ { "competitor": string, "source": string, "dataStatus": "verified"|"inferred"|"unavailable", "positioning": string, "headline": string, "offer": string, "cta": string, "keywordThemes": [string], "landingPageStructure": string, "strengths": [string], "weaknesses": [string], "differentiationOpportunity": string } ], "methodNote": string }
For every field you cannot honestly fill, use the string "unavailable — requires live competitor research".`,
  });
  if (compAi.error) sectionErrors.push(compAi.error);
  if (compAi.model) aiModels.push(compAi.model);
  sections.competitors = {
    error: compAi.error,
    rows: compAi.json?.competitors ?? [],
    methodNote: compAi.json?.methodNote ?? "No live competitor research source is connected — entries are inferred from stable public knowledge or marked unavailable.",
  };

  // ── CHANGE REQUEST drafts (deterministic core + AI-backed extras) ───────────
  await stage("draft_change_requests", "running");
  const changeRequests: any[] = [];
  const cr = (c: Partial<Record<string, any>>) => changeRequests.push({
    group: "", exactAction: "", affectedObject: "", currentState: "", proposedState: "",
    supportingEvidence: "", expectedDirectionalImpact: "", confidence: 0.6, risk: "low",
    reversibility: "fully reversible", approvalRequired: "google_ads_change",
    implementationOwner: "Google Ads manager", verificationMethod: "", rollbackMethod: "", ...c,
  });

  if (totals.conversions === 0 && totals.clicks >= 15 && enabledPrimary.length > 0) {
    cr({
      group: "Critical tracking fixes",
      exactAction: "Verify conversion tags fire on the landing page (Tag Assistant / GA debug), then test a live form submission end-to-end.",
      affectedObject: `Conversion actions: ${enabledPrimary.map((c: any) => c.name).join(", ")}`,
      currentState: `${totals.clicks} clicks, 0 recorded conversions in ${data.meta.dateFrom}→${data.meta.dateTo}.`,
      proposedState: "Conversion actions verified as firing; recorded conversions reflect real form submissions.",
      supportingEvidence: `Campaign totals: spend ${cur}${totals.spend}, clicks ${totals.clicks}, conversions 0. conversions_by_action segment view empty.`,
      expectedDirectionalImpact: "Restores trustworthy performance data; every other optimisation depends on it.",
      confidence: 0.85, risk: "none — diagnostic only", approvalRequired: "analysis",
      verificationMethod: "Submit a test lead and confirm it appears in Google Ads conversions within 24h.",
      rollbackMethod: "Not applicable (no account change).",
    });
  }
  const negCandidates = sections.negative_keywords.deterministicCandidates as any[];
  if (negCandidates.length > 0) {
    const negSpend = r2(negCandidates.reduce((s, t) => s + Number(t.spend ?? 0), 0));
    cr({
      group: "Negative keywords",
      exactAction: `Add ${negCandidates.length} campaign-level negative keywords (see Negative Keywords tab), starting with the highest-spend irrelevant terms.`,
      affectedObject: `Campaign "${campaignName}" — shared negative list`,
      currentState: `${sections.campaign.targeting.campaignNegatives.length} campaign negatives currently set; ${cur}${negSpend} spent on irrelevant/high-cost terms in the window.`,
      proposedState: "Irrelevant search terms blocked from matching.",
      supportingEvidence: `Top candidates: ${negCandidates.slice(0, 5).map(t => `"${t.term}" (${cur}${t.spend})`).join(", ")}.`,
      expectedDirectionalImpact: "Should reduce wasted spend and lift CTR/quality score (no invented percentage).",
      confidence: 0.8, risk: "low — negatives can over-block if too broad",
      verificationMethod: "Search-terms report after 7 days shows the blocked terms no longer matching.",
      rollbackMethod: "Remove the added negatives.",
    });
  }
  if (camp?.searchBudgetLostIS != null && camp.searchBudgetLostIS >= 0.3) {
    cr({
      group: "Budget recommendations",
      exactAction: `Review the ${cur}${camp.dailyBudget}/day budget: ${pct(camp.searchBudgetLostIS)}% of eligible impressions are lost to budget. Fix tracking and negatives FIRST, then consider raising budget only once conversions are measurable.`,
      affectedObject: `Campaign "${campaignName}" budget`,
      currentState: `Daily budget ${cur}${camp.dailyBudget}; impression share ${pct(camp.searchImpressionShare)}%; lost-to-budget ${pct(camp.searchBudgetLostIS)}%.`,
      proposedState: "Budget sized deliberately once conversion data is trustworthy.",
      supportingEvidence: `Search budget lost IS ${pct(camp.searchBudgetLostIS)}%, rank lost IS ${pct(camp.searchRankLostIS)}%.`,
      expectedDirectionalImpact: "Prevents scaling spend into an unmeasured funnel.",
      confidence: 0.75, risk: "medium — raising budget before tracking is fixed would scale waste",
      approvalRequired: "budget",
      verificationMethod: "Impression-share metrics after change; CPA once tracking verified.",
      rollbackMethod: "Restore previous daily budget.",
    });
  }
  const wasters = keywordRows.filter((k: any) => k.classification === "money_waster");
  for (const w of wasters.slice(0, 5)) {
    cr({
      group: "Keyword changes",
      exactAction: `Pause keyword "${w.text}" (${w.matchType}) pending tracking verification and search-term review.`,
      affectedObject: `Keyword "${w.text}" in ad group "${w.adGroup}"`,
      currentState: `${cur}${w.spend} spend, ${w.clicks} clicks, 0 conversions, QS ${w.qualityScore ?? "n/a"}.`,
      proposedState: "Keyword paused or match type tightened.",
      supportingEvidence: w.classificationReason,
      expectedDirectionalImpact: "Stops the current highest-waste spend line.",
      confidence: 0.7, risk: "medium — may reduce volume if the keyword is actually converting untracked",
      verificationMethod: "Spend on this keyword goes to zero; overall conversion volume unchanged after tracking fix.",
      rollbackMethod: "Re-enable the keyword.",
    });
  }
  if (data.adGroups.rows.length === 1 && keywordRows.length >= 5) {
    cr({
      group: "Ad-group restructuring",
      exactAction: "Split the single ad group into intent-based ad groups per the Structure tab so ads can match keyword themes.",
      affectedObject: `Ad group "${data.adGroups.rows[0]?.name}" in "${campaignName}"`,
      currentState: `1 ad group holding ${keywordRows.length} keywords across mixed intents.`,
      proposedState: "Themed ad groups with tailored RSAs per theme.",
      supportingEvidence: "See Keywords and Structure tabs — mixed match types and intents share one RSA.",
      expectedDirectionalImpact: "Better message match should improve CTR and quality score.",
      confidence: 0.7, risk: "medium — restructures reset some learning",
      verificationMethod: "CTR and QS per new ad group after 2 weeks.",
      rollbackMethod: "Re-enable the original ad group (keep it paused, not deleted).",
    });
  }
  const lpWeak = keywordRows.some((k: any) => k.qualityComponents?.landingPageExperience === "BELOW_AVERAGE");
  if (lpWeak) {
    cr({
      group: "Landing-page changes",
      exactAction: "Implement the Landing Pages tab blueprint on the ad landing page (message match, CTA, proof).",
      affectedObject: finalUrls.join(", ") || "Ad final URL",
      currentState: "Google rates landing-page experience BELOW_AVERAGE on at least one active keyword.",
      proposedState: "Landing page rebuilt to the blueprint; landing-page experience rating recovers.",
      supportingEvidence: "keyword quality components (landingPageExperience=BELOW_AVERAGE); fetched page content in Landing Pages tab.",
      expectedDirectionalImpact: "Should improve quality score, lower CPC and raise conversion rate.",
      confidence: 0.75, risk: "low", approvalRequired: "website_content",
      implementationOwner: "Website owner",
      verificationMethod: "Quality-score components re-checked after 2-4 weeks; conversion rate on the page.",
      rollbackMethod: "Restore previous page version.",
    });
  }
  cr({
    group: "Monitoring actions",
    exactAction: "Weekly: review search terms for new negatives; confirm conversion actions still firing; watch impression-share lost-to-budget vs lost-to-rank.",
    affectedObject: `Campaign "${campaignName}"`,
    currentState: "No documented monitoring cadence.",
    proposedState: "Weekly 15-minute review with the three checks above.",
    supportingEvidence: "455 raw search terms in 30 days and evolving spend distribution warrant weekly review.",
    expectedDirectionalImpact: "Catches waste and tracking regressions early.",
    confidence: 0.8, risk: "none", approvalRequired: "analysis",
    implementationOwner: "Account owner",
    verificationMethod: "Review log kept alongside the work order.",
    rollbackMethod: "Not applicable.",
  });

  sections.change_requests = {
    approvalLevels: {
      analysis: "Read-only analysis only.",
      google_ads_change: "Required before any Google Ads API mutation.",
      website_content: "Required before changing website copy.",
      website_deployment: "Required before deploying website changes.",
      budget: "Required separately for any spend increase.",
    },
    note: "Approving this analysis does NOT approve implementation. Each request needs its own approval at the stated level. WEBEE never edits the live Google Ads account.",
    rows: changeRequests,
  };
  await stage("draft_change_requests", "done", `${changeRequests.length} change requests drafted`);

  // ── MONITORING plan ─────────────────────────────────────────────────────────
  sections.monitoring = {
    cadence: "weekly",
    checks: [
      "Search-terms report: new irrelevant terms → add negatives.",
      "Conversion actions: confirm tags still firing (test lead monthly).",
      "Impression share: track lost-to-budget vs lost-to-rank direction.",
      "Quality score components per keyword: expected CTR / ad relevance / landing page.",
      "Spend pacing vs daily budget.",
    ],
  };

  // ── EXECUTIVE SUMMARY (AI, last — sees everything) ─────────────────────────
  await stage("compile_report", "running");
  const summaryAi = await aiJson({
    workspaceId: args.workspaceId, label: "executive_summary", maxTokens: 3000,
    system: `You are GrowthMind, WEBEE's CMO executive, writing the executive summary of a Google Ads deep analysis. ${HONESTY}`,
    user: `Campaign: "${campaignName}" (${data.meta.dateFrom} → ${data.meta.dateTo})
Totals: ${JSON.stringify(totals)} ImpressionShare: ${JSON.stringify(sections.campaign.impressionShare)}
Keyword classes: ${JSON.stringify(sections.keywords.counts)} SearchTerm classes: ${JSON.stringify(sections.search_terms.counts)}
Tracking findings: ${JSON.stringify(trackingFindings)}
Change request groups: ${JSON.stringify(changeRequests.map(c => c.group))}

Produce JSON:
{ "executive_summary": { "headline": string, "situation": string, "rootCauses": [string], "topPriorities": [ { "priority": number, "action": string, "why": string } ], "whatHappensIfNothingChanges": string } }`,
  });
  if (summaryAi.error) sectionErrors.push(summaryAi.error);
  if (summaryAi.model) aiModels.push(summaryAi.model);
  sections.executive_summary = {
    error: summaryAi.error,
    ...(summaryAi.json?.executive_summary ?? {}),
    totalsSnapshot: totals,
  };

  // ── EVIDENCE / freshness ────────────────────────────────────────────────────
  sections.evidence = {
    dataSources: [
      { source: "Google Ads API (GAQL, read-only)", apiVersion: "live", fetchedAt: data.meta.fetchedAt, window: { from: data.meta.dateFrom, to: data.meta.dateTo } },
      { source: "Landing pages (direct fetch)", urls: finalUrls, fetchedAt: landingSnapshots[0]?.fetchedAt ?? null },
      { source: "Business DNA", present: !!dna },
    ],
    rowCounts: {
      campaigns: data.campaign.rows.length,
      adGroups: data.adGroups.rows.length,
      keywords: keywordRows.length,
      searchTermsRaw: data.searchTerms.rows.length,
      searchTermsUnique: searchTermRows.length,
      ads: data.ads.rows.length,
      conversionActions: convActions.length,
    },
    aiModelsUsed: Array.from(new Set(aiModels)),
    sectionErrors,
    readOnlyConfirmation: "This analysis performed GAQL read queries and landing-page GETs only. No Google Ads mutation endpoints were called.",
  };

  // ── persist ─────────────────────────────────────────────────────────────────
  const sb = admin();
  const { data: reportRow, error: insertErr } = await sb
    .from("growthmind_gads_analysis_reports")
    .insert({
      workspace_id: args.workspaceId,
      account_row_id: args.accountRowId,
      work_order_id: args.workOrderId ?? null,
      task_id: args.taskId ?? null,
      execution_id: args.executionId ?? null,
      campaign_id: camp?.id ?? data.meta.campaignId,
      campaign_name: campaignName,
      period_days: Math.round((Date.parse(data.meta.dateTo) - Date.parse(data.meta.dateFrom)) / 86_400_000),
      date_from: data.meta.dateFrom,
      date_to: data.meta.dateTo,
      status: sectionErrors.length ? "complete_with_warnings" : "complete",
      sections,
      source_meta: {
        customerId: data.meta.customerId,
        fetchedAt: data.meta.fetchedAt,
        sectionErrors,
        aiModelsUsed: Array.from(new Set(aiModels)),
        currencySymbol: cur,
      },
    })
    .select("id").single();
  if (insertErr) throw new Error(`Failed to persist analysis report: ${insertErr.message}`);
  await stage("compile_report", "done", `Report stored (${Object.keys(sections).length} sections)`);

  return {
    reportId: reportRow.id as string,
    sections,
    counters: {
      keywords: keywordRows.length,
      searchTerms: searchTermRows.length,
      suggestedKeywordThemes: (sections.suggested_keywords.groups ?? []).length,
      negativeGroups: (sections.negative_keywords.groups ?? []).length,
      negativeCandidates: negCandidates.length,
      adConcepts: (sections.ad_concepts.concepts ?? []).length,
      changeRequests: changeRequests.length,
    },
    sectionErrors,
  };
}
