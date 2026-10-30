import { X } from "lucide-react";
import type { WbahPeopleRow } from "./wbah-people-row";
import {
  dqReasonLabel,
  isWbahLeadCallable,
  isWbahLeadDisqualified,
  parseWbahCrmData,
  buildWbahLeadCrmProfile,
  buildWbahLeadCallProfile,
  type WbahCrmData,
} from "@/lib/integrations/webespokeEnterprise/wbah-crm-data.types";
import { WbahCallBookingSection } from "@/components/dashboard/WbahCallBookingSection";
import { fmtDate } from "./data-format";

export type WbahLeadDetailView = {
  name: string;
  call?: Record<string, unknown> | null;
  crm?: Record<string, unknown> | null;
  postCall?: Record<string, unknown> | null;
  loadingCall?: boolean;
  row?: { name?: string | null; contact?: string | null; email?: string | null };
};

export function wbahCallDetailFromRow(r: WbahPeopleRow): Record<string, unknown> {
  const overlay = {
    Id: r.wbahCallId ?? r.id ?? null,
    CallId: r.wbahCallId ?? r.id ?? null,
    CallType: r.callType ?? null,
    AgentName: r.agentName ?? null,
    Name: r.name ?? null,
    CallStatus: r.callStatus ?? null,
    StartTimestamp: r.startTimestamp ?? null,
    DurationMs: r.durationMs ?? null,
    Transcript: r.transcript ?? null,
    ToNumber: r.contact ?? null,
    RecordingUrl: r.recordingUrl ?? null,
    DisconnectionReason: r.disconnectionReason ?? null,
    SentimentAnalysis: r.sentimentAnalysis ?? r.sentiment ?? null,
    Event: r.callStatus ?? null,
    Email: r.email ?? null,
    AppointmentDate: r.appointmentDate ?? r.appointment_date ?? null,
    AppointmentTime: r.appointmentTime ?? r.appointment_time ?? null,
    BookingStatus: r.bookingStatus ?? r.booking_status ?? null,
    CalendlyBookingUrl: r.calendlyBookingUrl ?? r.calendly_booking_url ?? null,
    appointment_date: r.appointmentDate ?? r.appointment_date ?? null,
    appointment_time: r.appointmentTime ?? r.appointment_time ?? null,
    booking_status: r.bookingStatus ?? r.booking_status ?? null,
    calendly_booking_url: r.calendlyBookingUrl ?? r.calendly_booking_url ?? null,
    sentimentAnalysis: r.sentimentAnalysis ?? r.sentiment ?? null,
    call_status: r.callStatus ?? null,
    EndReason: r.endReason ?? null,
    CallSummary: r.callSummary ?? r.call_summary ?? null,
    call_summary: r.callSummary ?? r.call_summary ?? null,
  };

  if (r?._rawCall && typeof r._rawCall === "object") {
    return { ...(r._rawCall as Record<string, unknown>), ...overlay };
  }

  const raw = (r?._rawLead ?? {}) as Record<string, unknown>;
  return {
    ...overlay,
    Id: overlay.Id ?? raw.wbah_call_id ?? null,
    CallId: overlay.CallId ?? raw.callId ?? raw.call_id ?? null,
    CallType: overlay.CallType ?? raw.callType ?? raw.call_type ?? null,
    AgentName: overlay.AgentName ?? raw.agentName ?? raw.agent_name ?? null,
    CallStatus: overlay.CallStatus ?? raw.callStatus ?? raw.call_status ?? null,
    StartTimestamp: overlay.StartTimestamp ?? raw.startTimestamp ?? raw.start_timestamp ?? null,
    DurationMs: overlay.DurationMs ?? raw.durationMs ?? raw.duration_ms ?? null,
    Transcript: overlay.Transcript ?? raw.transcript ?? null,
    ToNumber: overlay.ToNumber ?? raw.toNumber ?? raw.phone ?? null,
    RecordingUrl: overlay.RecordingUrl ?? raw.recordingUrl ?? raw.recording_url ?? null,
    DisconnectionReason:
      overlay.DisconnectionReason ?? raw.disconnectionReason ?? raw.disconnection_reason ?? null,
    SentimentAnalysis: overlay.SentimentAnalysis ?? raw.sentimentAnalysis ?? raw.sentiment ?? null,
    Event: overlay.Event ?? raw.event ?? raw.callStatus ?? raw.call_status ?? null,
    Email: overlay.Email ?? raw.email ?? null,
    LeadId: raw.lead_id ?? raw.leadId ?? null,
    AppointmentDate: overlay.AppointmentDate ?? raw.appointment_date ?? null,
    AppointmentTime: overlay.AppointmentTime ?? raw.appointment_time ?? null,
    BookingStatus: overlay.BookingStatus ?? raw.booking_status ?? null,
    CalendlyBookingUrl: overlay.CalendlyBookingUrl ?? raw.calendly_booking_url ?? null,
    appointment_date: overlay.appointment_date ?? raw.appointment_date ?? null,
    appointment_time: overlay.appointment_time ?? raw.appointment_time ?? null,
    booking_status: overlay.booking_status ?? raw.booking_status ?? null,
    calendly_booking_url: overlay.calendly_booking_url ?? raw.calendly_booking_url ?? null,
    sentimentAnalysis: overlay.sentimentAnalysis ?? raw.sentimentAnalysis ?? raw.sentiment ?? null,
    call_status: overlay.call_status ?? raw.callStatus ?? raw.call_status ?? null,
    EndReason: overlay.EndReason ?? raw.endReason ?? raw.end_reason ?? null,
    CallSummary: overlay.CallSummary ?? raw.callSummary ?? raw.call_summary ?? null,
  };
}

