/**
 * WBAH plugin — native step handlers (wraps existing post-call implementations).
 */
import {
  markLiveCallSessionEnded,
  mergeWebhookTranscript,
  upsertLiveCallSession,
} from "@/lib/retell/live-call-sessions.server";
import { applyAllensLogicV5, isWbahAppointmentConfirmed } from "@/lib/wbah/post-call/wbah-allens-logic.shared";
import {
  buildWbahAgenticCrmPayload,
  buildWbahAllensCrmPayload,
  buildWbahCalendlySlotUrl,
  buildWbahClearDataAgenticPayload,
} from "@/lib/wbah/post-call/wbah-crm-payload.shared";
import {
  createWbahCalendlyBookingLink,
  createWbahCalendlyInvitee,
  isWbahCalendlyConfigured,
} from "@/lib/wbah/post-call/wbah-calendly.server";
import {
  getWbahLeadCurrentStatus,
  isWbahDynamicsConfigured,
  patchWbahLead,
} from "@/lib/wbah/post-call/wbah-dynamics.server";
import { cleanWbahRawData, formatWbahRetellCallData } from "@/lib/wbah/post-call/wbah-format-data.shared";
import { upsertWbahCallFromWebhook } from "@/lib/wbah/post-call/wbah-calls-upsert.server";
import { postWbahCallOutputCreate } from "@/lib/wbah/post-call/wbah-webespoke-writer.server";
import { forwardWbahDashboardAnalyzed } from "@/lib/wbah/post-call/wbah-dashboard-forward.shared";
import type { WbahRunBag } from "./wbah-run-context";

export async function wbahStepLiveTranscript(bag: WbahRunBag): Promise<void> {
  mergeWebhookTranscript(bag.call as any, bag.payload);
  const callId = bag.call.call_id;
  if (!callId) return;

  switch (bag.event) {
    case "call_started":
    case "transcript_updated":
      await upsertLiveCallSession({
        workspaceId: bag.agent.workspaceId,
        agentName: bag.agent.agentName,
        event: bag.event,
        call: bag.call as any,
      });
      break;
    case "call_ended":
    case "call_analyzed":
    case "call_transferred":
      await markLiveCallSessionEnded(bag.agent.workspaceId, callId, "ended");
      break;
    case "call_failed":
      await markLiveCallSessionEnded(bag.agent.workspaceId, callId, "failed");
      break;
    default:
      break;
  }
}

export async function wbahStepDashboardRaw(bag: WbahRunBag): Promise<void> {
  if (!bag.leadId) throw new Error("lead_id required");
  await postWbahCallOutputCreate({
    leadId: bag.leadId,
    event: bag.event,
    raw_data: cleanWbahRawData(bag.payload),
    retell_call_id: bag.call.call_id ?? null,
  });
}

export function wbahStepFormatData(bag: WbahRunBag): ReturnType<typeof formatWbahRetellCallData> {
  const formatted = formatWbahRetellCallData({
    dynVars: bag.dynVars,
    custom: bag.custom ?? {},
    callAnalysis: bag.call.call_analysis as Record<string, unknown> | undefined,
  });
  if (bag.leadId) formatted.leadId = bag.leadId;
  return formatted;
}

export async function wbahStepCalendlyLink(
  bag: WbahRunBag,
  formatted: ReturnType<typeof formatWbahRetellCallData>,
): Promise<string | null> {
  if (!formatted.hasBookingSlot || !isWbahCalendlyConfigured()) return null;
  const baseLink = await createWbahCalendlyBookingLink();
  if (!baseLink) return null;
  return buildWbahCalendlySlotUrl(baseLink, formatted);
}

