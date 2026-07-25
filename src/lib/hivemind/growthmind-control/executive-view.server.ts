/**
 * HiveMind executive view over GrowthMind — SERVER ONLY.
 *
 * Read-only aggregation of the real GrowthMind state for a workspace:
 * social connections, trend pipeline, content command centre, publishing,
 * performance, costs, Business DNA completeness and commercial objectives.
 * Every query is workspace-scoped; nothing here mutates anything.
 */

type Sb = any;

async function getAdmin(): Promise<Sb> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

const DAY = 24 * 60 * 60 * 1000;

function countBy<T extends Record<string, any>>(rows: T[], key: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const k = String(r[key] ?? "unknown");
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

export interface GrowthMindExecutiveView {
  generatedAt: string;
  connections: {
    total: number;
    connected: number;
    byStatus: Record<string, number>;
    expiringSoon: Array<{ id: string; accountName: string | null; tokenExpiresAt: string | null }>;
  };
  trends: {
    byStatus: Record<string, number>;
    activeSources: number;
    pausedSources: number;
    lastDiscoveredAt: string | null;
    topRecommended: Array<{ id: string; title: string | null; platform: string; discoveredAt: string }>;
  };
  contentPipeline: {
    recommendationsByStatus: Record<string, number>;
    staleRecommendations: number;
    projectsByStatus: Record<string, number>;
    awaitingApproval: Array<{ id: string; title: string; approvalActionId: string | null }>;
    pendingApprovalActions: number;
  };
  publishing: {
    paused: boolean;
    jobsByStatus: Record<string, number>;
    failedJobs: Array<{ id: string; projectId: string | null; platform: string | null; error: string | null }>;
    nextScheduled: Array<{ id: string; scheduledAt: string | null; platform: string | null }>;
  };
  performance: {
    recentPosts: number;
    lastCapturedAt: string | null;
  };
  costs: {
    last30dUsd: number;
    monthToDateUsd: number;
    monthlyLimitUsd: number | null;
    byTaskType: Record<string, number>;
  };
  dna: {
    exists: boolean;
    completionPct: number | null;
    version: number | null;
    pendingProposals: number;
  };
  objectives: {
    active: Array<{ id: string; name: string; priority: string; endDate: string | null; businessOutcome: string | null }>;
    totalActive: number;
  };
  googleAds: {
    connected: boolean;
    accountName: string | null;
    connectionState: string | null;
    syncStatus: string | null;
    lastSyncedAt: string | null;
    currency: string | null;
    campaigns: Array<{
      campaignId: string; name: string; status: string | null; channelType: string | null;
      dailyBudget: number; cost: number; impressions: number; clicks: number; conversions: number;
    }>;
  };
  jobsPaused: boolean;
}

export async function buildGrowthMindExecutiveView(workspaceId: string): Promise<GrowthMindExecutiveView> {
  const admin = await getAdmin();
  const now = Date.now();
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
  const d30 = new Date(now - 30 * DAY).toISOString();
  const d7 = new Date(now - 7 * DAY).toISOString();

  const [conns, trendItems, sources, recs, projects, jobs, pendingActions, snaps, genLogs, dna, proposals, objectives, settings] =
    await Promise.all([
      admin.from("growthmind_social_connections")
        .select("id, status, account_name, token_expires_at")
        .eq("workspace_id", workspaceId),
      admin.from("growthmind_trend_items")
        .select("id, status, title, platform, discovered_at")
        .eq("workspace_id", workspaceId)
        .gte("discovered_at", d30)
        .order("discovered_at", { ascending: false })
        .limit(500),
      admin.from("growthmind_monitored_sources")
        .select("id, status")
        .eq("workspace_id", workspaceId),
      admin.from("growthmind_content_recommendations")
        .select("id, status, created_at")
        .eq("workspace_id", workspaceId)
        .gte("created_at", d30)
        .limit(500),
      admin.from("growthmind_content_projects")
        .select("id, title, status, approval_action_id")
        .eq("workspace_id", workspaceId)
        .neq("status", "archived")
        .limit(300),
      admin.from("growthmind_publishing_jobs")
        .select("id, status, platform, scheduled_at, error_message, project_id, created_at")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(200),
      admin.from("hivemind_actions")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .eq("action_type", "growthmind_publish_content")
        .eq("status", "pending"),
      admin.from("growthmind_performance_snapshots")
        .select("publishing_job_id, captured_at")
        .eq("workspace_id", workspaceId)
        .gte("captured_at", d30)
        .order("captured_at", { ascending: false })
        .limit(200),
      admin.from("growthmind_generation_logs")
        .select("task_type, estimated_cost_usd, created_at")
        .eq("workspace_id", workspaceId)
        .gte("created_at", d30)
        .limit(2000),
      admin.from("growthmind_business_dna")
        .select("*")
        .eq("workspace_id", workspaceId)
        .maybeSingle(),
      admin.from("growthmind_dna_proposals")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .eq("status", "proposed"),
      admin.from("growthmind_objectives")
        .select("id, name, priority, end_date, business_outcome")
        .eq("workspace_id", workspaceId)
        .eq("status", "active")
        .order("priority", { ascending: false })
        .limit(20),
      admin.from("workspace_settings")
        .select("growthmind_publishing_paused, growthmind_jobs_paused, growthmind_monthly_cost_limit_usd")
        .eq("workspace_id", workspaceId)
        .maybeSingle(),
    ]);

  const connRows = conns.data ?? [];
  const trendRows = trendItems.data ?? [];
  const srcRows = sources.data ?? [];
  const recRows = recs.data ?? [];
  const projRows = projects.data ?? [];
  const jobRows = jobs.data ?? [];
  const genRows = genLogs.data ?? [];

  const expiringSoon = connRows
    .filter((c: any) => c.status === "connected" && c.token_expires_at && new Date(c.token_expires_at).getTime() < now + 7 * DAY)
    .map((c: any) => ({ id: c.id, accountName: c.account_name ?? null, tokenExpiresAt: c.token_expires_at ?? null }));

  const staleRecommendations = recRows.filter(
    (r: any) => ["recommended", "analysed"].includes(r.status) && r.created_at < d7,
  ).length;

  const cost = (rows: any[], sinceIso?: string) =>
    Math.round(
      rows
        .filter((r) => (sinceIso ? r.created_at >= sinceIso : true))
        .reduce((s, r) => s + (Number(r.estimated_cost_usd) || 0), 0) * 10000,
    ) / 10000;

  const byTaskType: Record<string, number> = {};
  for (const r of genRows) {
    const k = String(r.task_type ?? "other");
    byTaskType[k] = Math.round(((byTaskType[k] ?? 0) + (Number(r.estimated_cost_usd) || 0)) * 10000) / 10000;
  }

  // Live Google Ads (real synced campaigns from growthmind_gads_campaign_daily —
  // the only table the live Google engine writes campaigns to). Graceful: null on failure.
  let gadsAccount: any = null;
  let gadsSummary: { campaigns: any[]; currency: string | null } | null = null;
  try {
    const core = await import("@/lib/growthmind/gads-live-core.server");
    [gadsAccount, gadsSummary] = await Promise.all([
      core.getGoogleAccountRow(workspaceId),
      core.getGadsLiveCampaignSummary(workspaceId),
    ]);
  } catch { /* optional */ }

  let completionPct: number | null = null;
  if (dna.data) {
    try {
      const { computeDnaCompletionScore, mapBusinessDnaRow } = await import("@/lib/growthmind/growthmind.business-dna");
      completionPct = computeDnaCompletionScore(mapBusinessDnaRow(dna.data)).pct ?? null;
    } catch { completionPct = null; }
  }

  return {
    generatedAt: new Date().toISOString(),
    connections: {
      total: connRows.length,
      connected: connRows.filter((c: any) => c.status === "connected").length,
      byStatus: countBy(connRows, "status"),
      expiringSoon,
    },
    trends: {
      byStatus: countBy(trendRows, "status"),
      activeSources: srcRows.filter((s: any) => s.status === "active").length,
      pausedSources: srcRows.filter((s: any) => s.status === "paused").length,
      lastDiscoveredAt: trendRows[0]?.discovered_at ?? null,
      topRecommended: trendRows
        .filter((t: any) => t.status === "recommended")
        .slice(0, 5)
        .map((t: any) => ({ id: t.id, title: t.title ?? null, platform: t.platform, discoveredAt: t.discovered_at })),
    },
    contentPipeline: {
      recommendationsByStatus: countBy(recRows, "status"),
      staleRecommendations,
      projectsByStatus: countBy(projRows, "status"),
      awaitingApproval: projRows
        .filter((p: any) => p.status === "awaiting_approval")
        .slice(0, 10)
        .map((p: any) => ({ id: p.id, title: p.title, approvalActionId: p.approval_action_id ?? null })),
      pendingApprovalActions: pendingActions.count ?? 0,
    },
    publishing: {
      paused: settings.data?.growthmind_publishing_paused === true,
      jobsByStatus: countBy(jobRows, "status"),
      failedJobs: jobRows
        .filter((j: any) => j.status === "failed")
        .slice(0, 10)
        .map((j: any) => ({
          id: j.id, projectId: j.project_id ?? null, platform: j.platform ?? null,
          error: j.error_message ? String(j.error_message).slice(0, 300) : null,
        })),
      nextScheduled: jobRows
        .filter((j: any) => ["approved", "scheduled"].includes(j.status))
        .sort((a: any, b: any) => String(a.scheduled_at ?? "9999").localeCompare(String(b.scheduled_at ?? "9999")))
        .slice(0, 5)
        .map((j: any) => ({ id: j.id, scheduledAt: j.scheduled_at ?? null, platform: j.platform ?? null })),
    },
    performance: {
      recentPosts: new Set((snaps.data ?? []).map((s: any) => s.publishing_job_id)).size,
      lastCapturedAt: snaps.data?.[0]?.captured_at ?? null,
    },
    costs: {
      last30dUsd: cost(genRows),
      monthToDateUsd: cost(genRows, monthStart),
      monthlyLimitUsd: settings.data?.growthmind_monthly_cost_limit_usd != null
        ? Number(settings.data.growthmind_monthly_cost_limit_usd) : null,
      byTaskType,
    },
    dna: {
      exists: !!dna.data,
      completionPct,
      version: dna.data?.dna_version != null ? Number(dna.data.dna_version) : null,
      pendingProposals: proposals.count ?? 0,
    },
    objectives: {
      active: (objectives.data ?? []).map((o: any) => ({
        id: o.id, name: o.name, priority: o.priority,
        endDate: o.end_date ?? null, businessOutcome: o.business_outcome ?? null,
      })),
      totalActive: (objectives.data ?? []).length,
    },
    googleAds: {
      connected: !!gadsAccount && gadsAccount.status === "active",
      accountName: gadsAccount?.descriptive_name ?? gadsAccount?.label ?? null,
      connectionState: gadsAccount?.connection_state ?? null,
      syncStatus: gadsAccount?.sync_status ?? null,
      lastSyncedAt: gadsAccount?.last_synced_at ?? null,
      currency: gadsSummary?.currency ?? gadsAccount?.currency_code ?? null,
      campaigns: (gadsSummary?.campaigns ?? []).slice(0, 12).map((c: any) => ({
        campaignId: c.campaignId, name: c.name, status: c.status, channelType: c.channelType,
        dailyBudget: c.dailyBudget, cost: Math.round(c.cost * 100) / 100,
        impressions: c.impressions, clicks: c.clicks, conversions: c.conversions,
      })),
    },
    jobsPaused: settings.data?.growthmind_jobs_paused === true,
  };
}

// ── Operational health checks (deterministic, honest) ───────────────────────

export interface GrowthMindHealthCheck {
  key: string;
  ok: boolean;
  severity: "info" | "warning" | "critical";
  message: string;
  recommendedTool?: string;
}

export interface GrowthMindHealthReport {
  status: "healthy" | "degraded" | "critical";
  checks: GrowthMindHealthCheck[];
  generatedAt: string;
}

export async function checkGrowthMindOperationalHealth(
  workspaceId: string,
  view?: GrowthMindExecutiveView,
): Promise<GrowthMindHealthReport> {
  const v = view ?? (await buildGrowthMindExecutiveView(workspaceId));
  const checks: GrowthMindHealthCheck[] = [];
  const add = (key: string, ok: boolean, severity: GrowthMindHealthCheck["severity"], message: string, recommendedTool?: string) =>
    checks.push({ key, ok, severity: ok ? "info" : severity, message, recommendedTool });

  const failedCount = v.publishing.jobsByStatus["failed"] ?? 0;
  add("publishing_failures", failedCount === 0, "critical",
    failedCount === 0 ? "No failed publishing jobs." : `${failedCount} publishing job(s) failed.`,
    failedCount ? "retry_failed_publication" : undefined);

  add("publishing_paused", !v.publishing.paused, "warning",
    v.publishing.paused ? "Publishing is PAUSED for this workspace." : "Publishing is active.",
    v.publishing.paused ? "resume_publishing" : undefined);

  add("jobs_paused", !v.jobsPaused, "warning",
    v.jobsPaused ? "GrowthMind background jobs are PAUSED." : "GrowthMind background jobs are active.",
    v.jobsPaused ? "resume_growthmind_jobs" : undefined);

  add("token_expiry", v.connections.expiringSoon.length === 0, "warning",
    v.connections.expiringSoon.length === 0
      ? "No social tokens expiring within 7 days."
      : `${v.connections.expiringSoon.length} social connection token(s) expire within 7 days — reconnect them.`);

  const hasSources = v.trends.activeSources > 0;
  const lastDisc = v.trends.lastDiscoveredAt ? Date.now() - new Date(v.trends.lastDiscoveredAt).getTime() : null;
  add("trend_discovery_fresh", !hasSources || (lastDisc != null && lastDisc < 2 * DAY), "warning",
    !hasSources
      ? "No active monitored sources — trend discovery is idle by configuration."
      : lastDisc == null
        ? "Sources are monitored but no trend items have ever been discovered."
        : lastDisc < 2 * DAY
          ? "Trend discovery ran within the last 48h."
          : `No new trend items in ${Math.floor(lastDisc / DAY)} days despite active sources.`);

  add("stale_recommendations", v.contentPipeline.staleRecommendations === 0, "warning",
    v.contentPipeline.staleRecommendations === 0
      ? "No stale content recommendations."
      : `${v.contentPipeline.staleRecommendations} recommendation(s) older than 7 days with no decision.`,
    v.contentPipeline.staleRecommendations ? "get_trend_opportunities" : undefined);

  const awaiting = v.contentPipeline.awaitingApproval.length;
  add("approvals_waiting", awaiting === 0, "warning",
    awaiting === 0 ? "No content waiting on approval." : `${awaiting} project(s) waiting for publish approval.`,
    awaiting ? "get_content_command_centre" : undefined);

  add("dna_completeness", v.dna.exists && (v.dna.completionPct ?? 0) >= 40, "warning",
    !v.dna.exists
      ? "No Business DNA yet — GrowthMind output quality is limited until it exists."
      : (v.dna.completionPct ?? 0) >= 40
        ? `Business DNA is ${v.dna.completionPct}% complete.`
        : `Business DNA is only ${v.dna.completionPct}% complete — enrich it.`);

  if (v.costs.monthlyLimitUsd != null) {
    const over = v.costs.monthToDateUsd >= v.costs.monthlyLimitUsd;
    const near = v.costs.monthToDateUsd >= 0.8 * v.costs.monthlyLimitUsd;
    add("cost_limit", !over, over ? "critical" : "warning",
      over
        ? `Month-to-date AI spend $${v.costs.monthToDateUsd} has reached the $${v.costs.monthlyLimitUsd} limit.`
        : near
          ? `Month-to-date AI spend $${v.costs.monthToDateUsd} is above 80% of the $${v.costs.monthlyLimitUsd} limit.`
          : `AI spend $${v.costs.monthToDateUsd} is within the $${v.costs.monthlyLimitUsd} monthly limit.`);
  }

  const failing = checks.filter((c) => !c.ok);
  const status = failing.some((c) => c.severity === "critical")
    ? "critical"
    : failing.length > 0 ? "degraded" : "healthy";
  return { status, checks, generatedAt: new Date().toISOString() };
}

/** Compact context block for the HiveMind chat system prompt / briefing. */
export async function buildGrowthMindCommandContext(workspaceId: string): Promise<string> {
  try {
    const v = await buildGrowthMindExecutiveView(workspaceId);
    const h = await checkGrowthMindOperationalHealth(workspaceId, v);
    const issues = h.checks.filter((c) => !c.ok).map((c) => `- ${c.message}`).join("\n");
    return [
      "",
      "=== GROWTHMIND COMMAND CENTRE (live) ===",
      `Marketing health: ${h.status.toUpperCase()}`,
      `Social connections: ${v.connections.connected}/${v.connections.total} connected${v.connections.expiringSoon.length ? ` (${v.connections.expiringSoon.length} token(s) expiring soon)` : ""}`,
      `Trend pipeline: ${v.trends.byStatus["recommended"] ?? 0} recommended, ${v.trends.activeSources} active sources`,
      `Content: ${JSON.stringify(v.contentPipeline.projectsByStatus)}; ${v.contentPipeline.pendingApprovalActions} publish approval(s) pending`,
      `Publishing: ${v.publishing.paused ? "PAUSED" : "active"}; ${v.publishing.jobsByStatus["failed"] ?? 0} failed job(s); ${v.publishing.nextScheduled.length} scheduled`,
      `AI spend: $${v.costs.monthToDateUsd} MTD${v.costs.monthlyLimitUsd != null ? ` of $${v.costs.monthlyLimitUsd} limit` : ""}`,
      `Business DNA: ${v.dna.exists ? `${v.dna.completionPct}% complete (v${v.dna.version})` : "missing"}; ${v.dna.pendingProposals} proposal(s) pending`,
      `Objectives: ${v.objectives.totalActive} active${v.objectives.active.length ? ` — ${v.objectives.active.map((o) => o.name).join("; ").slice(0, 300)}` : ""}`,
      v.googleAds.connected
        ? `Google Ads: "${v.googleAds.accountName ?? "account"}" ${v.googleAds.connectionState ?? ""}; campaigns (30d): ${
            v.googleAds.campaigns.length
              ? v.googleAds.campaigns.slice(0, 5).map((c) => `"${c.name}" [${c.status ?? "?"}] spend ${v.googleAds.currency ?? ""} ${c.cost.toFixed(2)}, ${c.clicks} clicks, ${c.conversions} conv`).join("; ")
              : "none synced yet"
          }`
        : "Google Ads: not connected",
      issues ? `Open issues:\n${issues}` : "No open issues.",
      "You (HiveMind) have REAL GrowthMind tools — use them instead of guessing. Never claim an action succeeded unless the tool result confirms it.",
    ].join("\n");
  } catch (e: any) {
    return `\n=== GROWTHMIND COMMAND CENTRE ===\nUnavailable: ${String(e?.message ?? e).slice(0, 200)}`;
  }
}
