import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getProviderUsage } from "@/lib/providers/usage.server";

export type WorkflowHealthSummary = {
  total: number;
  healthy: number;
  needsRepair: number;
  pctHealthy: number;
  topRiskCategories: string[];
};

export type SystemMindData = {
  generatedAt: string;
  systemHealth: Record<string, boolean>;
  integrations: { connected: number; total: number };
  agents: { total: number };
  usage: {
    totalCostUsd: number;
    requests: number;
    errors: number;
    errorRate: number;
    durationMs: number;
    lastUsedAt: string | null;
  };
  topProviders: Array<{ name: string; category: string; cost: number; requests: number; errors: number }>;
  workflowHealth?: WorkflowHealthSummary;
};

// Shared server-side aggregator — reused by the server fn and (later) HiveMind's
// consolidated briefing so the CTO data is computed in exactly one place.
export async function computeSystemMindData(workspaceId: string): Promise<SystemMindData> {
  const sb = supabaseAdmin as any;

  const { data: ws } = await sb
    .from("workspace_settings")
    .select("*")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  const settings = ws ?? {};

  const { count: agentCount } = await sb
    .from("agents")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId);

  const usageRows = await getProviderUsage(workspaceId);
  const agg = usageRows.reduce(
    (acc, r) => {
      acc.totalCostUsd += Number(r.total_cost_usd ?? 0);
      acc.requests += Number(r.requests ?? 0);
      acc.errors += Number(r.errors ?? 0);
      acc.durationMs += Number(r.total_duration_ms ?? 0);
      if (r.last_used_at && (!acc.lastUsedAt || r.last_used_at > acc.lastUsedAt)) {
        acc.lastUsedAt = r.last_used_at;
      }
      return acc;
    },
    { totalCostUsd: 0, requests: 0, errors: 0, durationMs: 0, lastUsedAt: null as string | null },
  );

  const systemHealth: Record<string, boolean> = {
    openai:     !!(settings.openai_api_key || process.env.OPENAI_API_KEY),
    retell:     !!(settings.retell_workspace_id || settings.retell_default_agent_id || process.env.RETELL_API_KEY),
    elevenlabs: !!settings.elevenlabs_api_key,
    twilio:     !!(settings.twilio_auth_token && settings.twilio_account_sid),
    whatsapp:   !!settings.whatsapp_phone_id,
    calcom:     !!settings.calcom_api_key,
  };
  const connected = Object.values(systemHealth).filter(Boolean).length;
  const total = Object.keys(systemHealth).length;
  const errorRate = agg.requests > 0 ? +((agg.errors / agg.requests) * 100).toFixed(1) : 0;

  // Workflow health — graceful; table may not exist in all workspaces
  let workflowHealth: WorkflowHealthSummary | undefined;
  try {
    const { data: wfRows } = await sb
      .from("systemmind_workflow_library")
      .select("node_count, edge_count, category")
      .eq("workspace_id", workspaceId);

    if (wfRows && wfRows.length > 0) {
      const riskCategoryCount = new Map<string, number>();
      let needsRepair = 0;

      for (const wf of wfRows) {
        const nc = Number(wf.node_count ?? 0);
        const ec = Number(wf.edge_count ?? 0);
        // Heuristic: empty flow OR multi-node flow with no edges is broken
        const broken = nc === 0 || (nc > 1 && ec === 0);
        if (broken) {
          needsRepair++;
          const cat = wf.category ?? "General";
          riskCategoryCount.set(cat, (riskCategoryCount.get(cat) ?? 0) + 1);
        }
      }

      const total = wfRows.length;
      const healthy = total - needsRepair;
      const pctHealthy = total > 0 ? Math.round((healthy / total) * 100) : 100;

      const topRiskCategories = [...riskCategoryCount.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([cat]) => cat);

      workflowHealth = { total, healthy, needsRepair, pctHealthy, topRiskCategories };
    }
  } catch { /* graceful — table not yet migrated */ }

  // Email deliverability health — graceful; tables may not exist yet
  let emailHealth: {
    totalDomains: number;
    dnsFailures: number;
    missingDmarc: number;
    activePlans: number;
    recentBounces: number;
    recentComplaints: number;
    warnings: string[];
  } | undefined;
  try {
    const [domRes, evRes] = await Promise.all([
      sb.from("email_sender_domains").select("domain,spf_status,dkim_status,dmarc_status,mx_status,status")
        .eq("workspace_id", workspaceId),
      sb.from("email_reputation_events").select("event_type,severity")
        .eq("workspace_id", workspaceId)
        .gte("created_at", new Date(Date.now() - 7 * 86400_000).toISOString()),
    ]);
    const doms = domRes.data ?? [];
    const evs  = evRes.data ?? [];
    if (doms.length > 0 || evs.length > 0) {
      const dnsFailures  = doms.filter((d: any) => d.spf_status !== "pass" || d.mx_status !== "pass").length;
      const missingDmarc = doms.filter((d: any) => d.dmarc_status === "missing").length;
      const warnings: string[] = [];
      if (dnsFailures  > 0) warnings.push(`${dnsFailures} domain(s) with DNS failures`);
      if (missingDmarc > 0) warnings.push(`${missingDmarc} domain(s) missing DMARC`);
      const criticalBounces = evs.filter((e: any) => e.event_type === "bounce" && e.severity === "warning").length;
      if (criticalBounces > 5) warnings.push(`${criticalBounces} bounce events this week`);
      emailHealth = {
        totalDomains:    doms.length,
        dnsFailures,
        missingDmarc,
        activePlans:     0,
        recentBounces:   evs.filter((e: any) => e.event_type === "bounce").length,
        recentComplaints:evs.filter((e: any) => e.event_type === "complaint").length,
        warnings,
      };
    }
  } catch { /* graceful */ }

  return {
    generatedAt: new Date().toISOString(),
    systemHealth,
    integrations: { connected, total },
    agents: { total: agentCount ?? 0 },
    usage: {
      totalCostUsd: +agg.totalCostUsd.toFixed(2),
      requests: agg.requests,
      errors: agg.errors,
      errorRate,
      durationMs: agg.durationMs,
      lastUsedAt: agg.lastUsedAt,
    },
    topProviders: usageRows.slice(0, 5).map((r) => ({
      name: r.provider_name,
      category: r.provider_category,
      cost: +Number(r.total_cost_usd ?? 0).toFixed(2),
      requests: r.requests,
      errors: r.errors,
    })),
    workflowHealth,
    emailHealth,
  };
}

/** SystemMind (CTO) platform telemetry — integrations, reliability, runtime cost. */
export const getSystemMindData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { workspaceId, userId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const { requireSystemMindView } = await import(
      "@/lib/systemmind/systemmind-access.server"
    );
    await requireSystemMindView(workspaceId, userId);
    return computeSystemMindData(workspaceId);
  });
