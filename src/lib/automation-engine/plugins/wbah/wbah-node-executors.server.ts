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

/**
 * Each WBAH step runs at most once per execution. The imported n8n canvas tags
 * every helper node of a step (GET D365 Token, Merge token, Build CRM Payload…)
 * with the step's executor, so one call used to run Allen's Logic 8 times, the
 * agentic PATCH 5 times and post 5 identical timeline notes — racing the WBAH
 * team's own edits. Which of those nodes a call reaches depends on its branch
 * (a voicemail never gets past "Merge token into data"), so the step runs at the
 * first node reached and the rest reuse its result.
 */
type StepMemo = { at: number; result: Promise<Partial<WbahRunBag>> };
const stepMemo = new Map<string, StepMemo>();
const STEP_MEMO_TTL_MS = 30 * 60_000;

function runStepOnce(
  ctx: NodeContext,
  stepId: string,
  run: () => Promise<Partial<WbahRunBag>>,
): { first: boolean; result: Promise<Partial<WbahRunBag>> } {
  const now = Date.now();
  for (const [k, v] of stepMemo) if (now - v.at > STEP_MEMO_TTL_MS) stepMemo.delete(k);
  const key = `${ctx.executionId}:${stepId}`;
  const existing = stepMemo.get(key);
  if (existing) return { first: false, result: existing.result };
  const result = run();
  stepMemo.set(key, { at: now, result });
  return { first: true, result };
}

function stepRanInExecution(ctx: NodeContext, stepId: string): boolean {
  return stepMemo.has(`${ctx.executionId}:${stepId}`);
}

/** True once Allen's Logic wrote this call — it then owns the summary and sentiment. */
async function allensSucceeded(ctx: NodeContext): Promise<boolean> {
  const memo = stepMemo.get(`${ctx.executionId}:dynamics_allens`);
  if (!memo) return false;
  return memo.result.then(
    () => true,
    () => false,
  );
}

/** Calendly link for this call, created once per execution whichever node asks first. */
function calendlyLinkOnce(
  ctx: NodeContext,
  bag: WbahRunBag,
  formatted: NonNullable<ReturnType<typeof getFormatted>>,
): Promise<Partial<WbahRunBag>> {
  return runStepOnce(ctx, "calendly_link", async () => ({
    calendlyBookingUrl: await wbahStepCalendlyLink(bag, formatted),
  })).result;
}

/** Later nodes of a step that already ran: pass the step's result along, no side effects. */
async function alreadyRan(
  ctx: NodeContext,
  bag: WbahRunBag,
  result: Promise<Partial<WbahRunBag>>,
): Promise<NodeResult> {
  const patch = await result.catch(() => ({}));
  return ok(ctx, { ...bag, ...patch }, { _wbahSkipped: true, _skipReason: "step already ran" });
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
  const once = runStepOnce(ctx, "dashboard_raw", async () => {
    await wbahStepDashboardRaw(bag);
    return {};
  });
  if (!once.first) return alreadyRan(ctx, bag, once.result);
  await once.result;
  return ok(ctx, bag, { _wbahStep: "dashboard_raw" });
}

export async function executeWbahFormatData(ctx: NodeContext): Promise<NodeResult> {
  const bag = buildWbahRunBag(ctx);
  if (!bag) return err("Invalid WBAH webhook context");
  if (!bag.leadId) return skip(ctx, "no lead_id");
  const formatted = wbahStepFormatData(bag);
  return ok(ctx, { ...bag, formatted }, { _wbahStep: "format_data" });
}

/** The call's Calendly URL — from the bag, or by running the link step (once) now. */
async function bookingUrlFor(
  ctx: NodeContext,
  bag: WbahRunBag,
  formatted: NonNullable<ReturnType<typeof getFormatted>>,
): Promise<string | null> {
  if (bag.calendlyBookingUrl) return bag.calendlyBookingUrl;
  if (!formatted.hasBookingSlot) return null;
  return (await calendlyLinkOnce(ctx, bag, formatted)).calendlyBookingUrl ?? null;
}

export async function executeWbahCalendlyLink(ctx: NodeContext): Promise<NodeResult> {
  const bag = buildWbahRunBag(ctx);
  if (!bag) return err("Invalid WBAH webhook context");
  if (!isWbahPostCallExecutionEnabled()) return skip(ctx, "execution disabled");
  const formatted = getFormatted(ctx);
  if (!formatted?.hasBookingSlot) return skip(ctx, "no booking slot");
  const first = !stepRanInExecution(ctx, "calendly_link");
  const { calendlyBookingUrl } = await calendlyLinkOnce(ctx, bag, formatted);
  return ok(
    ctx,
    { ...bag, formatted, calendlyBookingUrl },
    first ? { _wbahStep: "calendly_link" } : { _wbahSkipped: true, _skipReason: "step already ran" },
  );
}

