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
          ? cn(style.bg, style.text, style.ring, "ring-1 hover:opacity-90")
          : "text-amber-400/80 hover:text-amber-400 hover:bg-amber-500/10 border-amber-500/20 hover:border-amber-500/40",
      )}
    >
      <StickyNote className="h-3 w-3 shrink-0" />
      <span>{booked ? "Booked" : "Notes"}</span>
    </button>
  );
}
