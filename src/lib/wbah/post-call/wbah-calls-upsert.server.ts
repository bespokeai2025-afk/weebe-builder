/**
 * Mirror WBAH post-call webhook payloads into `wbah_calls` so Data → People → Calls
 * shows rows immediately (Retell sync only covers real Retell API calls).
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { WbahFormattedCallData } from "./wbah-format-data.shared";
import type { WbahRetellAgentMapping } from "./wbah-retell-agents.shared";

type RetellCall = {
  call_id?: string;
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
  };
};

function normSentiment(v: unknown): string | null {
  const s = String(v ?? "").toLowerCase();
  if (/positive/.test(s)) return "positive";
  if (/negative/.test(s)) return "negative";
  if (/neutral/.test(s)) return "neutral";
  return null;
}

function resolveName(
  dynVars: Record<string, unknown>,
  formatted: WbahFormattedCallData | null | undefined,
): string | null {
  if (formatted?.customerName) return formatted.customerName;
  const fromDyn =
    dynVars.name ??
    [dynVars.first_name, dynVars.last_name].filter(Boolean).join(" ").trim();
  return fromDyn ? String(fromDyn) : null;
}

export async function upsertWbahCallFromWebhook(input: {
  call: RetellCall;
  agent: WbahRetellAgentMapping;
  dynVars: Record<string, unknown>;
  formatted?: WbahFormattedCallData | null;
  calendlyBookingUrl?: string | null;
  event: string;
}): Promise<void> {
  const callId = input.call.call_id;
  if (!callId) return;

  const startMs = Number(input.call.start_timestamp ?? 0);
  const endMs = Number(input.call.end_timestamp ?? 0);
  const durationMs = startMs > 0 && endMs > startMs ? endMs - startMs : 0;
  const rawStatus = String(input.call.call_status ?? "").toLowerCase();
  const callStatus =
    input.event === "call_started" || rawStatus === "ongoing"
      ? "ongoing"
      : durationMs > 0 || input.event === "call_analyzed"
        ? "completed"
        : "no_answer";

  const startedAt = startMs > 0 ? new Date(startMs).toISOString() : new Date().toISOString();
  const formatted = input.formatted ?? null;
  const leadId =
    formatted?.leadId ??
    (input.dynVars.lead_id != null ? String(input.dynVars.lead_id) : null) ??
    (input.dynVars.leadId != null ? String(input.dynVars.leadId) : null);

  const row = {
    id: String(callId),
    workspace_id: input.agent.workspaceId,
    customer_name: resolveName(input.dynVars, formatted),
    phone:
      input.call.to_number ??
      input.call.from_number ??
      (input.dynVars.mobile != null ? String(input.dynVars.mobile) : null),
    agent_name: input.agent.agentName,
    call_status: callStatus,
    call_type: input.call.direction === "inbound" ? "inbound" : "outbound",
    sentiment: normSentiment(formatted?.userSentiment ?? input.call.call_analysis?.user_sentiment),
    duration_seconds: durationMs > 0 ? Math.round(durationMs / 1000) : callStatus === "completed" ? 0 : null,
    started_at: startedAt,
    recording_url: input.call.recording_url ?? null,
    transcript: input.call.transcript ?? null,
    call_summary:
      formatted?.callSummary ??
      input.call.call_analysis?.call_summary ??
      null,
    disconnection_reason: null,
    end_reason: null,
    appointment_date: formatted?.appointmentDate ?? null,
    appointment_time: formatted?.requestedStartUtc ?? formatted?.appointmentTimeUk ?? null,
    booking_status: input.calendlyBookingUrl
      ? "success"
      : formatted?.hasBookingSlot
        ? "pending"
        : null,
    calendly_booking_url: input.calendlyBookingUrl ?? null,
    call_count: 1,
    provider_call_id: String(callId),
    lead_id: leadId,
    meta: {
      source: "webee_post_call",
      event: input.event,
      lead_id: leadId,
      agent_id: (input.call as Record<string, unknown>).agent_id ?? null,
    },
    synced_at: new Date().toISOString(),
  };

  const { data: existing } = await (supabaseAdmin as any)
    .from("wbah_calls")
    .select("appointment_date, appointment_time, booking_status, calendly_booking_url, transcript")
    .eq("workspace_id", input.agent.workspaceId)
    .eq("id", row.id)
    .maybeSingle();

  const merged = { ...row };
  if (existing) {
    for (const field of [
      "appointment_date",
      "appointment_time",
      "booking_status",
      "calendly_booking_url",
      "transcript",
    ] as const) {
      const next = merged[field];
      const kept = existing[field];
      if ((next == null || String(next).trim() === "") && kept != null && String(kept).trim() !== "") {
        merged[field] = kept;
      }
    }
  }

  const { error } = await (supabaseAdmin as any)
    .from("wbah_calls")
    .upsert(merged, { onConflict: "id" });
  if (error) throw new Error(`wbah_calls upsert failed: ${error.message}`);
}