export async function executeWbahCalendlyInvitee(ctx: NodeContext): Promise<NodeResult> {
  const bag = buildWbahRunBag(ctx);
  if (!bag) return err("Invalid WBAH webhook context");
  if (!isWbahPostCallExecutionEnabled()) return skip(ctx, "execution disabled");
  const formatted = getFormatted(ctx);
  if (!formatted) return skip(ctx, "no formatted data");
  // Books a real appointment — a second run would book a second one.
  const once = runStepOnce(ctx, "calendly_invitee", async () => {
    await wbahStepCalendlyInvitee(bag, formatted);
    return {};
  });
  if (!once.first) return alreadyRan(ctx, bag, once.result);
  await once.result;
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
  const once = runStepOnce(ctx, "dashboard_analyzed", async () => {
    const slotUrl = await bookingUrlFor(ctx, bag, formatted);
    const confirmed = await wbahStepDashboardAnalyzed(bag, formatted, slotUrl);
    // The backend's reply carries the real booking link (reschedulings/) when
    // the agent booked during the call — it beats our slot-picker link.
    return { calendlyBookingUrl: confirmed?.calendlyBookingUrl ?? slotUrl };
  });
  if (!once.first) return alreadyRan(ctx, bag, once.result);
  const patch = await once.result;
  return ok(ctx, { ...bag, formatted, ...patch }, { _wbahStep: "dashboard_analyzed" });
}

export async function executeWbahCallsUpsert(ctx: NodeContext): Promise<NodeResult> {
  const bag = buildWbahRunBag(ctx);
  if (!bag) return err("Invalid WBAH webhook context");
  if (!isWbahPostCallExecutionEnabled()) return skip(ctx, "execution disabled");
  const formatted = getFormatted(ctx);
  if (!formatted) return skip(ctx, "no formatted data");
  const once = runStepOnce(ctx, "wbah_calls_upsert", async () => {
    // Wait for the dashboard POST when this run has one — its reply holds the
    // confirmed Calendly link, whichever order the canvas reaches the nodes in.
    const dashboard = stepMemo.get(`${ctx.executionId}:dashboard_analyzed`);
    const fromDashboard = dashboard ? (await dashboard.result.catch((): Partial<WbahRunBag> => ({}))).calendlyBookingUrl : null;
    const calendlyBookingUrl = fromDashboard ?? (await bookingUrlFor(ctx, bag, formatted));
    await wbahStepCallsUpsert(bag, formatted, calendlyBookingUrl);
    return { calendlyBookingUrl };
  });
  if (!once.first) return alreadyRan(ctx, bag, once.result);
  const patch = await once.result;
  return ok(ctx, { ...bag, formatted, ...patch }, { _wbahStep: "wbah_calls_upsert" });
}

export async function executeWbahDynamicsAllens(ctx: NodeContext): Promise<NodeResult> {
  const bag = buildWbahRunBag(ctx);
  if (!bag) return err("Invalid WBAH webhook context");
  if (!isWbahPostCallExecutionEnabled()) return skip(ctx, "execution disabled");
  const formatted = getFormatted(ctx);
  if (!formatted || !bag.leadId) return skip(ctx, "missing lead or format");
  const once = runStepOnce(ctx, "dynamics_allens", async () => {
    // The first Allen's node can run before the canvas reaches Create Booking
    // Link; build the link here so the CRM still gets cos_calendly_booking_url.
    const calendlyBookingUrl = await bookingUrlFor(ctx, bag, formatted);
    await wbahStepDynamicsAllens(bag, formatted, calendlyBookingUrl);
    return { calendlyBookingUrl };
  });
  if (!once.first) return alreadyRan(ctx, bag, once.result);
  const patch = await once.result;
  return ok(ctx, { ...bag, formatted, ...patch }, { _wbahStep: "dynamics_allens" });
}

export async function executeWbahDynamicsAgentic(ctx: NodeContext): Promise<NodeResult> {
  const bag = buildWbahRunBag(ctx);
  if (!bag) return err("Invalid WBAH webhook context");
  if (!isWbahPostCallExecutionEnabled()) return skip(ctx, "execution disabled");
  const formatted = getFormatted(ctx);
  if (!formatted?.structuredJsonOutput) return skip(ctx, "no structured_json_output");
  const once = runStepOnce(ctx, "dynamics_agentic", async () => {
    await wbahStepDynamicsAgentic(bag, formatted, {
      narrativeOwnedByAllens: await allensSucceeded(ctx),
    });
    return {};
  });
  if (!once.first) return alreadyRan(ctx, bag, once.result);
  await once.result;
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
