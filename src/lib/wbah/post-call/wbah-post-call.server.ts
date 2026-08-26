/**
 * WBAH native post-call pipeline — replaces n8n workflow yR3vAIdZNLovD8jx.
 *
 * Branches (parallel on call_analyzed when lead_id present):
 *  1. Live transcript (always)
 *  2. WeeBespoke dashboard POST (call-output-data/create)
 *  3. Calendly link + slot URL (when booking slot extracted)
 *  4. Dynamics Allen's Logic PATCH
 *  5. Dynamics agentic PATCH (structured_json_output)
 */
import {
  markLiveCallSessionEnded,
  mergeWebhookTranscript,
  upsertLiveCallSession,
} from "@/lib/retell/live-call-sessions.server";
import { applyAllensLogicV5, isWbahAppointmentConfirmed } from "./wbah-allens-logic.shared";
import {
  buildWbahAgenticCrmPayload,
  buildWbahAllensCrmPayload,
  buildWbahCalendlySlotUrl,
  buildWbahClearDataAgenticPayload,
} from "./wbah-crm-payload.shared";
import {
  createWbahCalendlyBookingLink,
  createWbahCalendlyInvitee,
  isWbahCalendlyConfigured,
} from "./wbah-calendly.server";
import {
  getWbahLeadCurrentStatus,
  isWbahDynamicsConfigured,
  patchWbahLead,
  postWbahLeadTimelineNote,
} from "./wbah-dynamics.server";
import { buildWbahAiTimelineNoteText } from "./wbah-timeline-note.shared";
import { cleanWbahRawData, formatWbahRetellCallData } from "./wbah-format-data.shared";
import {
  isWbahPostCallExecutionEnabled,
  type WbahRetellAgentMapping,
} from "./wbah-retell-agents.shared";
import { upsertWbahCallFromWebhook } from "./wbah-calls-upsert.server";
import { postWbahCallOutputCreate } from "./wbah-webespoke-writer.server";
import { forwardWbahDashboardAnalyzed } from "./wbah-dashboard-forward.shared";

type RetellCall = {
  call_id?: string;
  agent_id?: string;
  call_type?: string;
  call_status?: string;
  from_number?: string;
  to_number?: string;
  direction?: string;
  start_timestamp?: number;
  end_timestamp?: number;
  transcript?: string;
  recording_url?: string;
  call_analysis?: {
    call_summary?: string;
    user_sentiment?: string;
    custom_analysis_data?: Record<string, unknown>;
  };
  retell_llm_dynamic_variables?: Record<string, unknown>;
};

export type WbahPostCallProcessInput = {
  event: string;
  call: RetellCall;
  payload: Record<string, unknown>;
  agent: WbahRetellAgentMapping;
};

export type WbahPostCallProcessResult = {
  handled: boolean;
  message: string;
  branches: string[];
  errors: string[];
};

function extractDynVars(call: RetellCall, payload: Record<string, unknown>): Record<string, unknown> {
  const fromCall =
    call.retell_llm_dynamic_variables ??
    ((payload.call as RetellCall | undefined)?.retell_llm_dynamic_variables as
      | Record<string, unknown>
      | undefined) ??
    ((call as Record<string, unknown>).retell_llm_dynamic_variables as
      | Record<string, unknown>
      | undefined) ??
    {};
  const nested =
    (payload.call as Record<string, unknown> | undefined)?.retell_llm_dynamic_variables ??
    {};
  return { ...(typeof nested === "object" ? nested : {}), ...fromCall };
}

async function handleLiveTranscript(
  event: string,
  call: RetellCall,
  payload: Record<string, unknown>,
  agent: WbahRetellAgentMapping,
): Promise<void> {
  mergeWebhookTranscript(call, payload);
  const callId = call.call_id;
  if (!callId) return;

  switch (event) {
    case "call_started":
    case "transcript_updated":
      await upsertLiveCallSession({
        workspaceId: agent.workspaceId,
        agentName: agent.agentName,
        event,
        call,
      });
      break;
    case "call_ended":
    case "call_analyzed":
    case "call_transferred":
      await markLiveCallSessionEnded(agent.workspaceId, callId, "ended");
      break;
    case "call_failed":
      await markLiveCallSessionEnded(agent.workspaceId, callId, "failed");
      break;
    default:
      break;
  }
}

