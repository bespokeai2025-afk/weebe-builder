/**
 * Workflow Builder steps as automation-engine nodes, and the converter from a saved step list
 * (`workspace_workflows.flow_definition`) to an engine workflow document.
 *
 * Each step node is `step.<type>` with the saved step as its config. Steps pass their outputs on,
 * so later steps and branches see what earlier ones produced (the old engine's shared `state`).
 * The workspace and lead travel in the trigger under `_workflow`.
 */
import type { NodeContext, NodeDefinition, NodeResult } from "../../types/node.types";
import { registerNodes } from "../../registry/node-registry";
import type { FlowStep } from "./workflow-step-handlers.server";

export const WORKFLOW_STEP_TYPES = [
  "trigger",
  "update_lead_status",
  "push_to_crm",
  "create_callback",
  "create_task",
  "send_whatsapp",
  "send_email",
  "notify_user",
  "assign_agent",
  "call_lead",
  "branch",
] as const;

/** Trigger fields the step nodes read. */
export type WorkflowRunMeta = { workspaceId: string; leadId?: string };

function runMeta(ctx: NodeContext): WorkflowRunMeta | null {
  const meta = (ctx.input.trigger as Record<string, unknown> | undefined)?._workflow;
  return meta && typeof meta === "object" ? (meta as WorkflowRunMeta) : null;
}

async function executeStepNode(ctx: NodeContext): Promise<NodeResult> {
  const meta = runMeta(ctx);
  if (!meta?.workspaceId) {
    return {
      status: "error",
      error: { message: "Workflow step ran without a workspace", code: "NO_WORKSPACE", retryable: false },
    };
  }
  const { runFlowStep, pickBranchCondition } = await import("./workflow-step-handlers.server");
  const step = ctx.config as unknown as FlowStep;
  const state = { ...ctx.input.json };

  if (step.type === "branch" && step.conditions?.length) {
    const i = pickBranchCondition(step.conditions, state);
    return { status: "success", output: { json: { ...state, branch_taken: i } }, branch: `c${i}` };
  }

  const outcome = await runFlowStep(step, {
    workspaceId: meta.workspaceId,
    runId: ctx.executionId,
    leadId: meta.leadId,
    state,
  });
  const { skipped, ...out } = outcome;
  return {
    status: "success",
    output: { json: { ...state, ...out, ...(skipped ? { _skipped: skipped } : {}) } },
  };
}

export const WORKFLOW_STEP_NODE_DEFINITIONS: NodeDefinition[] = WORKFLOW_STEP_TYPES.map((t) => ({
  type: `step.${t}`,
  version: 1,
  displayName: t.replace(/_/g, " "),
  category: t === "branch" ? "logic" : "action",
  description: `Workflow Builder step: ${t.replace(/_/g, " ")}.`,
  inputs: [{ name: "main", type: "main" }],
  outputs: [{ name: "main", type: "main" }],
  execute: executeStepNode,
}));

let registered = false;
export function registerWorkflowStepNodes(): void {
  if (registered) return;
  registerNodes(WORKFLOW_STEP_NODE_DEFINITIONS);
  registered = true;
}

const START_ID = "__start";
const END_ID = "__end";

/**
 * A saved step list → engine workflow. Same walk as the old engine: start at the first step,
 * follow `next`, a branch follows its first matching condition (or the last one), and a missing
 * or unknown `next` ends the run. Steps the walk can never reach are left out — the engine
 * refuses workflows with unreachable nodes.
 */
export function stepListToAutomationDocument(
  flowDefinition: unknown,
  name: string,
): { name: string; nodes: Array<Record<string, unknown>>; connections: Array<Record<string, unknown>> } {
  const steps = (
    Array.isArray((flowDefinition as { steps?: unknown })?.steps)
      ? (flowDefinition as { steps: FlowStep[] }).steps
      : []
  ).filter((s) => s && typeof s.id === "string" && s.id && typeof s.type === "string");
  const byId = new Map(steps.map((s) => [s.id, s]));
  const target = (id: string | undefined) => (id && byId.has(id) ? id : END_ID);

  const reachable = new Set<string>();
  const stack = steps[0] ? [steps[0].id] : [];
  while (stack.length) {
    const id = stack.pop()!;
    if (reachable.has(id) || !byId.has(id)) continue;
    reachable.add(id);
    const s = byId.get(id)!;
    if (s.type === "stop_workflow") continue;
    if (s.type === "branch" && s.conditions?.length) s.conditions.forEach((c) => stack.push(c.next));
    else if (s.next) stack.push(s.next);
  }

  const nodes: Array<Record<string, unknown>> = [{ id: START_ID, type: "core.start", name: "Start" }];
  const connections: Array<Record<string, unknown>> = [];
  const edge = (from: string, to: string, port = "main") =>
    connections.push({ from: { node: from, port }, to: { node: to } });

  edge(START_ID, steps[0] ? steps[0].id : END_ID);
  for (const s of steps) {
    if (!reachable.has(s.id)) continue;
    if (s.type === "stop_workflow") {
      nodes.push({ id: s.id, type: "core.end", name: s.title ?? "Stop" });
      continue;
    }
    const known = (WORKFLOW_STEP_TYPES as readonly string[]).includes(s.type);
    nodes.push({
      id: s.id,
      type: known ? `step.${s.type}` : "step.trigger",
      name: s.title ?? s.type.replace(/_/g, " "),
      // Unknown types keep their own type in config, so the step reports itself as skipped.
      config: { ...s, ...(known ? {} : { type: s.type }) },
    });
    if (s.type === "branch" && s.conditions?.length) {
      s.conditions.forEach((c, i) => edge(s.id, target(c.next), `c${i}`));
    } else {
      edge(s.id, target(s.next));
    }
  }
  nodes.push({ id: END_ID, type: "core.end", name: "End" });
  return { name, nodes, connections };
}
