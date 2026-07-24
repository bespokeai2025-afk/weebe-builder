/**
 * GrowthMind Phase 5 — checkpointed performance snapshots.
 *
 * Published content (growthmind_publishing_jobs, status "published") gets
 * automatic metric snapshots at fixed checkpoints after publish:
 *   1h / 6h / 24h / 72h / 7d / 30d
 * Metrics come from the workspace's OWN authorised Meta connection (Graph
 * insights) and are categorised into attention / engagement / intent /
 * conversion / revenue buckets, with lead/booking attribution against WEBEE
 * data. Content is never judged on views alone.
 *
 * Snapshot rows land in growthmind_performance_snapshots (SELECT-only for
 * authenticated; service-role writes). Each row's metrics JSONB carries:
 *   { checkpoint, raw, categories, attribution, capture_error? }
 *
 * Called from the dev Vite scheduler plugin and the prod campaign-executor
 * endpoint (same dual wiring as runContentPublishTick).
 */
import { META_GRAPH_VERSION } from "./meta-oauth.functions";

type Sb = any;

async function getAdmin(): Promise<Sb> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

const GRAPH = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
const nowIso = () => new Date().toISOString();

// ── Checkpoints ───────────────────────────────────────────────────────────────

export interface Checkpoint { key: string; minutes: number }

export const SNAPSHOT_CHECKPOINTS: Checkpoint[] = [
  { key: "1h",  minutes: 60 },
  { key: "6h",  minutes: 360 },
  { key: "24h", minutes: 1440 },
  { key: "72h", minutes: 4320 },
  { key: "7d",  minutes: 10080 },
  { key: "30d", minutes: 43200 },
];

/**
 * Which checkpoints are due (elapsed and not yet captured). Pure — tested.
 * Missed checkpoints are still captured late (better late data than none),
 * except ones older than the NEXT checkpoint boundary + 30d hard stop.
 */
export function computeDueCheckpoints(
  publishedAtIso: string,
  capturedKeys: string[],
  now: Date = new Date(),
): Checkpoint[] {
  const publishedAt = new Date(publishedAtIso).getTime();
  if (!Number.isFinite(publishedAt)) return [];
  const elapsedMin = (now.getTime() - publishedAt) / 60_000;
  if (elapsedMin < 0) return [];
  const captured = new Set(capturedKeys);
  return SNAPSHOT_CHECKPOINTS.filter(
    (c) => elapsedMin >= c.minutes && !captured.has(c.key),
  );
}

// ── Metric categorisation ─────────────────────────────────────────────────────

export interface CategorisedMetrics {
  attention:  Record<string, number>;
  engagement: Record<string, number>;
  intent:     Record<string, number>;
  conversion: Record<string, number>;
  revenue:    Record<string, number>;
}

const CATEGORY_MAP: Record<keyof CategorisedMetrics, string[]> = {
  attention:  ["impressions", "reach", "views", "video_views", "plays", "post_impressions", "post_impressions_unique"],
  engagement: ["likes", "like_count", "comments", "comments_count", "shares", "saved", "saves", "total_interactions", "reactions", "post_reactions_like_total"],
  intent:     ["profile_visits", "profile_activity", "website_clicks", "follows", "post_clicks", "link_clicks", "navigation"],
  conversion: ["attributed_leads", "attributed_bookings"],
  revenue:    ["attributed_sales"],
};

/** Sort raw metric key/values into the five judgement buckets. Pure — tested. */
export function categoriseMetrics(raw: Record<string, unknown>): CategorisedMetrics {
  const out: CategorisedMetrics = { attention: {}, engagement: {}, intent: {}, conversion: {}, revenue: {} };
  for (const [cat, keys] of Object.entries(CATEGORY_MAP) as [keyof CategorisedMetrics, string[]][]) {
    for (const k of keys) {
      const v = raw[k];
      const n = typeof v === "number" ? v : Number(v);
      if (v !== undefined && v !== null && Number.isFinite(n)) out[cat][k] = n;
    }
  }
  return out;
}

// ── Meta insights fetch ───────────────────────────────────────────────────────