async function postDashboardRaw(input: {
  event: string;
  call: RetellCall;
  payload: Record<string, unknown>;
  leadId: string;
}): Promise<void> {
  await postWbahCallOutputCreate({
    leadId: input.leadId,
    event: input.event,
    raw_data: cleanWbahRawData(input.payload),
    retell_call_id: input.call.call_id ?? null,
  });
}

async function postDashboardAnalyzed(input: {
  call: RetellCall;
  payload: Record<string, unknown>;
  formatted: ReturnType<typeof formatWbahRetellCallData>;
  calendlyBookingUrl: string | null;
}): Promise<void> {
  const { formatted, call, payload, calendlyBookingUrl } = input;
  if (!formatted.leadId) return;

  await forwardWbahDashboardAnalyzed({
    leadId: formatted.leadId,
    call,
    payload,
    formatted,
    calendlyBookingUrl,
  });
}

async function runDynamicsAllensPath(input: {
  leadId: string;
  formatted: ReturnType<typeof formatWbahRetellCallData>;
  calendlyBookingUrl: string | null;
  custom?: Record<string, unknown>;
  transcript?: string | null;
}): Promise<void> {
  const leadStatus = await getWbahLeadCurrentStatus(input.leadId).catch(() => null);
  const custom = input.custom ?? {};
  const detailed =
    typeof custom.detailed_call_summary === "string" ? custom.detailed_call_summary : null;

  const allens = applyAllensLogicV5({
    userSentiment: input.formatted.userSentiment,
    callbackDatetime: input.formatted.callbackDatetime,
    callbackDatetimeUtc: input.formatted.callbackDatetimeUtc,
    callbackType: input.formatted.callbackType,
    calendlyBookingUrl: input.calendlyBookingUrl,
    appointmentBooked: isWbahAppointmentConfirmed({
      appointmentConfirmed: input.formatted.appointmentConfirmed,
      appointmentDate: input.formatted.appointmentDate,
      appointmentTime: input.formatted.appointmentTimeUk,
      requestedStartUtc: input.formatted.requestedStartUtc,
    }),
    existingCurrentStatus: leadStatus?.new_currentstatus ?? null,
    existingStateCode: leadStatus?.statecode ?? null,
    callSummary: input.formatted.callSummary,
    detailedCallSummary: detailed,
    transcript: input.transcript ?? null,
  });

  const patch = buildWbahAllensCrmPayload({
    formatted: input.formatted,
    allens,
    calendlyBookingUrl: input.calendlyBookingUrl,
    callbackUtc: input.formatted.callbackDatetimeUtc,
  });

  if (!Object.keys(patch).length) {
    console.log("[WBAH POST-CALL] dynamics_allens skipped", { rule: allens.rule });
    return;
  }

  console.log("[WBAH POST-CALL] dynamics_allens PATCH", {
    leadId: input.leadId,
    rule: allens.rule,
    allenLogicResult: allens.allenLogicResult,
    fieldCount: Object.keys(patch).length,
    fields: Object.keys(patch),
  });

  await patchWbahLead(input.leadId, patch);
}

async function runDynamicsAgenticPath(input: {
  leadId: string;
  formatted: ReturnType<typeof formatWbahRetellCallData>;
  custom: Record<string, unknown>;
}): Promise<void> {
  const structured = input.formatted.structuredJsonOutput;
  const patch = buildWbahAgenticCrmPayload(structured, input.custom);
  if (Object.keys(patch).length) {
    console.log("[WBAH POST-CALL] dynamics_agentic PATCH", {
      leadId: input.leadId,
      fieldCount: Object.keys(patch).length,
      fields: Object.keys(patch),
    });
    await patchWbahLead(input.leadId, patch);
  } else {
    console.log("[WBAH POST-CALL] dynamics_agentic skipped (no CRM fields after normalize)");
  }

  const leadStatus = await getWbahLeadCurrentStatus(input.leadId).catch(() => null);
  const clearPatch = buildWbahClearDataAgenticPayload({
    statecode: leadStatus?.statecode ?? null,
    newCurrentstatus: leadStatus?.new_currentstatus ?? null,
    userSentiment: input.formatted.userSentiment,
    callSummary: input.formatted.callSummary,
  });
  if (Object.keys(clearPatch).length) {
    console.log("[WBAH POST-CALL] clearDataforAgentic PATCH", {
      leadId: input.leadId,
      fields: Object.keys(clearPatch),
    });
    await patchWbahLead(input.leadId, clearPatch);
  }
}

