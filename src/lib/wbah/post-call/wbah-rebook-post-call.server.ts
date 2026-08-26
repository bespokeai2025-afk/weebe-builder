/**
 * WBAH Rebook Initial Consultation post-call — Opportunity-only (no Lead, no Calendly).
 */
import type { WbahPostCallProcessInput, WbahPostCallProcessResult } from "./wbah-post-call.server";
import type { WbahPostCallWorkflowConfig } from "@/lib/wbah/workflow/wbah-workflow-steps.shared";
import { cleanWbahRawData, formatWbahRetellCallData } from "./wbah-format-data.shared";
import {
  isWbahDynamicsConfigured,
  patchWbahOpportunity,
  postWbahOpportunityTimelineNote,
} from "./wbah-dynamics.server";
import { isWbahPostCallExecutionEnabled } from "./wbah-retell-agents.shared";
import { upsertWbahCallFromWebhook } from "./wbah-calls-upsert.server";
import { postWbahCallOutputCreate } from "./wbah-webespoke-writer.server";
import { forwardWbahDashboardAnalyzed } from "./wbah-dashboard-forward.shared";
import { resolveWbahRebookEntityIds } from "./wbah-rebook-entity.shared";
import {
  buildWbahRebookOpportunityPayload,
  buildWbahRebookTimelineNote,
} from "./wbah-rebook-opportunity-payload.shared";

type RetellCall = WbahPostCallProcessInput["call"];

function extractDynVars(call: RetellCall, payload: Record<string, unknown>): Record<string, unknown> {
  const fromCall = call.retell_llm_dynamic_variables ?? {};
  const nested =
    (payload.call as Record<string, unknown> | undefined)?.retell_llm_dynamic_variables ?? {};
  return { ...(typeof nested === "object" ? nested : {}), ...fromCall };
}

export function isWbahRebookPostCallWorkflow(
  wfConfig: WbahPostCallWorkflowConfig | null | undefined,
  agentRole?: string | null,
): boolean {
  if (wfConfig?.workflow_kind === "wbah_rebook_post_call") return true;
  return agentRole === "rebooking";
}

export async function runWbahRebookPostCallPipeline(
  input: WbahPostCallProcessInput & {
    wfConfig: WbahPostCallWorkflowConfig;
    skipLiveTranscript?: boolean;
  },
): Promise<WbahPostCallProcessResult> {
  const { event, call, payload, agent, wfConfig, skipLiveTranscript } = input;
  const branches: string[] = [];
  const errors: string[] = [];

  const { isStepEnabledInOrder } = await import("@/lib/wbah/workflow/wbah-workflow-graph.shared");
  const stepOn = (id: string) => isStepEnabledInOrder(wfConfig, id, event);

  if (!skipLiveTranscript && stepOn("live_transcript")) {
    try {
      const {
        markLiveCallSessionEnded,
        mergeWebhookTranscript,
        upsertLiveCallSession,
      } = await import("@/lib/retell/live-call-sessions.server");
      mergeWebhookTranscript(call, payload);
      const callId = call.call_id;
      if (callId) {
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
      branches.push("live_transcript");
    } catch (e) {
      errors.push(`live_transcript: ${(e as Error).message}`);
    }
  }

  if (!isWbahPostCallExecutionEnabled()) {
    return {
      handled: true,
      message: "rebook live only (WBAH_POST_CALL_ENABLED=false)",
      branches,
      errors,
    };
  }

  const dynVars = extractDynVars(call, payload);
  const entity = resolveWbahRebookEntityIds(dynVars);
  if (!entity) {
    return {
      handled: true,
      message: "rebook: missing opportunity_id / crm_type=opportunity",
      branches,
      errors,
    };
  }

  const recordId = entity.dashboardRecordId;
  const custom = call.call_analysis?.custom_analysis_data ?? {};

  if ((event === "call_started" || event === "call_ended") && stepOn("dashboard_raw")) {
    try {
      await postWbahCallOutputCreate({
        leadId: recordId,
        event,
        raw_data: cleanWbahRawData(payload),
        retell_call_id: call.call_id ?? null,
        crm_type: "opportunity",
        opportunity_id: entity.opportunityId,
      });
      branches.push("dashboard_raw");
    } catch (e) {
      errors.push(`dashboard_raw: ${(e as Error).message}`);
    }
  }

  if (event === "call_ended" && stepOn("wbah_calls_upsert")) {
    try {
      await upsertWbahCallFromWebhook({
        call,
        agent,
        dynVars: { ...dynVars, crm_type: "opportunity", opportunity_id: entity.opportunityId },
        formatted: null,
        event,
      });
      branches.push("wbah_calls_upsert");
    } catch (e) {
      errors.push(`wbah_calls_upsert: ${(e as Error).message}`);
    }
  }

  if (event === "call_started" || event === "call_ended") {
    return { handled: true, message: `rebook processed ${event}`, branches, errors };
  }

  if (event !== "call_analyzed") {
    return { handled: true, message: `rebook live only for ${event}`, branches, errors };
  }

  const formatted = formatWbahRetellCallData({
    dynVars,
    custom,
    callAnalysis: call.call_analysis as Record<string, unknown> | undefined,
  });
  formatted.leadId = recordId;

  if (stepOn("dashboard_analyzed")) {
    try {
      await forwardWbahDashboardAnalyzed({
        leadId: recordId,
        call,
        payload,
        formatted,
        calendlyBookingUrl: null,
        postCallExtras: {
          crm_type: "opportunity",
          opportunity_id: entity.opportunityId,
          appointment_time: formatted.appointmentTimeUk ?? formatted.requestedStartUtc,
          booking_status: formatted.appointmentConfirmed ? "confirmed" : "",
        },
      });
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
        dynVars: { ...dynVars, crm_type: "opportunity", opportunity_id: entity.opportunityId },
        formatted,
        calendlyBookingUrl: null,
        event,
      });
      branches.push("wbah_calls_upsert");
    } catch (e) {
      errors.push(`wbah_calls_upsert: ${(e as Error).message}`);
    }
  }

  if (isWbahDynamicsConfigured()) {
    if (stepOn("dynamics_rebook_opportunity")) {
      try {
        const oppPatch = buildWbahRebookOpportunityPayload({ formatted, dynVars, custom });
        if (Object.keys(oppPatch).length) {
          await patchWbahOpportunity(entity.opportunityId, oppPatch);
          branches.push("dynamics_rebook_opportunity");
        }
      } catch (e) {
        errors.push(`dynamics_rebook_opportunity: ${(e as Error).message}`);
      }
    }

    if (stepOn("dynamics_rebook_note")) {
      try {
        const noteText = buildWbahRebookTimelineNote({
          label: "WBAH Rebook AI call",
          callSummary: formatted.callSummary,
          userSentiment: formatted.userSentiment,
          callId: call.call_id ?? null,
          transcript: call.transcript ?? null,
        });
        await postWbahOpportunityTimelineNote({
          opportunityId: entity.opportunityId,
          subject: "WBAH Rebook AI call summary",
          noteText,
        });
        branches.push("dynamics_rebook_note");
      } catch (e) {
        errors.push(`dynamics_rebook_note: ${(e as Error).message}`);
      }
    }
  }

  console.log("[WBAH REBOOK POST-CALL] Completed", {
    event,
    callId: call.call_id,
    opportunityId: entity.opportunityId,
    originatingLeadId: entity.originatingLeadId,
    workflow: wfConfig.name,
    branches,
    errorCount: errors.length,
  });

  return {
    handled: true,
    message: errors.length ? "rebook completed with errors" : "rebook completed",
    branches,
    errors,
  };
}
