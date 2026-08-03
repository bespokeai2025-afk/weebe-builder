/**
 * WBAH plugin — node executors wired to automation engine NodeContext.
 */
import type { NodeContext, NodeResult } from "../../types/node.types";
import { isWbahPostCallExecutionEnabled } from "@/lib/wbah/post-call/wbah-retell-agents.shared";
import { stepAppliesToEvent } from "@/lib/wbah/workflow/wbah-workflow-graph.shared";
import {
  buildWbahRunBag,
  isWebCall,
  mergeWbahOutput,
} from "./wbah-run-context";
import {
  wbahStepCalendlyInvitee,
  wbahStepCalendlyLink,
  wbahStepCallsUpsert,
  wbahStepDashboardAnalyzed,
  wbahStepDashboardRaw,
  wbahStepDynamicsAgentic,
  wbahStepDynamicsAllens,
  wbahStepFormatData,
  wbahStepLiveTranscript,
} from "./wbah-step-handlers.server";

import type { WbahRunBag } from "./wbah-run-context";

function ok(ctx: NodeContext, bag: Partial<WbahRunBag>, extra?: Record<string, unknown>): NodeResult {
  return {
    status: "success",
    output: { json: mergeWbahOutput(ctx, bag, extra) },
  };
}

function skip(ctx: NodeContext, reason: string): NodeResult {
  return ok(ctx, {}, { _wbahSkipped: true, _skipReason: reason });
}

function err(message: string): NodeResult {
  return {
    status: "error",
    error: { message, code: "WBAH_STEP", retryable: false },
  };
}

function stepIdFromConfig(ctx: NodeContext): string {
  return String(ctx.config.executorStepId ?? ctx.config.stepId ?? ctx.nodeId);
}

function stepAllowed(ctx: NodeContext, stepId: string): boolean {
  const bag = buildWbahRunBag(ctx);
  if (!bag) return false;
  return stepAppliesToEvent(stepId, bag.event);
}

function getFormatted(ctx: NodeContext) {
  const bag = buildWbahRunBag(ctx);
  if (!bag) return null;
  return bag.formatted ?? wbahStepFormatData(bag);
}

export async function executeWbahLiveTranscript(ctx: NodeContext): Promise<NodeResult> {
  const bag = buildWbahRunBag(ctx);
  if (!bag) return err("Invalid WBAH webhook context");
  if (isWebCall(bag.call)) return skip(ctx, "web_call");
  if (!stepAllowed(ctx, "live_transcript")) return skip(ctx, "event mismatch");
  await wbahStepLiveTranscript(bag);
  return ok(ctx, bag, { _wbahStep: "live_transcript" });
}

export async function executeWbahDashboardRaw(ctx: NodeContext): Promise<NodeResult> {
  const bag = buildWbahRunBag(ctx);
  if (!bag) return err("Invalid WBAH webhook context");
  if (!isWbahPostCallExecutionEnabled()) return skip(ctx, "execution disabled");
  if (!bag.leadId) return skip(ctx, "no lead_id");
  if (!stepAllowed(ctx, "dashboard_raw")) return skip(ctx, "event mismatch");
  await wbahStepDashboardRaw(bag);
  return ok(ctx, bag, { _wbahStep: "dashboard_raw" });
}

export async function executeWbahFormatData(ctx: NodeContext): Promise<NodeResult> {
  const bag = buildWbahRunBag(ctx);
  if (!bag) return err("Invalid WBAH webhook context");
  if (!bag.leadId) return skip(ctx, "no lead_id");
  const formatted = wbahStepFormatData(bag);
  return ok(ctx, { ...bag, formatted }, { _wbahStep: "format_data" });
}

export async function executeWbahCalendlyLink(ctx: NodeContext): Promise<NodeResult> {
  const bag = buildWbahRunBag(ctx);
  if (!bag) return err("Invalid WBAH webhook context");
  if (!isWbahPostCallExecutionEnabled()) return skip(ctx, "execution disabled");
  const formatted = getFormatted(ctx);
  if (!formatted?.hasBookingSlot) return skip(ctx, "no booking slot");
  const calendlyBookingUrl = await wbahStepCalendlyLink(bag, formatted);
  return ok(ctx, { ...bag, formatted, calendlyBookingUrl }, { _wbahStep: "calendly_link" });
}

export async function executeWbahCalendlyInvitee(ctx: NodeContext): Promise<NodeResult> {
  const bag = buildWbahRunBag(ctx);
  if (!bag) return err("Invalid WBAH webhook context");
  if (!isWbahPostCallExecutionEnabled()) return skip(ctx, "execution disabled");
  const formatted = getFormatted(ctx);
  if (!formatted) return skip(ctx, "no formatted data");
  await wbahStepCalendlyInvitee(bag, formatted);
  return ok(ctx, { ...bag, formatted }, { _wbahStep: "calendly_invitee" });
}