async function graphGet(path: string, params: Record<string, string>): Promise<{ ok: boolean; json: any }> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${GRAPH}/${path}?${qs}`);
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, json };
}

/**
 * Fetch post metrics from Meta. Returns { raw } on success or { error } —
 * never throws. Tolerant of per-metric unavailability (older API media,
 * missing permissions): whatever comes back is stored, the rest is absent.
 */
async function fetchMetaPostMetrics(opts: {
  token: string;
  platform: string;          // instagram | facebook
  externalPostId: string;
}): Promise<{ raw: Record<string, number>; error?: string }> {
  const { token, platform, externalPostId } = opts;
  const raw: Record<string, number> = {};
  let errorMsg: string | undefined;

  if (platform === "instagram") {
    const ins = await graphGet(`${externalPostId}/insights`, {
      metric: "reach,likes,comments,shares,saved,views,total_interactions,profile_visits,follows",
      access_token: token,
    });
    if (ins.ok && Array.isArray(ins.json?.data)) {
      for (const m of ins.json.data) {
        const v = m?.values?.[0]?.value;
        if (typeof v === "number") raw[String(m.name)] = v;
      }
    } else if (!ins.ok) {
      // Retry with the always-available core set (some metrics 400 on some media types)
      const core = await graphGet(`${externalPostId}/insights`, {
        metric: "reach,likes,comments,shares,saved",
        access_token: token,
      });
      if (core.ok && Array.isArray(core.json?.data)) {
        for (const m of core.json.data) {
          const v = m?.values?.[0]?.value;
          if (typeof v === "number") raw[String(m.name)] = v;
        }
      } else {
        errorMsg = String(core.json?.error?.message ?? ins.json?.error?.message ?? "insights unavailable").slice(0, 300);
      }
    }
    const fields = await graphGet(externalPostId, { fields: "like_count,comments_count", access_token: token });
    if (fields.ok) {
      if (typeof fields.json?.like_count === "number") raw.like_count = fields.json.like_count;
      if (typeof fields.json?.comments_count === "number") raw.comments_count = fields.json.comments_count;
    }
  } else {
    // Facebook page post
    const ins = await graphGet(`${externalPostId}/insights`, {
      metric: "post_impressions,post_impressions_unique,post_clicks,post_reactions_like_total",
      access_token: token,
    });
    if (ins.ok && Array.isArray(ins.json?.data)) {
      for (const m of ins.json.data) {
        const v = m?.values?.[0]?.value;
        if (typeof v === "number") raw[String(m.name)] = v;
      }
    } else {
      errorMsg = String(ins.json?.error?.message ?? "insights unavailable").slice(0, 300);
    }
    const fields = await graphGet(externalPostId, {
      fields: "shares,likes.summary(true).limit(0),comments.summary(true).limit(0)",
      access_token: token,
    });
    if (fields.ok) {
      const shares = fields.json?.shares?.count;
      const likes = fields.json?.likes?.summary?.total_count;
      const comments = fields.json?.comments?.summary?.total_count;
      if (typeof shares === "number") raw.shares = shares;
      if (typeof likes === "number") raw.likes = likes;
      if (typeof comments === "number") raw.comments = comments;
    }
  }

  if (Object.keys(raw).length === 0 && errorMsg) return { raw, error: errorMsg };
  return { raw, error: errorMsg };
}

// ── Lead / booking attribution ────────────────────────────────────────────────

// Sources that plausibly originate from social content. Attribution is a
// windowed heuristic (leads created after publish from social-ish sources) —
// the method is stored alongside the numbers so it is never presented as
// pixel-perfect tracking.
const SOCIAL_LEAD_SOURCES = ["facebook_lead_form", "website", "website_form", "landing_page", "inbound", "webee_website_form"];

async function computeAttribution(
  admin: Sb,
  workspaceId: string,
  publishedAtIso: string,
  capturedAtIso: string,
): Promise<Record<string, unknown>> {
  const attribution: Record<string, unknown> = {
    method: "windowed-source-heuristic",
    window: { from: publishedAtIso, to: capturedAtIso },
    attributed_leads: 0,
    attributed_bookings: 0,
    attributed_sales: 0,
  };
  try {
    const { data: leadRows, error } = await admin
      .from("leads")
      .select("id,status")
      .eq("workspace_id", workspaceId)
      .in("source", SOCIAL_LEAD_SOURCES)
      .gte("created_at", publishedAtIso)
      .lte("created_at", capturedAtIso)
      .limit(1000);
    if (error) {
      attribution.error = error.message.slice(0, 300);
      return attribution;
    }
    const leads = leadRows ?? [];
    attribution.attributed_leads = leads.length;
    attribution.attributed_sales = leads.filter((l: any) => l.status === "sale_done").length;
    if (leads.length > 0) {
      const ids = leads.map((l: any) => l.id);
      const { count, error: bErr } = await admin
        .from("calendar_bookings")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .in("lead_id", ids.slice(0, 500));
      if (!bErr && typeof count === "number") attribution.attributed_bookings = count;
    }
  } catch (e: any) {
    attribution.error = String(e?.message ?? e).slice(0, 300);
  }
  return attribution;
}

// ── Snapshot capture ──────────────────────────────────────────────────────────

async function captureSnapshot(
  admin: Sb,
  job: Record<string, any>,
  checkpoint: Checkpoint,
): Promise<{ ok: boolean; error?: string }> {
  const workspaceId = job.workspace_id as string;
  const capturedAt = nowIso();

  let raw: Record<string, number> = {};
  let captureError: string | undefined;

  // Connection + token (per-workspace authorised Meta connection)
  const { data: conn } = await admin
    .from("growthmind_social_connections")
    .select("id, status, access_token_encrypted")
    .eq("id", job.connection_id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (!conn || conn.status !== "connected" || !conn.access_token_encrypted) {
    captureError = "connection_unavailable";
  } else {
    try {
      const { decryptMetaToken } = await import("@/lib/growthmind/meta-token.server");
      const token = decryptMetaToken(conn.access_token_encrypted);
      const fetched = await fetchMetaPostMetrics({
        token,
        platform: String(job.platform ?? "instagram"),
        externalPostId: String(job.external_post_id),
      });
      raw = fetched.raw;
      if (fetched.error) captureError = fetched.error;
    } catch {
      captureError = "token_undecryptable";
    }
  }

  const attribution = await computeAttribution(admin, workspaceId, job.published_at, capturedAt);
  const rawWithAttribution: Record<string, unknown> = {
    ...raw,
    attributed_leads:    attribution.attributed_leads,
    attributed_bookings: attribution.attributed_bookings,
    attributed_sales:    attribution.attributed_sales,
  };
  const categories = categoriseMetrics(rawWithAttribution);

  const { error: insErr } = await admin.from("growthmind_performance_snapshots").insert({
    workspace_id:      workspaceId,
    publishing_job_id: job.id,
    connection_id:     job.connection_id,
    external_post_id:  job.external_post_id,
    platform:          job.platform,
    captured_at:       capturedAt,
    metrics: {
      checkpoint: checkpoint.key,
      raw,
      categories,
      attribution,
      ...(captureError ? { capture_error: captureError } : {}),
    },
  });
  if (insErr) return { ok: false, error: insErr.message };
  return { ok: true, error: captureError };
}

// ── Background tick ───────────────────────────────────────────────────────────

/**
 * Capture due snapshots for recently published jobs. Bounded: max 15 jobs and
 * ONE checkpoint per job per tick (the earliest due) so a backlog drains
 * gradually without hammering the Graph API.
 */
export async function runPerformanceSnapshotTick(): Promise<{
  jobsChecked: number;
  captured: number;
  errors: number;
}> {
  const admin = await getAdmin();
  const since = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();

  const { data: jobs, error } = await admin
    .from("growthmind_publishing_jobs")
    .select("id, workspace_id, connection_id, platform, target_type, external_post_id, published_at, recommendation_id, project_id")
    .eq("status", "published")
    .not("external_post_id", "is", null)
    .gte("published_at", since)
    .order("published_at", { ascending: false })
    .limit(60);
  if (error) {
    console.warn("[perf-snapshots] job query failed:", error.message);
    return { jobsChecked: 0, captured: 0, errors: 1 };
  }
  const jobList = jobs ?? [];
  if (jobList.length === 0) return { jobsChecked: 0, captured: 0, errors: 0 };

  // Existing checkpoints per job (single query)
  const jobIds = jobList.map((j: any) => j.id);
  const { data: snaps } = await admin
    .from("growthmind_performance_snapshots")
    .select("publishing_job_id, metrics")
    .in("publishing_job_id", jobIds)
    .limit(2000);
  const capturedByJob = new Map<string, string[]>();
  for (const s of snaps ?? []) {
    const key = (s.metrics as any)?.checkpoint;
    if (!key) continue;
    const arr = capturedByJob.get(s.publishing_job_id) ?? [];
    arr.push(String(key));
    capturedByJob.set(s.publishing_job_id, arr);
  }

  let captured = 0, errors = 0, processed = 0;
  for (const job of jobList) {
    if (processed >= 15) break;
    const due = computeDueCheckpoints(job.published_at, capturedByJob.get(job.id) ?? []);
    if (due.length === 0) continue;
    processed++;
    const r = await captureSnapshot(admin, job, due[0]);
    if (r.ok) captured++;
    if (!r.ok || r.error) errors++;
  }

  // Attention scan + learning analysis piggyback on this tick, per workspace
  // that had activity. Best-effort — never blocks snapshot capture.
  try {
    const wsSet = new Set<string>(jobList.map((j: any) => String(j.workspace_id)));
    // Workspaces with connected social accounts also need attention scans
    // (token expiry, stale trends) even with nothing recently published.
    const { data: connWs } = await admin
      .from("growthmind_social_connections")
      .select("workspace_id")
      .in("status", ["connected", "needs_reconnect", "expired"])
      .limit(200);
    for (const c of connWs ?? []) wsSet.add(String(c.workspace_id));
    const workspaceIds = [...wsSet];
    const { runContentAttentionScan } = await import("@/lib/growthmind/content-attention-scan.server");
    const { runLearningAnalysis } = await import("@/lib/growthmind/learning-engine.server");
    for (const ws of workspaceIds.slice(0, 10)) {
      try { await runContentAttentionScan(ws); } catch { /* per-ws best-effort */ }
      try { await runLearningAnalysis(ws); } catch { /* per-ws best-effort */ }
    }
  } catch { /* modules load best-effort */ }

  return { jobsChecked: jobList.length, captured, errors };
}
