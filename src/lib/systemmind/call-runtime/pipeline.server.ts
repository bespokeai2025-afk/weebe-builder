// ── SystemMind call runtime: pre-call + post-call pipelines ──────────────────
// Pre-call: assemble call context (WEBEE lead record + approved variable
// mappings + transformation rules), gate on required data, place the Retell
// call via the same recipe as the shared auto-call path, log every step with
// masked values.
// Post-call: idempotent processing keyed by retell_call_id (hooked from the
// existing Retell webhook processor) — save outcome, update WEBEE lead,
// schedule retries/callbacks, CRM write-back with visible retryable errors.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { retellFetch } from "@/lib/providers/retell/client.server";
import { applyTransformation } from "@/lib/systemmind/variable-transforms.shared";
import {
  startExecution,
  maskRecord,
  recordIntegrationError,
} from "./executions.server";
import {
  setQueueStatus,
  scheduleQueueRetry,
  checkDailyCap,
  getTriggerWindow,
  isWithinCallingWindow,
} from "./queue.server";

const sb = supabaseAdmin as any;

// ── Pre-call data assembly ────────────────────────────────────────────────────

export interface AssembledCallData {
  dynamicVariables: Record<string, string>;
  missingRequired: string[];
  contextMasked: Record<string, unknown>;
}

/**
 * Build the dynamic-variable payload for a call from:
 *  1. the WEBEE lead record (primary data source),
 *  2. approved/edited dynamic variables from the variable engine (#456)
 *     scoped to the agent, honoring direction + allowSendToRetell + fallbacks,
 *  3. transformation rules applied per variable.
 */
export async function assembleCallData(args: {
  workspaceId: string;
  agentId: string | null;
  leadId: string;
}): Promise<AssembledCallData> {
  const { data: lead } = await sb
    .from("leads")
    .select("*")
    .eq("id", args.leadId)
    .eq("workspace_id", args.workspaceId)
    .maybeSingle();

  const leadRec: Record<string, unknown> = lead ?? {};
  const meta = (leadRec.meta as Record<string, unknown> | null) ?? {};

  const dynamicVariables: Record<string, string> = {};
  const missingRequired: string[] = [];

  if (leadRec.full_name) dynamicVariables.full_name = String(leadRec.full_name);

  let variables: any[] = [];
  if (args.agentId) {
    const { data } = await sb
      .from("systemmind_dynamic_variables")
      .select("*")
      .eq("workspace_id", args.workspaceId)
      .eq("agent_id", args.agentId)
      .in("status", ["approved", "edited"]);
    variables = data ?? [];
  }

  let rules: any[] = [];
  if (variables.length) {
    const { data } = await sb
      .from("systemmind_transformation_rules")
      .select("*")
      .eq("workspace_id", args.workspaceId)
      .in("variable_id", variables.map((v: any) => v.id));
    rules = data ?? [];
  }

  const lookup = (field: string): unknown => {
    if (!field) return undefined;
    if (field in leadRec) return leadRec[field];
    if (field in meta) return meta[field];
    const snake = field.replace(/([A-Z])/g, "_$1").toLowerCase();
    if (snake in leadRec) return leadRec[snake];
    if (snake in meta) return meta[snake];
    return undefined;
  };

  for (const v of variables) {
    const sendable =
      v.allow_send_to_retell !== false &&
      ["webee_to_retell_precall", "bidirectional", "crm_to_webee"].includes(v.direction ?? "");
    if (!sendable) continue;

    let raw = lookup(v.source_field || v.name);
    if ((raw == null || raw === "") && v.default_value) raw = v.default_value;
    if ((raw == null || raw === "") && v.fallback_value) raw = v.fallback_value;

    if (raw == null || raw === "") {
      if (v.is_required) missingRequired.push(v.name);
      continue;
    }

    let value = String(raw);
    for (const rule of rules.filter((r: any) => r.variable_id === v.id)) {
      try {
        const res = applyTransformation(rule as any, value);
        if (res && typeof res === "object" && "value" in res && (res as any).value != null) {
          value = String((res as any).value);
        }
      } catch {
        /* transformation errors keep the untransformed value */
      }
    }
    dynamicVariables[v.name] = value;
  }

  return {
    dynamicVariables,
    missingRequired,
    contextMasked: maskRecord({ lead_id: args.leadId, variables: dynamicVariables }),
  };
}

