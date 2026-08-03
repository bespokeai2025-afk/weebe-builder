/**
 * Resolve active WBAH post-call workflow config from workspace_workflows (SystemMind Apply).
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { WBAH_WORKSPACE_ID } from "@/lib/wbah-exclusion.shared";
import { stripRetellAgentPrefix } from "@/lib/wbah/post-call/wbah-retell-agents.shared";
import {
  defaultWbahPostCallWorkflowConfig,
  flowDefinitionToWbahConfig,
  type WbahPostCallWorkflowConfig,
} from "./wbah-workflow-steps.shared";

export async function resolveWbahPostCallWorkflowConfig(input: {
  workspaceId: string;
  agentId: string;
}): Promise<WbahPostCallWorkflowConfig> {
  const fallback = defaultWbahPostCallWorkflowConfig();
  if (input.workspaceId !== WBAH_WORKSPACE_ID) return fallback;

  const agentKey = stripRetellAgentPrefix(input.agentId);
  const sb = supabaseAdmin as any;

  const { data: rows } = await sb
    .from("workspace_workflows")
    .select("id, name, flow_definition, trigger_config, status, updated_at")
    .eq("workspace_id", input.workspaceId)
    .eq("trigger_type", "call_completed")
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(20);

  for (const row of (rows ?? []) as any[]) {
    const tc = (row.trigger_config ?? {}) as Record<string, unknown>;
    if (tc.external_orchestrator && tc.external_orchestrator !== "webee") continue;

    const agents = (
      tc.retell_agents ?? tc.retell_agent_ids ?? []
    ) as string[];
    if (agents.length > 0) {
      const normalized = agents.map((a) => stripRetellAgentPrefix(String(a)));
      if (!normalized.includes(agentKey)) continue;
    }

    const parsed = flowDefinitionToWbahConfig(row.flow_definition, tc);
    if (parsed) {
      return {
        ...parsed,
        name: parsed.name || row.name || fallback.name,
      };
    }

    const embedded = (tc.wbah_post_call ?? null) as WbahPostCallWorkflowConfig | null;
    if (embedded?.steps?.length) return embedded;
  }

  // Latest applied build version (inactive workflow not yet activated)
  const { data: version } = await sb
    .from("systemmind_build_versions")
    .select("generated_config, status")
    .eq("workspace_id", input.workspaceId)
    .in("status", ["applied", "deployed"])
    .order("applied_at", { ascending: false, nullsFirst: false })
    .limit(5);

  for (const v of (version ?? []) as any[]) {
    const cfg = v.generated_config as Record<string, unknown> | null;
    const channel = (cfg?.channel_setup as Record<string, unknown> | undefined)?.wbah_post_call;
    if (channel && typeof channel === "object") {
      return channel as WbahPostCallWorkflowConfig;
    }
    const fromFlow = flowDefinitionToWbahConfig(
      { steps: (cfg?.workflow as any)?.steps ?? [] },
      (cfg?.workflow as any)?.trigger_config ?? {},
    );
    if (fromFlow) return fromFlow;
  }

  return fallback;
}

export async function listWbahPostCallWorkflows(workspaceId: string): Promise<
  Array<{
    id: string;
    name: string;
    status: string;
    retellAgents: string[];
    stepCount: number;
    updatedAt: string | null;
    sourceBuildSessionId: string | null;
  }>
> {
  const sb = supabaseAdmin as any;
  const { data } = await sb
    .from("workspace_workflows")
    .select("id, name, status, flow_definition, trigger_config, updated_at, source_build_session_id")
    .eq("workspace_id", workspaceId)
    .eq("trigger_type", "call_completed")
    .order("updated_at", { ascending: false })
    .limit(30);

  return ((data ?? []) as any[]).map((row) => {
    const tc = row.trigger_config ?? {};
    const cfg = flowDefinitionToWbahConfig(row.flow_definition, tc);
    return {
      id: String(row.id),
      name: String(row.name ?? "Workflow"),
      status: String(row.status ?? "inactive"),
      retellAgents: (cfg?.retell_agents ?? tc.retell_agents ?? []) as string[],
      stepCount: cfg?.steps.filter((s) => s.enabled).length ?? 0,
      updatedAt: row.updated_at ?? null,
      sourceBuildSessionId: row.source_build_session_id ? String(row.source_build_session_id) : null,
    };
  });
}