async function runCalendlyInviteePath(input: {
  call: RetellCall;
  dynVars: Record<string, unknown>;
  formatted: ReturnType<typeof formatWbahRetellCallData>;
}): Promise<void> {
  if (!isWbahCalendlyConfigured()) return;

  const confirmed = isWbahAppointmentConfirmed({
    appointmentConfirmed: input.formatted.appointmentConfirmed,
    appointmentDate: input.formatted.appointmentDate,
    appointmentTime: input.formatted.requestedStartUtc,
    requestedStartUtc: input.formatted.requestedStartUtc,
  });
  if (!confirmed || !input.formatted.requestedStartUtc) return;

  const firstName = String(input.dynVars.first_name ?? input.dynVars.First_name ?? "").trim();
  const lastName = String(input.dynVars.last_name ?? input.dynVars.Last_name ?? "").trim();
  const name = [firstName, lastName].filter(Boolean).join(" ") || input.formatted.customerName || "Customer";
  const email = input.formatted.email || "no-reply@example.com";
  const phone = String(input.call.to_number ?? input.dynVars.phone ?? "").trim() || null;
  const propertyAddress = String(
    input.dynVars.property_address_line2 ?? input.dynVars.property_address ?? "",
  ).trim() || null;

  await createWbahCalendlyInvitee({
    email,
    name,
    startTimeUtc: input.formatted.requestedStartUtc,
    phone,
    propertyAddress,
    salesforceUuid: String(input.dynVars.salesforce_uuid ?? "N/A"),
  });
}

export async function runWbahPostCallPipeline(
  input: WbahPostCallProcessInput,
): Promise<WbahPostCallProcessResult> {
  return runWbahPostCallPipelineCore(input);
}

