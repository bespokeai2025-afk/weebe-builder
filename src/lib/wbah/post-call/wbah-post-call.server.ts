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
import { applyAllensLogicV5 } from "./wbah-allens-logic.shared";
import {
  buildWbahAgenticCrmPayload,
  buildWbahAllensCrmPayload,
  buildWbahCalendlySlotUrl,
} from "./wbah-crm-payload.shared";
import { createWbahCalendlyBookingLink, isWbahCalendlyConfigured } from "./wbah-calendly.server";
import {
  getWbahLeadCurrentStatus,
  isWbahDynamicsConfigured,
  patchWbahLead,
} from "./wbah-dynamics.server";
import { cleanWbahRawData, formatWbahRetellCallData } from "./wbah-format-data.shared";
import {
  isWbahPostCallExecutionEnabled,
  type WbahRetellAgentMapping,
} from "./wbah-retell-agents.shared";
import { ukLocalToUtcIso } from "./wbah-uk-datetime.shared";
import { upsertWbahCallFromWebhook } from "./wbah-calls-upsert.server";
import { postWbahCallOutputCreate } from "./wbah-webespoke-writer.server";

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

  await postWbahCallOutputCreate({
    leadId: formatted.leadId,
    event: "call_analyzed",
    raw_data: cleanWbahRawData(payload),
    retell_call_id: call.call_id ?? null,
    customer_name: formatted.customerName,
    email: formatted.email,
    appointment_date: formatted.appointmentDate,
    appointment_time: formatted.requestedStartUtc ?? formatted.appointmentTimeUk,
    booking_status: calendlyBookingUrl ? "success" : formatted.hasBookingSlot ? "pending" : null,
    calendly_booking_url: calendlyBookingUrl,
    call_summary: formatted.callSummary ?? call.call_analysis?.call_summary ?? null,
    sentiment_analysis: formatted.userSentiment ?? call.call_analysis?.user_sentiment ?? null,
    callback_datetime: formatted.callbackDatetime,
    callback_type: formatted.callbackType,
  });
}

async function runDynamicsAllensPath(input: {
  leadId: string;
  formatted: ReturnType<typeof formatWbahRetellCallData>;
  calendlyBookingUrl: string | null;
}): Promise<void> {
  const callbackUtc =
    input.formatted.callbackDatetime && input.formatted.appointmentDate
      ? ukLocalToUtcIso(
          input.formatted.appointmentDate,
          input.formatted.callbackDatetime.includes(":")
            ? input.formatted.callbackDatetime
            : input.formatted.appointmentTimeUk ?? "09:00",
        )
      : input.formatted.callbackDatetime
        ? input.formatted.callbackDatetime
        : null;

  const allens = applyAllensLogicV5({
    userSentiment: input.formatted.userSentiment,
    callbackDatetime: input.formatted.callbackDatetime,
    calendlyBookingUrl: input.calendlyBookingUrl,
  });

  if (allens.newCurrentStatus == null) return;

  await getWbahLeadCurrentStatus(input.leadId).catch(() => null);

  const patch = buildWbahAllensCrmPayload({
    formatted: input.formatted,
    allens,
    calendlyBookingUrl: input.calendlyBookingUrl,
    callbackUtc,
  });

  await patchWbahLead(input.leadId, patch);
}

async function runDynamicsAgenticPath(input: {
  leadId: string;
  structured: Record<string, unknown> | null;
}): Promise<void> {
  const patch = buildWbahAgenticCrmPayload(input.structured);
  if (!Object.keys(patch).length) return;
  await patchWbahLead(input.leadId, patch);
}

export async function runWbahPostCallPipeline(
  input: WbahPostCallProcessInput,
): Promise<WbahPostCallProcessResult> {
  const { event, call, payload, agent } = input;
  const branches: string[] = [];
  const errors: string[] = [];

  const isWebCall = call.call_type === "web_call" || call.call_type === "webcall";
  if (isWebCall) {
    return { handled: true, message: "ignored: web call", branches, errors };
  }

  try {
    await handleLiveTranscript(event, call, payload, agent);
    branches.push("live_transcript");
  } catch (e) {
    errors.push(`live_transcript: ${(e as Error).message}`);
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

  if ((event === "call_started" || event === "call_ended") && leadId) {
    try {
      await postDashboardRaw({ event, call, payload, leadId });
      branches.push("dashboard_raw");
    } catch (e) {
      errors.push(`dashboard_raw: ${(e as Error).message}`);
    }
    return {
      handled: true,
      message: `processed ${event}`,
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

  const formatted = formatWbahRetellCallData({ dynVars, custom });
  formatted.leadId = leadId;

  let calendlyBookingUrl: string | null = null;
  if (formatted.hasBookingSlot && isWbahCalendlyConfigured()) {
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

  try {
    await postDashboardAnalyzed({ call, payload, formatted, calendlyBookingUrl });
    branches.push("dashboard_analyzed");
  } catch (e) {
    errors.push(`dashboard_analyzed: ${(e as Error).message}`);
  }

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

  if (isWbahDynamicsConfigured()) {
    try {
      await runDynamicsAllensPath({ leadId, formatted, calendlyBookingUrl });
      branches.push("dynamics_allens");
    } catch (e) {
      errors.push(`dynamics_allens: ${(e as Error).message}`);
    }

    if (formatted.structuredJsonOutput) {
      try {
        await runDynamicsAgenticPath({
          leadId,
          structured: formatted.structuredJsonOutput,
        });
        branches.push("dynamics_agentic");
      } catch (e) {
        errors.push(`dynamics_agentic: ${(e as Error).message}`);
      }
    }
  }

  console.log("[WBAH POST-CALL] Completed", {
    event,
    callId: call.call_id,
    leadId,
    branches,
    errorCount: errors.length,
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
} | null> {
  const { resolveWbahRetellAgent } = await import("./wbah-retell-agents.shared");
  const agent = resolveWbahRetellAgent(input.incomingAgentId);
  if (!agent) return null;

  const result = await runWbahPostCallPipeline({
    event: input.event,
    call: input.call,
    payload: input.payload,
    agent,
  });

  return {
    ok: true,
    status: 200,
    message: result.message,
    event: input.event,
    callId: input.call.call_id,
    workspaceId: agent.workspaceId,
  };
}