// ── Pre-call pipeline: process a claimed queue entry ─────────────────────────

export async function processQueueEntry(row: any): Promise<string> {
  const workspaceId = row.workspace_id as string;
  const exec = await startExecution({
    workspaceId,
    kind: "call_run",
    activationId: row.activation_id,
    triggerId: row.trigger_id,
    queueId: row.id,
    agentId: row.agent_id,
    leadId: row.lead_id,
    triggerSource: "queue",
  });
  if (!exec) return "skipped";

  try {
    // 1. Guards: calling window + daily cap
    let trigger: any = null;
    if (row.trigger_id) {
      const { data } = await sb
        .from("systemmind_call_triggers")
        .select("*")
        .eq("id", row.trigger_id)
        .maybeSingle();
      trigger = data;
    }
    const window = trigger?.calling_window ?? (await getTriggerWindow(row.trigger_id));
    if (!isWithinCallingWindow(window)) {
      await exec.skipStep("window", "Calling window check", "outside_calling_window");
      await setQueueStatus(row.id, workspaceId, "ready", {
        status_reason: "outside_calling_window",
        next_attempt_at: new Date(Date.now() + 15 * 60_000).toISOString(),
        claimed_at: null,
        claimed_by: null,
      });
      await exec.finish("completed", { summary: { outcome: "deferred_window" } });
      return "deferred_window";
    }
    if (trigger && !(await checkDailyCap(workspaceId, row.trigger_id, trigger.daily_cap ?? 0))) {
      await exec.skipStep("cap", "Daily cap check", "daily_cap_reached");
      await setQueueStatus(row.id, workspaceId, "ready", {
        status_reason: "daily_cap_reached",
        next_attempt_at: new Date(Date.now() + 60 * 60_000).toISOString(),
        claimed_at: null,
        claimed_by: null,
      });
      await exec.finish("completed", { summary: { outcome: "deferred_cap" } });
      return "deferred_cap";
    }

    // 2. Assemble call data
    let assembled: AssembledCallData = { dynamicVariables: {}, missingRequired: [], contextMasked: {} };
    const dataStep = await exec.step(
      "assemble_data",
      "Retrieve & transform lead data",
      async () => {
        assembled = await assembleCallData({
          workspaceId,
          agentId: row.agent_id,
          leadId: String(row.lead_id),
        });
        return { output: { variables: assembled.dynamicVariables, missing: assembled.missingRequired } };
      },
      { retryable: true, resolutionHint: "Check the variable mappings for this agent in the setup wizard." },
    );
    if (!dataStep.ok) {
      const st = await scheduleQueueRetry(row, dataStep.error ?? "data_assembly_failed");
      await exec.finish("failed", { error: dataStep.error });
      return st;
    }
    if (assembled.missingRequired.length) {
      await setQueueStatus(row.id, workspaceId, "waiting_for_data", {
        missing_required: assembled.missingRequired,
        status_reason: "missing_required_data",
        next_attempt_at: new Date(Date.now() + 30 * 60_000).toISOString(),
        claimed_at: null,
        claimed_by: null,
      });
      await exec.finish("partial", { summary: { outcome: "waiting_for_data", missing: assembled.missingRequired } });
      return "waiting_for_data";
    }

    // 3. Resolve agent + Retell config (same recipe as the shared auto-call path)
    let retellAgentId: string | null = null;
    let fromNumber: string | null = null;
    let agentName: string | null = null;
    let clientRetellKey: string | undefined;
    const agentStep = await exec.step(
      "resolve_agent",
      "Resolve agent & phone configuration",
      async () => {
        const { data: agent } = await sb
          .from("agents")
          .select("id, retell_agent_id, name, settings")
          .eq("id", row.agent_id)
          .eq("workspace_id", workspaceId)
          .maybeSingle();
        if (!agent) throw new Error("agent_not_found");
        const s = (agent.settings ?? {}) as Record<string, unknown>;
        retellAgentId = (s.deployedRetellAgentId as string) ?? agent.retell_agent_id ?? null;
        fromNumber = (s.phoneNumber as string) ?? null;
        agentName = agent.name ?? null;
        if (!retellAgentId || !fromNumber) throw new Error("agent_not_fully_configured");
        const { data: ws } = await sb
          .from("workspace_settings")
          .select("retell_workspace_id")
          .eq("workspace_id", workspaceId)
          .maybeSingle();
        clientRetellKey = (ws?.retell_workspace_id as string | undefined)?.trim() || undefined;
        return { output: { retellAgentId, fromNumber } };
      },
      { resolutionHint: "Deploy the agent and assign a phone number in the Builder before activating." },
    );
    if (!agentStep.ok) {
      await setQueueStatus(row.id, workspaceId, "failed", {
        last_error: agentStep.error ?? "agent_resolution_failed",
        status_reason: "agent_not_ready",
      });
      await exec.finish("failed", { error: agentStep.error });
      return "failed";
    }

    // 4. Place the call
    const attemptNumber = (row.attempt_count ?? 0) + 1;
    let retellCallId: string | null = null;
    const callStep = await exec.step(
      "place_call",
      "Place outbound call",
      async () => {
        const call = await retellFetch<any>(
          "/v2/create-phone-call",
          {
            from_number: fromNumber,
            to_number: row.phone,
            override_agent_id: retellAgentId,
            metadata: {
              lead_id: row.lead_id,
              workspace_id: workspaceId,
              trigger: "systemmind_call_runtime",
              queue_id: row.id,
            },
            retell_llm_dynamic_variables: assembled.dynamicVariables,
          },
          "POST",
          clientRetellKey,
        );
        retellCallId = call?.call_id ?? null;
        return { externalResponse: { call_id: retellCallId, status: call?.call_status } };
      },
      { retryable: true, resolutionHint: "Check the Retell key and from-number; see the attempt log for the provider response." },
    );

    await sb.from("systemmind_call_queue")
      .update({
        attempt_count: attemptNumber,
        call_context: assembled.contextMasked,
        dynamic_variables: maskRecord(assembled.dynamicVariables),
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);

    await sb.from("systemmind_call_attempts").insert({
      workspace_id: workspaceId,
      queue_id: row.id,
      attempt_number: attemptNumber,
      retell_call_id: retellCallId,
      outcome: callStep.ok ? "dialling" : "dial_failed",
      error: callStep.ok ? null : callStep.error?.slice(0, 500),
    });

    if (!callStep.ok) {
      const st = await scheduleQueueRetry({ ...row, attempt_count: attemptNumber }, callStep.error ?? "dial_failed");
      await exec.finish("failed", { error: callStep.error });
      return st;
    }

    // Mirror into the canonical calls table (same as the shared auto-call recipe).
    await sb.from("calls").insert({
      workspace_id: workspaceId,
      retell_call_id: retellCallId,
      agent_id: retellAgentId,
      agent_name: agentName,
      from_number: fromNumber,
      to_number: row.phone,
      call_type: "outbound",
      call_status: "initiated",
      lead_id: row.lead_id,
    });
    await sb.from("leads")
      .update({ status: "calling", updated_at: new Date().toISOString() })
      .eq("id", row.lead_id)
      .eq("workspace_id", workspaceId);

    await setQueueStatus(row.id, workspaceId, "calling", { status_reason: "dialling" });
    await exec.finish("completed", { summary: { outcome: "call_placed", retell_call_id: retellCallId } });
    return "calling";
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await scheduleQueueRetry(row, msg);
    await exec.finish("failed", { error: msg });
    return "failed";
  }
}

// ── Post-call pipeline (hooked from the Retell webhook processor) ────────────

/**
 * Idempotent post-call processing for runtime-placed calls. Looks up the
 * queue entry via systemmind_call_attempts.retell_call_id; no-ops for calls
 * the runtime didn't place. Never throws (webhook path must stay safe).
 */
export async function processRuntimePostCall(args: {
  workspaceId: string;
  retellCallId: string;
  event: string; // call_started | call_ended | call_analyzed | call_failed
  call: any;
}): Promise<void> {
  try {
    const { data: attempt } = await sb
      .from("systemmind_call_attempts")
      .select("id, queue_id, workspace_id, outcome")
      .eq("retell_call_id", args.retellCallId)
      .eq("workspace_id", args.workspaceId)
      .maybeSingle();
    if (!attempt) return;

    const { data: queueRow } = await sb
      .from("systemmind_call_queue")
      .select("*")
      .eq("id", attempt.queue_id)
      .maybeSingle();
    if (!queueRow) return;

    if (args.event === "call_started") {
      if (queueRow.status === "calling") {
        await setQueueStatus(queueRow.id, args.workspaceId, "connected", { status_reason: "call_connected" });
      }
      return;
    }
    if (!["call_ended", "call_analyzed", "call_failed"].includes(args.event)) return;

    // Idempotency: post-call outcome processing runs exactly once per call.
    const exec = await startExecution({
      workspaceId: args.workspaceId,
      kind: "post_call",
      activationId: queueRow.activation_id,
      triggerId: queueRow.trigger_id,
      queueId: queueRow.id,
      agentId: queueRow.agent_id,
      leadId: queueRow.lead_id,
      triggerSource: `webhook:${args.event}`,
      idempotencyKey: `postcall:${args.retellCallId}:${args.event}`,
    });
    if (!exec) return; // already processed (webhook replay)

    const call = args.call ?? {};
    const analysis = call.call_analysis ?? {};
    const custom = (analysis.custom_analysis_data ?? {}) as Record<string, unknown>;
    const NO_ANSWER = new Set(["no_answer", "busy", "voicemail"]);
    const noAnswer =
      NO_ANSWER.has(call.call_status ?? "") ||
      NO_ANSWER.has(call.disconnection_reason ?? "") ||
      analysis.in_voicemail === true;
    const failed = args.event === "call_failed";

    // 1. Record the attempt outcome
    await exec.step("attempt_outcome", "Record call outcome", async () => {
      const outcome = failed ? "failed" : noAnswer ? "no_answer" : "answered";
      await sb.from("systemmind_call_attempts")
        .update({
          ended_at: new Date().toISOString(),
          outcome,
          error: failed ? (call.disconnection_reason ?? "call_failed") : null,
        })
        .eq("id", attempt.id);
      return { output: { outcome } };
    });

    // 2. Update queue status (retry on no-answer/failed, complete on answered)
    let finalQueueStatus = "completed";
    if (args.event === "call_analyzed" || args.event === "call_failed" ||
        (args.event === "call_ended" && (noAnswer || failed))) {
      if (failed || noAnswer) {
        finalQueueStatus = await scheduleQueueRetry(
          { id: queueRow.id, workspace_id: args.workspaceId, attempt_count: queueRow.attempt_count, max_attempts: queueRow.max_attempts },
          failed ? "call_failed" : "no_answer",
        );
      } else if (args.event === "call_analyzed") {
        // Callback request honored via extraction field
        const callbackAt = custom.callback_time ?? custom.callback_datetime ?? null;
        if (callbackAt && !Number.isNaN(Date.parse(String(callbackAt)))) {
          finalQueueStatus = "callback_scheduled";
          await setQueueStatus(queueRow.id, args.workspaceId, "callback_scheduled", {
            status_reason: "callback_requested",
            next_attempt_at: new Date(String(callbackAt)).toISOString(),
            claimed_at: null,
            claimed_by: null,
          });
        } else {
          await setQueueStatus(queueRow.id, args.workspaceId, "completed", { status_reason: "call_completed" });
        }
      }
    }

    // 3. Write extraction results back to the WEBEE lead (retell_to_webee vars)
    if (args.event === "call_analyzed" && queueRow.lead_id && Object.keys(custom).length) {
      await exec.step(
        "webee_writeback",
        "Update WEBEE lead with extracted data",
        async () => {
          const { data: lead } = await sb
            .from("leads")
            .select("id, meta")
            .eq("id", queueRow.lead_id)
            .eq("workspace_id", args.workspaceId)
            .maybeSingle();
          if (!lead) return { output: { skipped: "lead_not_found" } };
          const meta = { ...((lead.meta as Record<string, unknown>) ?? {}) };
          meta.systemmind_extraction = { ...custom, extracted_at: new Date().toISOString() };
          const updates: Record<string, unknown> = { meta, updated_at: new Date().toISOString() };
          if (analysis.call_summary) updates.call_summary = String(analysis.call_summary).slice(0, 2000);
          if (analysis.user_sentiment) updates.interest_level =
            String(analysis.user_sentiment).toLowerCase() === "positive" ? "hot"
            : String(analysis.user_sentiment).toLowerCase() === "negative" ? "cold" : "warm";
          await sb.from("leads").update(updates).eq("id", lead.id).eq("workspace_id", args.workspaceId);
          return { output: { fields: Object.keys(custom) } };
        },
        { retryable: true },
      );
    }

    // 4. CRM write-back via the existing runtime adapters — failures land in
    //    systemmind_integration_errors (visible + retryable), never silent.
    if (args.event === "call_analyzed" && queueRow.phone) {
      const crmStep = await exec.step(
        "crm_writeback",
        "Write call outcome to CRM",
        async () => {
          const { dispatchCrmPostCall } = await import("@/lib/crm/crm-dispatch.server");
          await dispatchCrmPostCall(
            args.workspaceId,
            { phone: queueRow.phone, name: queueRow.lead_name || null, email: (custom.email as string) ?? null },
            {
              phone: queueRow.phone,
              contactName: queueRow.lead_name || null,
              agentName: null,
              summary: (analysis.call_summary as string) ?? null,
              durationSeconds: call.duration_ms != null ? Math.round(call.duration_ms / 1000) : null,
              sentiment: (analysis.user_sentiment as string) ?? null,
              callId: args.retellCallId,
              calledAt: new Date().toISOString(),
            },
          );
          return { output: { dispatched: true } };
        },
        { retryable: true, resolutionHint: "Check the CRM connection in the setup wizard, then retry from the Integration Errors panel." },
      );
      if (!crmStep.ok) {
        await recordIntegrationError({
          workspaceId: args.workspaceId,
          executionId: exec.id,
          queueId: queueRow.id,
          kind: "crm_writeback",
          operation: {
            phone: queueRow.phone,
            call_id: args.retellCallId,
            summary: analysis.call_summary ?? null,
            sentiment: analysis.user_sentiment ?? null,
          },
          error: crmStep.error ?? "crm_writeback_failed",
        });
      }
    }

    await exec.finish("completed", {
      summary: { event: args.event, queue_status: finalQueueStatus, extracted_fields: Object.keys(custom).length },
    });
  } catch (e) {
    console.warn("[call-runtime] post-call processing failed (non-fatal):", e instanceof Error ? e.message : e);
  }
}

// ── Integration-error retry sweep (tick) ─────────────────────────────────────

export async function retryIntegrationErrorsTick(): Promise<{ retried: number; resolved: number; deadLettered: number }> {
  const out = { retried: 0, resolved: 0, deadLettered: 0 };
  const nowIso = new Date().toISOString();
  const { data: due } = await sb
    .from("systemmind_integration_errors")
    .select("*")
    .in("status", ["pending", "retrying"])
    .lte("next_retry_at", nowIso)
    .limit(20);
  for (const err of due ?? []) {
    try {
      if (err.kind === "crm_writeback") {
        const op = (err.operation ?? {}) as Record<string, unknown>;
        const { dispatchCrmPostCall } = await import("@/lib/crm/crm-dispatch.server");
        await dispatchCrmPostCall(
          err.workspace_id,
          { phone: String(op.phone ?? ""), name: null, email: null },
          {
            phone: String(op.phone ?? ""),
            summary: (op.summary as string) ?? null,
            sentiment: (op.sentiment as string) ?? null,
            callId: String(op.call_id ?? err.id),
            calledAt: null,
          },
        );
        const { resolveIntegrationError } = await import("./executions.server");
        await resolveIntegrationError(err.id);
        out.resolved++;
      } else {
        // Unknown kinds only advance their backoff schedule.
        const { scheduleIntegrationRetry } = await import("./executions.server");
        await scheduleIntegrationRetry(err.id);
        out.retried++;
      }
    } catch {
      const { scheduleIntegrationRetry } = await import("./executions.server");
      await scheduleIntegrationRetry(err.id);
      out.retried++;
      const { data: after } = await sb
        .from("systemmind_integration_errors")
        .select("status")
        .eq("id", err.id)
        .maybeSingle();
      if (after?.status === "dead_letter") out.deadLettered++;
    }
  }
  return out;
}