export async function runWbahPostCallPipelineCore(
  input: WbahPostCallProcessInput & { skipLiveTranscript?: boolean },
): Promise<WbahPostCallProcessResult> {
  const { event, call, payload, agent, skipLiveTranscript } = input;
  const branches: string[] = [];
  const errors: string[] = [];

  const isWebCall = call.call_type === "web_call" || call.call_type === "webcall";
  if (isWebCall) {
    return { handled: true, message: "ignored: web call", branches, errors };
  }

  const { resolveWbahPostCallWorkflowConfig } = await import(
    "@/lib/wbah/workflow/wbah-workflow-resolver.server"
  );
  const { isStepEnabledInOrder } = await import("@/lib/wbah/workflow/wbah-workflow-graph.shared");
  const wfConfig = await resolveWbahPostCallWorkflowConfig({
    workspaceId: agent.workspaceId,
    agentId: String(call.agent_id ?? ""),
  });

  if (
    agent.role === "rebooking" ||
    wfConfig.workflow_kind === "wbah_rebook_post_call"
  ) {
    const { runWbahRebookPostCallPipeline } = await import("./wbah-rebook-post-call.server");
    const { defaultRebookPostCallWorkflowConfig } = await import(
      "@/lib/wbah/workflow/wbah-rebook-workflow.shared"
    );
    const rebookConfig =
      wfConfig.workflow_kind === "wbah_rebook_post_call"
        ? wfConfig
        : defaultRebookPostCallWorkflowConfig({ retell_agents: wfConfig.retell_agents });
    return runWbahRebookPostCallPipeline({
      event,
      call,
      payload,
      agent,
      wfConfig: rebookConfig,
      skipLiveTranscript,
    });
  }

  const stepOn = (id: string) => isStepEnabledInOrder(wfConfig, id, event);

  if (!skipLiveTranscript && stepOn("live_transcript")) {
    try {
      await handleLiveTranscript(event, call, payload, agent);
      branches.push("live_transcript");
    } catch (e) {
      errors.push(`live_transcript: ${(e as Error).message}`);
    }
  }

  const executionEnabled = isWbahPostCallExecutionEnabled();
  if (!executionEnabled) {
    return {
      handled: true,
      message: "live only (WBAH_POST_CALL_ENABLED=false)",
      branches,
      errors,
    };
  }

  const dynVars = extractDynVars(call, payload);
  const leadId = String(dynVars.lead_id ?? dynVars.leadId ?? "").trim() || null;
  const custom = call.call_analysis?.custom_analysis_data ?? {};

  if (event === "call_ended" && stepOn("wbah_calls_upsert")) {
    try {
      await upsertWbahCallFromWebhook({
        call,
        agent,
        dynVars,
        formatted: null,
        event,
      });
      branches.push("wbah_calls_upsert");
    } catch (e) {
      errors.push(`wbah_calls_upsert: ${(e as Error).message}`);
    }
  }

  if ((event === "call_started" || event === "call_ended") && leadId) {
    if (stepOn("dashboard_raw")) {
      try {
        await postDashboardRaw({ event, call, payload, leadId });
        branches.push("dashboard_raw");
      } catch (e) {
        errors.push(`dashboard_raw: ${(e as Error).message}`);
      }
    }
    return {
      handled: true,
      message: `processed ${event}`,
      branches,
      errors,
    };
  }

  if (event === "call_ended") {
    return {
      handled: true,
      message: "processed call_ended",
      branches,
      errors,
    };
  }

  if (event !== "call_analyzed") {
    return { handled: true, message: `live only for ${event}`, branches, errors };
  }

  if (!leadId) {
    return { handled: true, message: "call_analyzed without lead_id", branches, errors };
  }

  const formatted = formatWbahRetellCallData({
    dynVars,
    custom,
    callAnalysis: call.call_analysis as Record<string, unknown> | undefined,
  });
  formatted.leadId = leadId;

  let calendlyBookingUrl: string | null = null;
  if (
    stepOn("calendly_link") &&
    formatted.hasBookingSlot &&
    isWbahCalendlyConfigured()
  ) {
    try {
      const baseLink = await createWbahCalendlyBookingLink();
      if (baseLink) {
        calendlyBookingUrl = buildWbahCalendlySlotUrl(baseLink, formatted);
        branches.push("calendly_link");
      }
    } catch (e) {
      errors.push(`calendly: ${(e as Error).message}`);
    }
  }

  if (stepOn("calendly_invitee") && formatted.hasBookingSlot) {
    try {
      await runCalendlyInviteePath({ call, dynVars, formatted });
      branches.push("calendly_invitee");
    } catch (e) {
      errors.push(`calendly_invitee: ${(e as Error).message}`);
    }
  }

  if (stepOn("dashboard_analyzed")) {
    try {
      await postDashboardAnalyzed({ call, payload, formatted, calendlyBookingUrl });
      branches.push("dashboard_analyzed");
    } catch (e) {
      errors.push(`dashboard_analyzed: ${(e as Error).message}`);
    }
  }

  if (stepOn("wbah_calls_upsert")) {
    try {
      await upsertWbahCallFromWebhook({
        call,
        agent,
        dynVars,
        formatted,
        calendlyBookingUrl,
        event,
      });
      branches.push("wbah_calls_upsert");
    } catch (e) {
      errors.push(`wbah_calls_upsert: ${(e as Error).message}`);
    }
  }

  if (isWbahDynamicsConfigured()) {
    if (stepOn("dynamics_allens")) {
      try {
        await runDynamicsAllensPath({ leadId, formatted, calendlyBookingUrl, custom, transcript: call.transcript ?? null });
        branches.push("dynamics_allens");
      } catch (e) {
        errors.push(`dynamics_allens: ${(e as Error).message}`);
      }
    }

    if (stepOn("dynamics_agentic") && formatted.structuredJsonOutput) {
      try {
        await runDynamicsAgenticPath({
          leadId,
          formatted,
          custom,
        });
        branches.push("dynamics_agentic");
      } catch (e) {
        errors.push(`dynamics_agentic: ${(e as Error).message}`);
      }
    }

    if (
      leadId &&
      (stepOn("dynamics_allens") || stepOn("dynamics_agentic"))
    ) {
      try {
        const noteText = buildWbahAiTimelineNoteText({
          label: "WBAH AI call",
          callId: call.call_id ?? null,
          userSentiment: formatted.userSentiment,
          callSummary: formatted.callSummary,
          transcript: call.transcript ?? null,
        });
        await postWbahLeadTimelineNote({
          leadId,
          subject: "WBAH AI call summary",
          noteText,
        });
        branches.push("dynamics_lead_note");
      } catch (e) {
        errors.push(`dynamics_lead_note: ${(e as Error).message}`);
      }
    }
  }

  console.log("[WBAH POST-CALL] Completed", {
    event,
    callId: call.call_id,
    leadId,
    workflow: wfConfig.name,
    branches,
    errorCount: errors.length,
    ...(errors.length ? { errors } : {}),
  });

  return {
    handled: true,
    message: errors.length ? "completed with errors" : "completed",
    branches,
    errors,
  };
}