export async function executeWbahDashboardAnalyzed(ctx: NodeContext): Promise<NodeResult> {
  const bag = buildWbahRunBag(ctx);
  if (!bag) return err("Invalid WBAH webhook context");

  if (ctx.config._dryRun) {
    const { buildWbahDashboardAnalyzedPostBody } = await import(
      "@/lib/wbah/post-call/wbah-dashboard-post-body.shared"
    );
    const slotNodeId =
      ctx.nodeIdByLabel?.["build slot url"] ??
      ctx.nodeIdByLabel?.["build-slot-url"] ??
      "build-slot-url";
    const slotJson = (
      ctx.nodeOutputs[slotNodeId]?.[0] as { json?: Record<string, unknown> } | undefined
    )?.json;
    const requestBody = buildWbahDashboardAnalyzedPostBody(ctx.input.json, slotJson ?? {});
    return ok(ctx, bag, {
      _dryRunHttp: true,
      _requestBody: requestBody,
      _wbahStep: "dashboard_analyzed",
    });
  }

  if (!isWbahPostCallExecutionEnabled()) return skip(ctx, "execution disabled");
  const formatted = getFormatted(ctx);
  if (!formatted) return skip(ctx, "no formatted data");
  await wbahStepDashboardAnalyzed(bag, formatted, bag.calendlyBookingUrl ?? null);
  return ok(ctx, { ...bag, formatted }, { _wbahStep: "dashboard_analyzed" });
}

export async function executeWbahCallsUpsert(ctx: NodeContext): Promise<NodeResult> {
  const bag = buildWbahRunBag(ctx);
  if (!bag) return err("Invalid WBAH webhook context");
  if (!isWbahPostCallExecutionEnabled()) return skip(ctx, "execution disabled");
  const formatted = getFormatted(ctx);
  if (!formatted) return skip(ctx, "no formatted data");
  await wbahStepCallsUpsert(bag, formatted, bag.calendlyBookingUrl ?? null);
  return ok(ctx, { ...bag, formatted }, { _wbahStep: "wbah_calls_upsert" });
}

export async function executeWbahDynamicsAllens(ctx: NodeContext): Promise<NodeResult> {
  const bag = buildWbahRunBag(ctx);
  if (!bag) return err("Invalid WBAH webhook context");
  if (!isWbahPostCallExecutionEnabled()) return skip(ctx, "execution disabled");
  const formatted = getFormatted(ctx);
  if (!formatted || !bag.leadId) return skip(ctx, "missing lead or format");
  await wbahStepDynamicsAllens(bag, formatted, bag.calendlyBookingUrl ?? null);
  return ok(ctx, { ...bag, formatted }, { _wbahStep: "dynamics_allens" });
}

export async function executeWbahDynamicsAgentic(ctx: NodeContext): Promise<NodeResult> {
  const bag = buildWbahRunBag(ctx);
  if (!bag) return err("Invalid WBAH webhook context");
  if (!isWbahPostCallExecutionEnabled()) return skip(ctx, "execution disabled");
  const formatted = getFormatted(ctx);
  if (!formatted?.structuredJsonOutput) return skip(ctx, "no structured_json_output");
  await wbahStepDynamicsAgentic(bag, formatted);
  return ok(ctx, { ...bag, formatted }, { _wbahStep: "dynamics_agentic" });
}

/** Generic dispatcher when node config carries executorStepId. */
export async function executeWbahStepById(ctx: NodeContext): Promise<NodeResult> {
  const stepId = stepIdFromConfig(ctx);
  switch (stepId) {
    case "live_transcript":
      return executeWbahLiveTranscript(ctx);
    case "dashboard_raw":
      return executeWbahDashboardRaw(ctx);
    case "calendly_link":
      return executeWbahCalendlyLink(ctx);
    case "calendly_invitee":
      return executeWbahCalendlyInvitee(ctx);
    case "dashboard_analyzed":
      return executeWbahDashboardAnalyzed(ctx);
    case "wbah_calls_upsert":
      return executeWbahCallsUpsert(ctx);
    case "dynamics_allens":
      return executeWbahDynamicsAllens(ctx);
    case "dynamics_agentic":
      return executeWbahDynamicsAgentic(ctx);
    default:
      return skip(ctx, `unknown step ${stepId}`);
  }
}

export const WBAH_EXECUTOR_STEP_IDS = [
  "live_transcript",
  "dashboard_raw",
  "calendly_link",
  "calendly_invitee",
  "dashboard_analyzed",
  "wbah_calls_upsert",
  "dynamics_allens",
  "dynamics_agentic",
] as const;
