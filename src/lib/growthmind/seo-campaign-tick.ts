/**
 * SEO Campaign Tick — autonomous SEO blog campaign creator.
 *
 * Called from /api/public/campaign-executor (pg_cron every 5 min in prod,
 * Vite plugin tick in dev). For every workspace that has opted in via
 * workspace_settings.seo_auto_campaigns_per_week (> 0) and has HiveMind in a
 * proposal-capable mode, it creates up to N SEO blog campaigns per week
 * (evenly spaced) via createSeoCampaignCore.
 *
 * Approval-first is preserved by construction: createSeoCampaignCore only
 * inserts a campaign at "awaiting_strategy_approval" and raises a sensitive
 * hivemind_actions approval — nothing is written, generated beyond the topic
 * pick, or published without a human approving every stage.
 *
 * Topic selection is evidence-first: Search Console opportunities
 * (detectOpportunities) filtered against existing campaign/calendar topics;
 * falls back to a Business-DNA-derived topic only when GSC has no usable
 * opportunity. Workspaces with neither GSC evidence nor DNA are skipped —
 * never invent a topic from nothing.
 */

import { createClient } from "@supabase/supabase-js";

export const AUTO_SEO_NAME_PREFIX = "[Auto] ";
const MAX_PER_WEEK = 7;

// ── pure cadence helper (unit-tested) ────────────────────────────────────────

export function computeAutoSeoDecision(input: {
  perWeek: number;
  createdThisWeek: number;
  lastAutoCreatedAt: string | null;
  now: Date;
}): { create: boolean; reason: string } {
  const perWeek = Math.min(MAX_PER_WEEK, Math.max(0, Math.floor(input.perWeek)));
  if (perWeek <= 0) return { create: false, reason: "disabled" };
  if (input.createdThisWeek >= perWeek) return { create: false, reason: "weekly_quota_reached" };
  if (input.lastAutoCreatedAt) {
    const gapDays = Math.floor(7 / perWeek);
    const last = new Date(input.lastAutoCreatedAt).getTime();
    if (Number.isFinite(last)) {
      const elapsedMs = input.now.getTime() - last;
      if (elapsedMs < gapDays * 24 * 60 * 60 * 1000) {
        return { create: false, reason: "min_gap_not_elapsed" };
      }
    }
  }
  return { create: true, reason: "due" };
}

export function weekStartIso(now: Date): string {
  // Monday-start week, UTC.
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = d.getUTCDay(); // 0=Sun
  const diff = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString();
}

// ── topic helpers ─────────────────────────────────────────────────────────────

function topicWords(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3);
}

export function topicsOverlap(a: string, b: string): boolean {
  const wa = new Set(topicWords(a));
  const wb = topicWords(b);
  if (wa.size === 0 || wb.length === 0) return false;
  const shared = wb.filter((w) => wa.has(w)).length;
  return shared >= 2 || (shared >= 1 && Math.min(wa.size, wb.length) <= 2);
}

// ── per-workspace tick ────────────────────────────────────────────────────────

export type SeoCampaignTickResult = {
  workspaceId: string;
  created: boolean;
  skipReason?: string;
  topic?: string;
  error?: string;
};

