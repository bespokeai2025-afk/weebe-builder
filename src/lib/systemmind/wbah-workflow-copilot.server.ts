/**
 * SystemMind workflow copilot — general step-by-step builder (not WBAH-only).
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { routeGenerate } from "@/lib/growthmind/model-router.server";
import {
  getBuildSessionServer,
  insertBuildVersionServer,
  recordSystemMindUsageEvent,
  validateConfigOrThrow,
  type BuildConfig,
} from "@/lib/systemmind/build-workspace.server";
import { isClaudeEnabled } from "@/lib/systemmind/systemmind-automation.server";
import { WBAH_WORKSPACE_ID } from "@/lib/wbah-exclusion.shared";
import {
  buildWbahNewLeadsSystemMindConfig,
  WBAH_NEW_LEADS_AGENTS,
} from "@/lib/systemmind/wbah-n8n-integration.shared";
import {
  emptyWbahPostCallWorkflowConfig,
  wbahStepsToFlowDefinition,
} from "@/lib/wbah/workflow/wbah-workflow-steps.shared";
import {
  emptyWbahN8nGraph,
} from "@/lib/wbah/workflow/wbah-n8n-node-catalog.shared";
import { wbahConfigToFlowDefinition } from "@/lib/wbah/workflow/wbah-workflow-graph.shared";
import { attachAutomationToWbahPipeline } from "@/lib/automation-engine/sync-automation.server";
import type { WbahPostCallWorkflowConfig } from "@/lib/wbah/workflow/wbah-workflow-steps.shared";
import type { WbahN8nWorkflowGraph } from "@/lib/wbah/workflow/wbah-n8n-node-catalog.shared";
import { buildWorkflowCopilotSystemPrompt } from "@/lib/systemmind/workflow-copilot-catalog.server";
import { mergeCopilotOntoPipeline } from "@/lib/systemmind/workflow-copilot-apply.server";
import {
  WorkflowCopilotResponseSchema,
  normalizeTriggerType,
  sanitizeWorkflowCopilotJson,
  type WorkflowCopilotResult,
} from "@/lib/systemmind/workflow-copilot.shared";

async function insertCopilotMessage(args: {
  sessionId: string;
  workspaceId: string;
  userId: string | null;
  role: "user" | "systemmind" | "system";
  content: string;
  versionId?: string;
}) {
  const sb = supabaseAdmin as any;
  await sb.from("systemmind_build_messages").insert({
    session_id: args.sessionId,
    workspace_id: args.workspaceId,
    user_id: args.userId,
    role: args.role,
    content: args.content.slice(0, 8000),
    version_id: args.versionId ?? null,
  });
}

function buildCopilotUserBlock(
  current: WbahPostCallWorkflowConfig,
  prompt: string,
  priorMessages: Array<{ role: string; content: string }>,
): string {
  const recentChat = priorMessages
    .slice(-8)
    .map((m) => `${m.role}: ${m.content.slice(0, 600)}`)
    .join("\n");

  const pipelineJson = JSON.stringify(
    {
      name: current.name,
      purpose: current.purpose,
      workflow_kind: current.workflow_kind ?? "general",
      nodeCount: current.n8n_graph?.nodes?.length ?? 0,
      edgeCount: current.n8n_graph?.edges?.length ?? 0,
      nodes: (current.n8n_graph?.nodes ?? []).map((n) => ({
        id: n.id,
        label: n.label,
        type: (n.config as Record<string, unknown>)?.automationType,
      })),
      copilot_requirements: current.copilot_requirements,
      automation_valid: current.automation_validation?.valid,
    },
    null,
    2,
  ).slice(0, 12000);

  return `CURRENT WORKFLOW (built incrementally — do NOT replace with a template):
${pipelineJson}

RECENT CHAT:
${recentChat || "(none)"}

USER MESSAGE:
"${prompt.slice(0, 4000)}"

Respond with mode "clarify" if you need trigger type, URLs, env var names, or credential names before adding nodes.
Respond with mode "build" only when you can add the next nodes incrementally.`;
}

export async function promptWbahWorkflowCopilotServer(args: {
  workspaceId: string;
  userId: string | null;
  sessionId: string;
  prompt: string;
}): Promise<WorkflowCopilotResult> {
  if (args.workspaceId !== WBAH_WORKSPACE_ID) {
    throw new Error("Workflow copilot is only available in this workspace.");
  }

  const sb = supabaseAdmin as any;
  const startedAt = new Date();
  const detail = await getBuildSessionServer(args.workspaceId, args.sessionId);
  const session = detail.session;
  if (session.status !== "active") {
    throw new Error("This build session is archived — restore it first.");
  }

  const { pipeline: currentPipeline } = pipelineFromBuildConfig(
    (detail.versions.find((v: any) => v.id === session.current_version_id) ??
      detail.versions[0])?.generated_config as Record<string, unknown> | undefined,
  );

  await insertCopilotMessage({
    sessionId: args.sessionId,
    workspaceId: args.workspaceId,
    userId: args.userId,
    role: "user",
    content: args.prompt,
  });

  const claudeEnabled = isClaudeEnabled();

  try {
    const routed = await routeGenerate({
      system: buildWorkflowCopilotSystemPrompt(),
      user: buildCopilotUserBlock(
        currentPipeline,
        args.prompt,
        (detail.messages ?? []).map((m: any) => ({
          role: String(m.role ?? "system"),
          content: String(m.content ?? ""),
        })),
      ),
      contentType: "systemmind_workflow_copilot",
      maxTokens: 6000,
      mode: "manual",
      provider: claudeEnabled ? "claude" : "openai",
      model: claudeEnabled ? "claude-sonnet-4-5" : "gpt-4.1",
      settings: {},
      workspaceId: args.workspaceId,
      sb,
    });

    let rawJson: unknown;
    try {
      const cleaned = routed.text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
      rawJson = JSON.parse(cleaned);
    } catch {
      throw new Error("Copilot returned invalid JSON — try rephrasing your request.");
    }

    const parsed = WorkflowCopilotResponseSchema.safeParse(
      sanitizeWorkflowCopilotJson(rawJson),
    );
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new Error(
        issue?.message
          ? `Copilot response invalid (${issue.path.join(".") || "root"}): ${issue.message}`
          : "Copilot response did not match the expected format.",
      );
    }

    const data = parsed.data;

    if (data.mode === "clarify") {
      const clarifyText = [
        data.summary,
        data.questions?.length
          ? `\n\n**Questions:**\n${data.questions.map((q, i) => `${i + 1}. ${q.prompt}`).join("\n")}`
          : "",
        data.required_env_vars?.length
          ? `\n\n**Environment variables needed:** ${data.required_env_vars.map((e) => e.name).join(", ")}`
          : "",
        data.required_links?.length
          ? `\n\n**Links needed:** ${data.required_links.map((l) => l.label).join(", ")}`
          : "",
      ].join("");

      await insertCopilotMessage({
        sessionId: args.sessionId,
        workspaceId: args.workspaceId,
        userId: null,
        role: "systemmind",
        content: clarifyText.slice(0, 8000),
      });

      await recordSystemMindUsageEvent({
        workspaceId: args.workspaceId,
        userId: args.userId,
        sessionId: args.sessionId,
        taskType: "workflow_copilot_clarify",
        sourcePage: session.source_page ?? "wbah_workflow_wizard",
        modelProvider: routed.provider,
        modelId: routed.model,
        promptTokens: routed.inputTokens,
        completionTokens: routed.outputTokens,
        startedAt,
        completedAt: new Date(),
        success: true,
      });

      return {
        mode: "clarify",
        assistantSummary: data.summary,
        questions: data.questions,
        requiredEnvVars: data.required_env_vars,
        requiredLinks: data.required_links,
        requiredCredentials: data.required_credentials,
      };
    }

    let nextPipeline = mergeCopilotOntoPipeline(currentPipeline, data);

    if (data.required_env_vars || data.required_links || data.required_credentials) {
      nextPipeline = {
        ...nextPipeline,
        copilot_requirements: {
          env_vars: data.required_env_vars ?? nextPipeline.copilot_requirements?.env_vars,
          links: data.required_links ?? nextPipeline.copilot_requirements?.links,
          credentials: data.required_credentials ?? nextPipeline.copilot_requirements?.credentials,
        },
      };
    }

    const graphMeta = nextPipeline.n8n_graph
      ? {
          nodes: nextPipeline.n8n_graph.nodes.map((n) => ({ id: n.id, position: n.position })),
          edges: nextPipeline.n8n_graph.edges ?? [],
        }
      : null;

    const config = buildConfigFromPipeline(nextPipeline, graphMeta);
    const { versionId, versionNumber } = await insertBuildVersionServer({
      workspaceId: args.workspaceId,
      userId: args.userId,
      sessionId: args.sessionId,
      userPrompt: args.prompt.slice(0, 8000),
      summary: data.summary,
      config,
      auditAction: "workflow_copilot_build",
    });

    await insertCopilotMessage({
      sessionId: args.sessionId,
      workspaceId: args.workspaceId,
      userId: null,
      role: "systemmind",
      content: data.summary,
      versionId,
    });

    await recordSystemMindUsageEvent({
      workspaceId: args.workspaceId,
      userId: args.userId,
      sessionId: args.sessionId,
      taskType: "workflow_copilot_build",
      sourcePage: session.source_page ?? "wbah_workflow_wizard",
      modelProvider: routed.provider,
      modelId: routed.model,
      promptTokens: routed.inputTokens,
      completionTokens: routed.outputTokens,
      startedAt,
      completedAt: new Date(),
      success: true,
    });

    return {
      mode: "build",
      versionId,
      versionNumber,
      assistantSummary: data.summary,
      requiredEnvVars: data.required_env_vars,
      requiredLinks: data.required_links,
      requiredCredentials: data.required_credentials,
    };
  } catch (err: unknown) {
    const completedAt = new Date();
    const message = err instanceof Error ? err.message : String(err);
    await recordSystemMindUsageEvent({
      workspaceId: args.workspaceId,
      userId: args.userId,
      sessionId: args.sessionId,
      taskType: "workflow_copilot",
      sourcePage: session.source_page ?? "wbah_workflow_wizard",
      startedAt,
      completedAt,
      success: false,
      error: message,
    });
    await insertCopilotMessage({
      sessionId: args.sessionId,
      workspaceId: args.workspaceId,
      userId: null,
      role: "system",
      content: `Copilot failed: ${message.slice(0, 500)}`,
    });
    throw err;
  }
}

function mergePipelineGraph(
  pipeline: WbahPostCallWorkflowConfig,
  graphMeta?: { nodes: Array<{ id: string; position: { x: number; y: number } }>; edges: Array<{ id: string; source: string; target: string }> } | null,
): WbahPostCallWorkflowConfig {
  const existing = pipeline.n8n_graph;
  if (!existing?.nodes?.length) return pipeline;

  const metaById = Object.fromEntries((graphMeta?.nodes ?? []).map((n) => [n.id, n.position]));
  const existingById = Object.fromEntries(existing.nodes.map((n) => [n.id, n]));

  const nodes = existing.nodes.map((n) => ({
    ...n,
    // Prefer live pipeline position; graphMeta is a secondary snapshot from save UI.
    position: n.position ?? metaById[n.id] ?? { x: 0, y: 0 },
  }));

  const metaIds = new Set((graphMeta?.nodes ?? []).map((n) => n.id));
  const extraFromMeta =
    graphMeta?.nodes
      ?.filter((n) => !existingById[n.id])
      .map((n) => ({
        id: n.id,
        label: n.id,
        enabled: true,
        config: {},
        position: n.position,
      })) ?? [];

  const n8n_graph: WbahN8nWorkflowGraph = {
    nodes: [...nodes, ...extraFromMeta],
    edges:
      graphMeta?.edges?.length && graphMeta.edges.length > 0
        ? graphMeta.edges
        : (existing.edges ?? []),
  };
  return { ...pipeline, n8n_graph };
}

export function buildConfigFromPipeline(
  pipeline: WbahPostCallWorkflowConfig,
  graphMeta?: { nodes: Array<{ id: string; position: { x: number; y: number } }>; edges: Array<{ id: string; source: string; target: string }> } | null,
): BuildConfig {
  const mergedPipeline = mergePipelineGraph(pipeline, graphMeta);
  const isGeneral = mergedPipeline.workflow_kind === "general" || !mergedPipeline.steps.some((s) => s.enabled);

  const pipelineWithAutomation = isGeneral && mergedPipeline.automation
    ? mergedPipeline
    : attachAutomationToWbahPipeline(mergedPipeline);

  const base = buildWbahNewLeadsSystemMindConfig();
  const flowMeta = wbahConfigToFlowDefinition(pipelineWithAutomation, graphMeta ?? null);
  const { steps } = wbahStepsToFlowDefinition(pipelineWithAutomation);

  const triggerType = normalizeTriggerType(
    (pipelineWithAutomation.automation as Record<string, unknown> | undefined)?.meta &&
      typeof (pipelineWithAutomation.automation as { meta?: { trigger_type?: unknown } }).meta
        ?.trigger_type === "string"
      ? (pipelineWithAutomation.automation as { meta: { trigger_type: string } }).meta.trigger_type
      : undefined,
    mergedPipeline.workflow_kind === "general" ? "manual" : "call_completed",
  );

  const config: BuildConfig = {
    ...base,
    agent_prompt: "",
    workflow: {
      ...base.workflow,
      name: pipelineWithAutomation.name,
      purpose: pipelineWithAutomation.purpose || base.workflow.purpose,
      trigger_type: triggerType,
      trigger_config: {
        ...(base.workflow.trigger_config as Record<string, unknown>),
        retell_agents: pipelineWithAutomation.retell_agents.length
          ? pipelineWithAutomation.retell_agents
          : [],
        wbah_post_call: pipelineWithAutomation,
        workflow_kind: pipelineWithAutomation.workflow_kind ?? "general",
      },
      steps: steps as BuildConfig["workflow"]["steps"],
      ...(flowMeta.graph_nodes ? { graph_nodes: flowMeta.graph_nodes, graph_edges: flowMeta.graph_edges } : {}),
      ...(flowMeta.n8n_graph ? { n8n_graph: flowMeta.n8n_graph } : {}),
    } as BuildConfig["workflow"],
    channel_setup: {
      ...(base.channel_setup as Record<string, unknown>),
      wbah_post_call: pipelineWithAutomation,
    },
    required_credentials: pipelineWithAutomation.copilot_requirements?.credentials ?? [],
    test_plan: [
      "Confirm required env vars and links are configured in your deployment.",
      "Run a test trigger and verify each node executes in order.",
      "Apply and activate when tests pass.",
    ],
  };

  return validateConfigOrThrow(config, "Workflow save");
}

export async function saveWbahPipelineConfigServer(args: {
  workspaceId: string;
  userId: string | null;
  sessionId: string;
  pipeline: WbahPostCallWorkflowConfig;
  graphMeta?: { nodes: Array<{ id: string; position: { x: number; y: number } }>; edges: Array<{ id: string; source: string; target: string }> } | null;
  summary?: string;
}): Promise<{
  versionId: string;
  pipelineName: string;
  automationValidation: { valid: boolean; errors: string[] };
}> {
  if (args.workspaceId !== WBAH_WORKSPACE_ID) {
    throw new Error("Only Webuyanyhouse workspace.");
  }

  const config = buildConfigFromPipeline(args.pipeline, args.graphMeta);
  const wbah = (config.channel_setup as Record<string, unknown>).wbah_post_call as WbahPostCallWorkflowConfig;
  const automationValidation = wbah.automation_validation ?? { valid: true, errors: [] as string[] };
  const { versionId } = await insertBuildVersionServer({
    workspaceId: args.workspaceId,
    userId: args.userId,
    sessionId: args.sessionId,
    userPrompt: `Workflow save: ${args.pipeline.name}`,
    summary:
      args.summary ??
      `Saved workflow "${args.pipeline.name}" with ${args.pipeline.n8n_graph?.nodes?.length ?? 0} node(s).`,
    config,
  });

  return {
    versionId,
    pipelineName: args.pipeline.name,
    automationValidation: {
      valid: automationValidation.valid,
      errors: automationValidation.errors ?? [],
    },
  };
}

export function pipelineFromBuildConfig(config: Record<string, unknown> | null | undefined): {
  pipeline: WbahPostCallWorkflowConfig;
  graphMeta: { nodes: Array<{ id: string; position: { x: number; y: number } }>; edges: Array<{ id: string; source: string; target: string }> } | null;
} {
  const fallback = emptyWbahPostCallWorkflowConfig();
  if (!config) return { pipeline: fallback, graphMeta: null };

  const ch = config.channel_setup as Record<string, unknown> | undefined;
  const wf = config.workflow as Record<string, unknown> | undefined;
  const tc = (wf?.trigger_config ?? {}) as Record<string, unknown>;
  const embedded = (ch?.wbah_post_call ?? tc.wbah_post_call) as WbahPostCallWorkflowConfig | undefined;
  const wfN8n = wf?.n8n_graph as WbahN8nWorkflowGraph | undefined;
  const wfGraphNodes = wf?.graph_nodes as Array<{ id: string; position: { x: number; y: number } }> | undefined;
  const wfGraphEdges = wf?.graph_edges as Array<{ id: string; source: string; target: string }> | undefined;

  let resolvedGraph =
    embedded?.n8n_graph ??
    wfN8n ??
    (wfGraphNodes?.length
      ? {
          nodes: wfGraphNodes.map((n) => ({
            id: n.id,
            position: n.position,
            enabled: true,
            config: {},
          })),
          edges: wfGraphEdges ?? [],
        }
      : null);

  const graphMeta =
    wfGraphNodes && wfGraphEdges
      ? { nodes: wfGraphNodes, edges: wfGraphEdges }
      : resolvedGraph
        ? {
            nodes: resolvedGraph.nodes.map((n) => ({ id: n.id, position: n.position })),
            edges: resolvedGraph.edges ?? [],
          }
        : null;

  if (embedded) {
    return {
      pipeline: {
        ...embedded,
        n8n_graph: resolvedGraph ?? emptyWbahN8nGraph(),
      },
      graphMeta,
    };
  }
  return { pipeline: fallback, graphMeta };
}
