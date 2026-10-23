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
  postWbahLeadTimelineNote,
} from "@/lib/wbah/post-call/wbah-dynamics.server";
import { buildWbahAiTimelineNoteText } from "@/lib/wbah/post-call/wbah-timeline-note.shared";
import { preserveWbahAddressAgainstDictationDrift } from "@/lib/wbah/post-call/wbah-uk-address.shared";
import { cleanWbahRawData, formatWbahRetellCallData } from "@/lib/wbah/post-call/wbah-format-data.shared";
import { upsertWbahCallFromWebhook } from "@/lib/wbah/post-call/wbah-calls-upsert.server";
import {
  postWbahCallOutputCreate,
  type WbahConfirmedBooking,
} from "@/lib/wbah/post-call/wbah-webespoke-writer.server";
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
    callStartedAtMs: (bag.call as { start_timestamp?: number }).start_timestamp ?? null,
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
): Promise<WbahConfirmedBooking | null> {
  if (!formatted.leadId) return null;
  return forwardWbahDashboardAnalyzed({
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
  const custom = bag.custom ?? bag.call.call_analysis?.custom_analysis_data ?? {};
  const allens = applyAllensLogicV5({
    userSentiment: formatted.userSentiment,
    callbackDatetime: formatted.callbackDatetime,
    callbackDatetimeUtc: formatted.callbackDatetimeUtc,
    callbackType: formatted.callbackType,
    callbackDefaulted: formatted.callbackDatetimeSource === "default_next_working_day",
    calendlyBookingUrl,
    appointmentBooked: isWbahAppointmentConfirmed({
      appointmentConfirmed: formatted.appointmentConfirmed,
      appointmentDate: formatted.appointmentDate,
      appointmentTime: formatted.appointmentTimeUk,
      requestedStartUtc: formatted.requestedStartUtc,
    }),
    existingCurrentStatus: leadStatus?.new_currentstatus ?? null,
    existingStateCode: leadStatus?.statecode ?? null,
    callSummary: formatted.callSummary,
    detailedCallSummary:
      typeof custom.detailed_call_summary === "string" ? custom.detailed_call_summary : null,
    transcript: bag.call.transcript ?? null,
  });
  // Same inputs as the core pipeline: without dynVars/transcript the contact
  // address was never mirrored from the property (contact_same_as_property
  // lives in collected_dynamic_variables) — Justina Johnson, 23 Oct.
  const patch = buildWbahAllensCrmPayload({
    formatted,
    allens,
    calendlyBookingUrl,
    callbackUtc: formatted.callbackDatetimeUtc,
    custom,
    transcript: bag.call.transcript ?? null,
    dynVars: bag.dynVars,
  });
  keepCrmAddressOverDictationDrift(bag.leadId, "allens", patch, leadStatus?.raw);
  if (Object.keys(patch).length) await patchWbahLead(bag.leadId, patch);
  if (!formatted.structuredJsonOutput) {
    await postWbahThisCallLeadNote(bag, formatted).catch((e) => {
      console.warn("[WBAH] lead note failed", (e as Error).message);
    });
  }
}

function keepCrmAddressOverDictationDrift(
  leadId: string,
  path: "allens" | "agentic",
  patch: Record<string, unknown>,
  existing: Record<string, unknown> | null | undefined,
): void {
  const preserved = preserveWbahAddressAgainstDictationDrift(patch, existing);
  if (preserved.length) {
    console.log("[WBAH CONTACT-ADDRESS] kept existing CRM address over dictation drift", {
      leadId,
      path,
      fields: preserved,
    });
  }
}

async function postWbahThisCallLeadNote(
  bag: WbahRunBag,
  formatted: ReturnType<typeof formatWbahRetellCallData>,
): Promise<void> {
  if (!bag.leadId || !isWbahDynamicsConfigured()) return;
  const callId = bag.call.call_id ?? null;
  const noteText = buildWbahAiTimelineNoteText({
    label: "WBAH AI call",
    callId,
    userSentiment: formatted.userSentiment,
    callSummary: formatted.callSummary,
    transcript: bag.call.transcript ?? null,
    appointmentDate: formatted.appointmentDate,
    appointmentTime: formatted.appointmentTimeUk ?? formatted.requestedStartUtc,
    callbackUtc: formatted.callbackDatetimeUtc,
  });
  await postWbahLeadTimelineNote({
    leadId: bag.leadId,
    subject: `WBAH AI call summary${callId ? ` — ${callId}` : ""}`.slice(0, 200),
    noteText,
  });
}

export async function wbahStepDynamicsAgentic(
  bag: WbahRunBag,
  formatted: ReturnType<typeof formatWbahRetellCallData>,
  opts?: { narrativeOwnedByAllens?: boolean },
): Promise<void> {
  if (!bag.leadId || !isWbahDynamicsConfigured() || !formatted.structuredJsonOutput) return;
  const patch = buildWbahAgenticCrmPayload(
    formatted.structuredJsonOutput,
    bag.custom ?? {},
    bag.call.transcript ?? null,
    bag.dynVars,
  );
  // Same single owner for the narrative as the core pipeline: when Allen's
  // Logic already wrote this call, the summary and sentiment are its to keep.
  if (opts?.narrativeOwnedByAllens) {
    delete (patch as Record<string, unknown>).cos_call_summary;
    delete (patch as Record<string, unknown>).cos_user_sentiment;
  }
  const leadStatus = await getWbahLeadCurrentStatus(bag.leadId).catch(() => null);
  keepCrmAddressOverDictationDrift(bag.leadId, "agentic", patch, leadStatus?.raw);
  if (Object.keys(patch).length) await patchWbahLead(bag.leadId, patch);

  const clearPatch = buildWbahClearDataAgenticPayload({
    statecode: leadStatus?.statecode ?? null,
    newCurrentstatus: leadStatus?.new_currentstatus ?? null,
    userSentiment: opts?.narrativeOwnedByAllens ? null : formatted.userSentiment,
    callSummary: opts?.narrativeOwnedByAllens ? null : formatted.callSummary,
  });
  if (Object.keys(clearPatch).length) await patchWbahLead(bag.leadId, clearPatch);
  await postWbahThisCallLeadNote(bag, formatted).catch((e) => {
    console.warn("[WBAH] lead note failed", (e as Error).message);
  });
}