export async function wbahStepCalendlyInvitee(
  bag: WbahRunBag,
  formatted: ReturnType<typeof formatWbahRetellCallData>,
): Promise<void> {
  if (!isWbahCalendlyConfigured()) return;
  const confirmed = isWbahAppointmentConfirmed({
    appointmentConfirmed: formatted.appointmentConfirmed,
    appointmentDate: formatted.appointmentDate,
    appointmentTime: formatted.requestedStartUtc,
    requestedStartUtc: formatted.requestedStartUtc,
  });
  if (!confirmed || !formatted.requestedStartUtc) return;

  const firstName = String(bag.dynVars.first_name ?? bag.dynVars.First_name ?? "").trim();
  const lastName = String(bag.dynVars.last_name ?? bag.dynVars.Last_name ?? "").trim();
  const name = [firstName, lastName].filter(Boolean).join(" ") || formatted.customerName || "Customer";
  const email = formatted.email || "no-reply@example.com";
  const phone = String(bag.call.to_number ?? bag.dynVars.phone ?? "").trim() || null;
  const propertyAddress =
    String(bag.dynVars.property_address_line2 ?? bag.dynVars.property_address ?? "").trim() || null;

  await createWbahCalendlyInvitee({
    email,
    name,
    startTimeUtc: formatted.requestedStartUtc,
    phone,
    propertyAddress,
    salesforceUuid: String(bag.dynVars.salesforce_uuid ?? "N/A"),
  });
}

export async function wbahStepDashboardAnalyzed(
  bag: WbahRunBag,
  formatted: ReturnType<typeof formatWbahRetellCallData>,
  calendlyBookingUrl: string | null,
): Promise<void> {
  if (!formatted.leadId) return;
  await forwardWbahDashboardAnalyzed({
    leadId: formatted.leadId,
    call: bag.call,
    payload: bag.payload,
    formatted,
    calendlyBookingUrl,
  });
}

export async function wbahStepCallsUpsert(
  bag: WbahRunBag,
  formatted: ReturnType<typeof formatWbahRetellCallData>,
  calendlyBookingUrl: string | null,
): Promise<void> {
  await upsertWbahCallFromWebhook({
    call: bag.call as any,
    agent: bag.agent,
    dynVars: bag.dynVars,
    formatted,
    calendlyBookingUrl,
    event: bag.event,
  });
}

export async function wbahStepDynamicsAllens(
  bag: WbahRunBag,
  formatted: ReturnType<typeof formatWbahRetellCallData>,
  calendlyBookingUrl: string | null,
): Promise<void> {
  if (!bag.leadId || !isWbahDynamicsConfigured()) return;
  const leadStatus = await getWbahLeadCurrentStatus(bag.leadId).catch(() => null);
  const allens = applyAllensLogicV5({
    userSentiment: formatted.userSentiment,
    callbackDatetime: formatted.callbackDatetime,
    callbackDatetimeUtc: formatted.callbackDatetimeUtc,
    callbackType: formatted.callbackType,
    calendlyBookingUrl,
    appointmentBooked: isWbahAppointmentConfirmed({
      appointmentConfirmed: formatted.appointmentConfirmed,
      appointmentDate: formatted.appointmentDate,
      appointmentTime: formatted.appointmentTimeUk,
      requestedStartUtc: formatted.requestedStartUtc,
    }),
    existingCurrentStatus: leadStatus?.new_currentstatus ?? null,
    existingStateCode: leadStatus?.statecode ?? null,
  });
  const patch = buildWbahAllensCrmPayload({
    formatted,
    allens,
    calendlyBookingUrl,
    callbackUtc: formatted.callbackDatetimeUtc,
  });
  if (Object.keys(patch).length) await patchWbahLead(bag.leadId, patch);
}

export async function wbahStepDynamicsAgentic(
  bag: WbahRunBag,
  formatted: ReturnType<typeof formatWbahRetellCallData>,
): Promise<void> {
  if (!bag.leadId || !isWbahDynamicsConfigured() || !formatted.structuredJsonOutput) return;
  const patch = buildWbahAgenticCrmPayload(formatted.structuredJsonOutput, bag.custom ?? {});
  if (Object.keys(patch).length) await patchWbahLead(bag.leadId, patch);

  const leadStatus = await getWbahLeadCurrentStatus(bag.leadId).catch(() => null);
  const clearPatch = buildWbahClearDataAgenticPayload({
    statecode: leadStatus?.statecode ?? null,
    newCurrentstatus: leadStatus?.new_currentstatus ?? null,
    userSentiment: formatted.userSentiment,
    callSummary: formatted.callSummary,
  });
  if (Object.keys(clearPatch).length) await patchWbahLead(bag.leadId, clearPatch);
}
