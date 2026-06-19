/**
 * HiveMind API Engine Scanner
 *
 * Analyses api_engine_logs (last 24 h) and emits HiveMind recommendations
 * for: record count drops, consecutive error runs, pagination gaps,
 * bulk-retrieval opportunities, and token age warnings.
 *
 * Called from hivemind.functions.ts — server-side only.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Recommendation } from "@/lib/hivemind/recommendations";

// ── Public scanner entry-point ────────────────────────────────────────────────

export async function scanApiEngine(workspaceId: string): Promise<Recommendation[]> {
  const recs: Recommendation[] = [];
  const sb = supabaseAdmin as any;

  // ── Gather 24h logs ──────────────────────────────────────────────────────────
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const since7d  = new Date(Date.now() - 7  * 24 * 60 * 60 * 1000).toISOString();

  const [logsRes, weekRes, profilesRes, integRes] = await Promise.all([
    sb.from("api_engine_logs")
      .select("module_key, status_code, latency_ms, record_count, total_reported, page_fetched, error_msg, requested_at")
      .eq("workspace_id", workspaceId)
      .gte("requested_at", since24h)
      .order("requested_at", { ascending: false })
      .limit(1000),

    sb.from("api_engine_logs")
      .select("module_key, record_count, requested_at")
      .eq("workspace_id", workspaceId)
      .gte("requested_at", since7d)
      .lt("requested_at", since24h)
      .order("requested_at", { ascending: false })
      .limit(5000),

    sb.from("workspace_api_profiles")
      .select("id, data_source_key, is_active, updated_at, engine_config")
      .eq("workspace_id", workspaceId)
      .eq("is_active", true),

    sb.from("enterprise_integrations")
      .select("integration_key, status, updated_at")
      .eq("integration_key", "webespoke_enterprise")
      .maybeSingle(),
  ]);

  const logs24h: any[]    = logsRes.data  ?? [];
  const logs7d:  any[]    = weekRes.data  ?? [];
  const profiles: any[]   = profilesRes.data ?? [];

  if (logs24h.length === 0 && profiles.length === 0) return recs;

  // ── Per-module grouping ───────────────────────────────────────────────────────

  const moduleKeys = [...new Set([...logs24h, ...logs7d].map((l: any) => l.module_key as string))];

  for (const moduleKey of moduleKeys) {
    const recent   = logs24h.filter((l: any) => l.module_key === moduleKey);
    const historic = logs7d.filter((l: any)  => l.module_key === moduleKey);

    if (recent.length === 0) continue;

    // 1. Record count drop >20% vs 7-day average ──────────────────────────────
    if (historic.length >= 3) {
      const historicAvg = historic
        .filter((l: any) => l.record_count != null)
        .reduce((sum: number, l: any) => sum + (l.record_count as number), 0)
        / Math.max(historic.filter((l: any) => l.record_count != null).length, 1);

      const recentCounts = recent.filter((l: any) => l.record_count != null);
      if (recentCounts.length > 0) {
        const recentAvg = recentCounts.reduce((sum: number, l: any) => sum + (l.record_count as number), 0) / recentCounts.length;
        if (historicAvg > 10 && recentAvg < historicAvg * 0.8) {
          const drop = Math.round((1 - recentAvg / historicAvg) * 100);
          recs.push({
            id:       `api-engine-count-drop-${moduleKey}`,
            category: "API Engine",
            priority: "high",
            problem:  `Record count for "${moduleKey}" dropped ${drop}% in the last 24 h`,
            impact:   `7-day average: ${Math.round(historicAvg)} records. Recent average: ${Math.round(recentAvg)}. Data may be incomplete or the external API may have throttled access.`,
            fix:      `Check the API Engine logs in SystemMind → API Probe → Engine Status. Verify the external API is reachable and credentials are current.`,
            action:   { label: "API Engine Status", href: "/systemmind/clients" },
          });
        }
      }
    }

    // 2. Consecutive 4xx/5xx errors ────────────────────────────────────────────
    const errors4xx5xx = recent.filter((l: any) => {
      const sc = l.status_code as number | null;
      return sc != null && sc >= 400;
    });
    if (errors4xx5xx.length >= 3) {
      const lastErr  = errors4xx5xx[0];
      const errCodes = [...new Set(errors4xx5xx.map((l: any) => l.status_code as number))].join(", ");
      recs.push({
        id:       `api-engine-errors-${moduleKey}`,
        category: "API Engine",
        priority: errors4xx5xx.some((l: any) => l.status_code === 401) ? "critical" : "high",
        problem:  `${errors4xx5xx.length} consecutive HTTP errors on "${moduleKey}" module (codes: ${errCodes})`,
        impact:   `External API requests are failing. Last error: ${lastErr.error_msg ?? `HTTP ${lastErr.status_code}`}. Downstream data may be stale.`,
        fix:      errors4xx5xx.some((l: any) => l.status_code === 401)
          ? "Token has expired. Reconnect the external API in SystemMind → API Probe or trigger a token refresh."
          : "Check API availability and verify credentials in SystemMind → API Probe → Connections.",
        action: { label: "API Probe", href: "/systemmind/clients" },
      });
    }

    // 3. Pagination gap — totalReported >> records actually fetched ───────────
    const paginatedLogs = recent.filter((l: any) =>
      l.total_reported != null && l.record_count != null &&
      (l.total_reported as number) > (l.record_count as number) * 2 &&
      (l.page_fetched as number | null) === 1
    );
    if (paginatedLogs.length >= 2) {
      const log       = paginatedLogs[0];
      const totalRep  = log.total_reported as number;
      const recCount  = log.record_count  as number;
      const estimated = Math.ceil(totalRep / Math.max(recCount, 1));
      recs.push({
        id:       `api-engine-pagination-gap-${moduleKey}`,
        category: "API Engine",
        priority: "medium",
        problem:  `"${moduleKey}" endpoint reports ${totalRep} total records but only ${recCount} are being fetched (1 page of ~${estimated})`,
        impact:   "Downstream pages and exports are showing incomplete data. Users may make decisions on a partial dataset.",
        fix:      "Update the endpoint mapping's pagination strategy in API Probe → Mappings to loop through all pages, or enable the bulk-retrieval parameter if the API supports it.",
        action:   { label: "API Probe Mappings", href: "/systemmind/clients" },
      });
    }

    // 4. Bulk retrieval available but not used ─────────────────────────────────
    const singlePageWithMore = recent.filter((l: any) =>
      l.total_reported != null &&
      (l.total_reported as number) > 200 &&
      (l.page_fetched as number | null) === 1 &&
      l.status_code === 200
    );
    if (singlePageWithMore.length > 0) {
      const sample = singlePageWithMore[0];
      recs.push({
        id:       `api-engine-bulk-available-${moduleKey}`,
        category: "API Engine",
        priority: "low",
        problem:  `"${moduleKey}" has ${sample.total_reported} records but the engine is fetching one page at a time`,
        impact:   "Multiple round-trips slow down Smart Dash pages. If the API supports a bulk parameter (e.g. limit=10000), a single request would be faster.",
        fix:      "In API Probe → Mappings, set pagination strategy to 'bulk' and add a limit=10000 query parameter if the API supports it.",
        action:   { label: "API Probe Mappings", href: "/systemmind/clients" },
      });
    }

    // 5. Latency spikes ────────────────────────────────────────────────────────
    const latencyLogs = recent.filter((l: any) => l.latency_ms != null && (l.latency_ms as number) > 10_000);
    if (latencyLogs.length >= 2) {
      const avgLatency = Math.round(
        latencyLogs.reduce((s: number, l: any) => s + (l.latency_ms as number), 0) / latencyLogs.length
      );
      recs.push({
        id:       `api-engine-latency-${moduleKey}`,
        category: "API Engine",
        priority: "medium",
        problem:  `"${moduleKey}" API calls averaging ${(avgLatency / 1000).toFixed(1)}s response time (${latencyLogs.length} slow calls in 24 h)`,
        impact:   "Slow external API responses degrade Smart Dash load times and risk server-function timeouts.",
        fix:      "Consider increasing the engine timeout in the workspace API profile, or check if the external API has a faster endpoint variant.",
        action:   { label: "API Engine Status", href: "/systemmind/clients" },
      });
    }
  }

  // 5. Token age warning (enterprise_integrations updated_at) ──────────────────
  const integ = integRes.data;
  if (integ?.updated_at) {
    const ageMs = Date.now() - new Date(integ.updated_at as string).getTime();
    const ageH  = ageMs / (1000 * 60 * 60);
    if (ageH > 20 && ageH < 48) {
      recs.push({
        id:       "api-engine-token-age",
        category: "API Engine",
        priority: "medium",
        problem:  `WeeBespoke API token was last refreshed ${Math.round(ageH)} hours ago`,
        impact:   "Tokens older than 24 h may be expired, causing 401 errors on the next API Engine call.",
        fix:      "Trigger a manual token refresh in SystemMind → API Probe → Connections → Webuyanyhouse, or wait for the auto-relogin to fire.",
        action:   { label: "API Probe", href: "/systemmind/clients" },
      });
    } else if (ageH >= 48) {
      recs.push({
        id:       "api-engine-token-expired",
        category: "API Engine",
        priority: "high",
        problem:  `WeeBespoke API token has not been refreshed in ${Math.round(ageH / 24)} days`,
        impact:   "Token is almost certainly expired. API Engine calls will fail with 401 until credentials are refreshed.",
        fix:      "Reconnect the WeeBespoke integration in SystemMind → API Probe → Connections → Webuyanyhouse.",
        action:   { label: "API Probe", href: "/systemmind/clients" },
      });
    }
  }

  return recs;
}