export function getWbahPostCallReadiness(): {
  executionEnabled: boolean;
  dynamics: boolean;
  calendly: boolean;
  webespoke: boolean;
} {
  return {
    executionEnabled: isWbahPostCallExecutionEnabled(),
    dynamics: isWbahDynamicsConfigured(),
    calendly: isWbahCalendlyConfigured(),
    webespoke: true,
  };
}

/** Entry point from retell-webhook.processor — returns null if agent is not WBAH. */
export async function processWbahRetellWebhook(input: {
  event: string;
  call: RetellCall;
  payload: Record<string, unknown>;
  incomingAgentId: string;
}): Promise<{
  ok: boolean;
  status: number;
  message: string;
  event?: string;
  callId?: string;
  workspaceId?: string;
  queued?: boolean;
} | null> {
  const { resolveWbahRetellAgent } = await import("./wbah-retell-agents.shared");
  const agent = resolveWbahRetellAgent(input.incomingAgentId);
  if (!agent) return null;

  const { resolveWbahPostCallWorkflowConfig } = await import(
    "@/lib/wbah/workflow/wbah-workflow-resolver.server"
  );
  const { isStepEnabledInOrder } = await import("@/lib/wbah/workflow/wbah-workflow-graph.shared");
  const wfConfig = await resolveWbahPostCallWorkflowConfig({
    workspaceId: agent.workspaceId,
    agentId: String(input.call.agent_id ?? input.incomingAgentId),
  });

  if (isStepEnabledInOrder(wfConfig, "live_transcript", input.event)) {
    try {
      await handleLiveTranscript(input.event, input.call, input.payload, agent);
    } catch (e) {
      console.warn("[WBAH POST-CALL] live_transcript:", (e as Error).message);
    }
  }

  const dynVars =
    input.call.retell_llm_dynamic_variables ??
    ((input.payload.call as RetellCall | undefined)?.retell_llm_dynamic_variables as
      | Record<string, unknown>
      | undefined) ??
    {};
  const leadId = String(dynVars.lead_id ?? dynVars.leadId ?? "").trim() || null;

  const { isWbahPostCallQueueEnabled, enqueueWbahPostCallJob, drainWbahPostCallQueueAsync } =
    await import("./wbah-post-call-queue.server");

  const queueable =
    isWbahPostCallQueueEnabled() &&
    isWbahPostCallExecutionEnabled() &&
    (input.event === "call_analyzed" ||
      input.event === "call_started" ||
      input.event === "call_ended");

  if (queueable) {
    const { jobId } = await enqueueWbahPostCallJob({
      workspaceId: agent.workspaceId,
      retellCallId: input.call.call_id ?? null,
      leadId,
      event: input.event,
      agentId: input.incomingAgentId,
      payload: input.payload,
    });
    drainWbahPostCallQueueAsync(jobId);
    return {
      ok: true,
      status: 200,
      message: jobId ? "queued" : "deduped",
      event: input.event,
      callId: input.call.call_id,
      workspaceId: agent.workspaceId,
      queued: !!jobId,
    };
  }

  const result = await runWbahPostCallPipelineCore({
    event: input.event,
    call: input.call,
    payload: input.payload,
    agent,
    skipLiveTranscript: true,
  });

  return {
    ok: true,
    status: 200,
    message: result.message,
    event: input.event,
    callId: input.call.call_id,
    workspaceId: agent.workspaceId,
    queued: false,
  };
}
