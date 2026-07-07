import { StickyNote } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  hasWbahAppointmentBooked,
  wbahBookingAgentName,
} from "@/lib/dashboard/wbah-appointment-display";
import {
  buildWbahAgentColorMap,
  wbahAgentStyle,
  type WbahAgentStyle,
} from "@/lib/dashboard/wbah-agent-colors";

type LeadLike = {
  full_name?: string | null;
  meta?: {
    agent_name?: string | null;
    appointment_date?: string | null;
    appointment_time?: string | null;
    calendly_booking_url?: string | null;
    booking_status?: string | null;
  } | null;
};

export function wbahAgentColorMapFromLeads(leads: LeadLike[]): Map<string, WbahAgentStyle> {
  const names = leads
    .filter(hasWbahAppointmentBooked)
    .map(wbahBookingAgentName)
    .filter(Boolean) as string[];
  return buildWbahAgentColorMap(names);
}

/** Coloured sticky-note badge shown beside the contact name when booked. */
export function WbahBookedStickyBadge({
  lead,
  agentColorMap,
}: {
  lead: LeadLike;
  agentColorMap?: Map<string, WbahAgentStyle>;
}) {
  if (!hasWbahAppointmentBooked(lead)) return null;
  const agent = wbahBookingAgentName(lead);
  const style = wbahAgentStyle(agent, agentColorMap);
  const tip = `Appointment booked${agent ? ` · ${agent}` : ""}${
    lead.meta?.appointment_date ? ` · ${lead.meta.appointment_date}` : ""
  }${lead.meta?.appointment_time ? ` ${lead.meta.appointment_time}` : ""}`;

  return (
    <span
      title={tip}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ring-1",
        style.bg,
        style.text,
        style.ring,
      )}
    >
      <StickyNote className="h-3 w-3 shrink-0" />
      Booked
    </span>
  );
}

export function WbahNotesButton({
  lead,
  agentColorMap,
  onClick,
}: {
  lead: LeadLike;
  agentColorMap?: Map<string, WbahAgentStyle>;
  onClick: () => void;
}) {
  const booked = hasWbahAppointmentBooked(lead);
  const agent = wbahBookingAgentName(lead);
  const style = booked ? wbahAgentStyle(agent, agentColorMap) : null;

  const title = booked
    ? `Appointment booked${agent ? ` · ${agent}` : ""}${lead.meta?.appointment_date ? ` · ${lead.meta.appointment_date}` : ""}`
    : "Notes & appointment";

  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        "flex items-center gap-1 rounded px-1.5 py-1 text-[10px] font-medium transition-colors border",
        booked && style
          ? cn(style.bg, style.text, style.ring, "ring-1 border-transparent hover:opacity-90 font-semibold")
          : "text-amber-400/80 hover:text-amber-400 hover:bg-amber-500/10 border-amber-500/20 hover:border-amber-500/40",
      )}
    >
      <StickyNote className="h-3 w-3 shrink-0" />
      <span>{booked ? "Booked" : "Notes"}</span>
    </button>
  );
}