export function WbahLeadDetailModal({
  detail,
  onClose,
}: {
  detail: WbahLeadDetailView | null;
  onClose: () => void;
}) {
  if (!detail) return null;

  const crmParsed = parseWbahCrmData(detail.crm ?? null);
  const crmProfile = buildWbahLeadCrmProfile(detail.crm ?? null, {
    postCall: detail.postCall ?? null,
    row: detail.row,
  });
  const callProfile = buildWbahLeadCallProfile(detail.call ?? null);

  function renderProfileSection(title: string, rows: { label: string; value: string }[]) {
    if (!rows.length) return null;
    return (
      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </p>
        <div className="rounded-lg border border-border dark:border-white/[0.06] divide-y divide-border dark:divide-white/[0.04]">
          {rows.map((row) => (
            <div key={row.label} className="grid grid-cols-[minmax(8rem,34%)_1fr] gap-3 px-3 py-2">
              <p className="text-[11px] font-medium text-foreground">{row.label}</p>
              <p className="text-[11px] text-muted-foreground break-all">{row.value}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  function renderDisqualification(crm: WbahCrmData | null) {
    if (
      !crm ||
      (!crm.disqualification_reason && !crm.disqualified_at && !isWbahLeadDisqualified(crm))
    ) {
      return null;
    }
    const rows: Array<{ label: string; value: string }> = [
      { label: "Lead status", value: crm.lead_status },
      { label: "Reason", value: dqReasonLabel(crm) },
      {
        label: "Full reason",
        value: crm.disqualification_reason ?? "—",
      },
      {
        label: "Reason code",
        value:
          crm.new_disqualifiedreason_code != null ? String(crm.new_disqualifiedreason_code) : "—",
      },
      {
        label: "Disqualified at",
        value: crm.disqualified_at ? fmtDate(crm.disqualified_at, true) : "—",
      },
      { label: "Source", value: crm.disqualification_source ?? "—" },
      { label: "Need to call", value: crm.need_to_call ? "Yes" : "No" },
      {
        label: "Callable",
        value: isWbahLeadCallable(crm) ? "Yes (Disqualified campaigns)" : "No",
      },
    ];
    return (
      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Disqualification
        </p>
        <div className="rounded-lg border border-border dark:border-white/[0.06] divide-y divide-border dark:divide-white/[0.04]">
          {rows.map((row) => (
            <div key={row.label} className="grid grid-cols-[minmax(8rem,34%)_1fr] gap-3 px-3 py-2">
              <p className="text-[11px] font-medium text-foreground">{row.label}</p>
              <p className="text-[11px] text-muted-foreground break-all">{row.value}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  function renderCallSummaryBlock(summary: string | null | undefined) {
    if (!summary?.trim()) return null;
    return (
      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Call summary
        </p>
        <div className="rounded-lg border border-border dark:border-white/[0.06] bg-muted/20 dark:bg-white/[0.02] px-3 py-2.5">
          <p className="text-[11px] text-foreground/90 whitespace-pre-wrap leading-relaxed">
            {summary.trim()}
          </p>
        </div>
      </div>
    );
  }

  const callSummaryRaw = detail.call?.CallSummary ?? detail.call?.call_summary;
  const callSummary =
    typeof callSummaryRaw === "string" && callSummaryRaw.trim() ? callSummaryRaw.trim() : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-3xl rounded-xl border border-border dark:border-white/[0.08] bg-card flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border dark:border-white/[0.06] shrink-0">
          <p className="text-sm font-semibold">{detail.name} — Lead details</p>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4 space-y-5 flex-1">
          {renderCallSummaryBlock(callSummary)}
          <WbahCallBookingSection callRow={detail.call ?? null} polling={detail.loadingCall} />
          {renderProfileSection("Call", callProfile)}
          {renderDisqualification(crmParsed)}
          {renderProfileSection("Lead & CRM", crmProfile)}
          {!detail.call && !detail.crm && (
            <p className="text-xs text-muted-foreground">
              No detail fields available for this row.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
