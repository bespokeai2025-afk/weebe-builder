import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getProviderUsage } from "@/lib/providers/usage.server";

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
  };
}

/** SystemMind (CTO) platform telemetry — integrations, reliability, runtime cost. */
export const getSystemMindData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    return computeSystemMindData(workspaceId);
  });