async function tickWorkspace(
  sb: ReturnType<typeof createClient>,
  workspaceId: string,
  perWeek: number,
): Promise<SeoCampaignTickResult> {
  const base = { workspaceId };
  const now = new Date();

  // Mode gate — proposals must be allowed (fail closed).
  const { isProposalAllowed } = await import("@/lib/hivemind/mode-gate.server");
  if (!(await isProposalAllowed(sb as any, workspaceId))) {
    return { ...base, created: false, skipReason: "proposals_not_allowed" };
  }

  // Existing auto campaigns this week + last auto creation (cadence).
  // Fail closed: a failed read must never look like "nothing exists yet".
  const { data: autoRows, error: autoErr } = await Promise.resolve((sb as any)
    .from("growthmind_seo_campaigns")
    .select("id, name, primary_topic, created_at, status")
    .eq("workspace_id", workspaceId)
    .like("name", `${AUTO_SEO_NAME_PREFIX}%`)
    .order("created_at", { ascending: false })
    .limit(50)
  ).catch((e: any) => ({ data: null, error: e }));
  if (autoErr || !autoRows) {
    return { ...base, created: false, skipReason: "cadence_read_failed" };
  }
  const auto = (autoRows ?? []) as any[];
  const wkStart = weekStartIso(now);
  const createdThisWeek = auto.filter((r) => (r.created_at ?? "") >= wkStart).length;

  const decision = computeAutoSeoDecision({
    perWeek,
    createdThisWeek,
    lastAutoCreatedAt: auto[0]?.created_at ?? null,
    now,
  });
  if (!decision.create) {
    return { ...base, created: false, skipReason: decision.reason };
  }

  // Existing topics (all non-cancelled campaigns + blog calendar) to avoid duplicates.
  // Fail closed: if either read fails we cannot prove uniqueness — skip.
  const [campaignsRes, calendarRes] = await Promise.all([
    Promise.resolve((sb as any)
      .from("growthmind_seo_campaigns")
      .select("name, primary_topic, status")
      .eq("workspace_id", workspaceId)
      .not("status", "in", "(cancelled,failed)")
      .limit(200)
    ).catch((e: any) => ({ data: null, error: e })),
    Promise.resolve((sb as any)
      .from("growthmind_content_calendar")
      .select("title")
      .eq("workspace_id", workspaceId)
      .eq("content_type", "Blog")
      .limit(200)
    ).catch((e: any) => ({ data: null, error: e })),
  ]);
  if (campaignsRes.error || !campaignsRes.data || calendarRes.error || !calendarRes.data) {
    return { ...base, created: false, skipReason: "dedup_read_failed" };
  }
  const allCampaigns = campaignsRes.data;
  const calendar = calendarRes.data;
  const existingTopics: string[] = [
    ...((allCampaigns ?? []) as any[]).map((c) => `${c.name} ${c.primary_topic ?? ""}`),
    ...((calendar ?? []) as any[]).map((c) => String(c.title ?? "")),
  ];
  const isDuplicate = (topic: string) => existingTopics.some((t) => topicsOverlap(t, topic));

  // Topic selection — GSC evidence first.
  let topic: string | null = null;
  let objective: string | null = null;
  try {
    const { detectOpportunities } = await import("@/lib/growthmind/seo-intelligence.server");
    const env = await detectOpportunities(workspaceId, [
      "high_impression_low_click",
      "near_page_one",
      "growing_query",
      "declining_query",
    ]);
    const ranked = [...(env.deliverables?.opportunities ?? [])].sort((a, b) => {
      const conf = (c: string) => (c === "high" ? 0 : c === "medium" ? 1 : 2);
      return conf(a.confidence) - conf(b.confidence);
    });
    for (const op of ranked) {
      if (!op.key || isDuplicate(op.key)) continue;
      topic = op.key;
      objective = `Auto-detected Search Console opportunity (${op.kind}): ${op.rationale}`;
      break;
    }
  } catch {
    // GSC unavailable — fall through to DNA.
  }

  // Fallback: Business-DNA-derived topic.
  if (!topic) {
    const { data: dna } = await Promise.resolve((sb as any)
      .from("growthmind_business_dna")
      .select("company_name, industry, services, core_services, ideal_customer_profiles, ideal_customer_profile")
      .eq("workspace_id", workspaceId)
      .maybeSingle()
    ).catch(() => ({ data: null }));
    const services = String(dna?.services ?? dna?.core_services ?? "");
    const service = services.split(/[,\n;]/)[0]?.trim();
    const audience = String(dna?.ideal_customer_profiles ?? dna?.ideal_customer_profile ?? "").split(/[,\n;]/)[0]?.trim();
    if (service && audience) {
      const candidate = `How ${audience} benefit from ${service}`;
      if (!isDuplicate(candidate)) {
        topic = candidate;
        objective = "Business-DNA-derived topic (no Search Console opportunity available yet).";
      }
    }
  }

  if (!topic) {
    return { ...base, created: false, skipReason: "no_unique_topic" };
  }

  // Atomic CAS claim: only one executor instance may create the next auto
  // campaign. The UPDATE re-checks the min-gap condition in the same
  // statement, so concurrent ticks (pg_cron double-fire, dev plugin + prod)
  // race on the row and exactly one wins. If create then fails, one cadence
  // slot is lost — acceptable; the next gap window retries.
  const gapDays = Math.floor(7 / Math.min(MAX_PER_WEEK, Math.max(1, Math.floor(perWeek))));
  const cutoffIso = new Date(now.getTime() - gapDays * 24 * 60 * 60 * 1000).toISOString();
  const { data: claimed, error: claimErr } = await Promise.resolve((sb as any)
    .from("workspace_settings")
    .update({ seo_auto_last_created_at: now.toISOString() })
    .eq("workspace_id", workspaceId)
    .gt("seo_auto_campaigns_per_week", 0)
    .or(`seo_auto_last_created_at.is.null,seo_auto_last_created_at.lte.${cutoffIso}`)
    .select("workspace_id")
  ).catch((e: any) => ({ data: null, error: e }));
  if (claimErr || !claimed || (claimed as any[]).length === 0) {
    return { ...base, created: false, skipReason: "claim_lost" };
  }

  const { createSeoCampaignCore } = await import("@/lib/growthmind/seo-blog-campaign.server");
  const res = await createSeoCampaignCore({
    workspaceId,
    userId: null,
    name: `${AUTO_SEO_NAME_PREFIX}${topic}`.slice(0, 200),
    campaignType: "blog",
    primaryTopic: topic,
    objective: objective ?? undefined,
  });
  if (!res.ok) {
    return { ...base, created: false, error: res.error ?? "create failed" };
  }
  return { ...base, created: true, topic };
}

// ── main export ───────────────────────────────────────────────────────────────

export type SeoCampaignTickReport = {
  created: SeoCampaignTickResult[];
  skipped: SeoCampaignTickResult[];
  failed: SeoCampaignTickResult[];
  error?: string;
};

export async function runSeoCampaignTick(): Promise<SeoCampaignTickReport> {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!supabaseUrl || !serviceRoleKey) {
    return { created: [], skipped: [], failed: [], error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" };
  }
  const sb = createClient(supabaseUrl, serviceRoleKey);

  const { data: eligible, error } = await Promise.resolve((sb as any)
    .from("workspace_settings")
    .select("workspace_id, seo_auto_campaigns_per_week")
    .gt("seo_auto_campaigns_per_week", 0)
  ).catch((e: any) => ({ data: null, error: e }));
  if (error || !eligible) {
    return { created: [], skipped: [], failed: [], error: String((error as any)?.message ?? error ?? "no data") };
  }

  const results: SeoCampaignTickResult[] = await Promise.all(
    (eligible as any[]).map((row) =>
      tickWorkspace(sb, row.workspace_id, Number(row.seo_auto_campaigns_per_week) || 0).catch((e: any) => ({
        workspaceId: row.workspace_id,
        created: false,
        error: e?.message ?? String(e),
      })),
    ),
  );

  return {
    created: results.filter((r) => r.created),
    skipped: results.filter((r) => !r.created && !r.error),
    failed: results.filter((r) => !!r.error),
  };
}
