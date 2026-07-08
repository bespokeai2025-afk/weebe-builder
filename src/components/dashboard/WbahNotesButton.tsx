import { Calendar, StickyNote } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  hasWbahAppointmentBooked,
  wbahBookingAgentName,
  wbahCalendlyBookingUrl,
} from "@/lib/dashboard/wbah-appointment-display";
import {
  buildWbahAgentColorMap,
  wbahAgentStyle,
  type WbahAgentStyle,
} from "@/lib/dashboard/wbah-agent-colors";

type LeadLike = {
  sentiment?: string | null;
  full_name?: string | null;
  meta?: {
    agent_name?: string | null;
    appointment_date?: string | null;
    appointment_time?: string | null;
    calendly_booking_url?: string | null;
    booking_status?: string | null;
    call_count?: number;
  } | null;
};

export function wbahAgentColorMapFromLeads(leads: LeadLike[]): Map<string, WbahAgentStyle> {
  const names = leads
    .filter(hasWbahAppointmentBooked)
    .map(wbahBookingAgentName)
    .filter(Boolean) as string[];
  return buildWbahAgentColorMap(names);
}

/** Small agent-coloured calendar icon when the contact has a booked appointment. */
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
  const calendlyUrl = wbahCalendlyBookingUrl(lead);

  const icon = (
    <span
      title={tip}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded p-0.5 ring-1",
        style.bg,
        style.text,
        style.ring,
      )}
    >
      <Calendar className="h-2 w-2" strokeWidth={2.5} />
    </span>
  );

  if (calendlyUrl) {
    return (
      <a href={calendlyUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
        {icon}
      </a>
    );
  }

  return icon;
}

/** Call count pill — inline beside the contact name. */
export function WbahCallCountBadge({
  count,
  onClick,
}: {
  count: number;
  onClick?: () => void;
}) {
  if (count <= 1) return null;
  const pill = (
    <span className="inline-flex shrink-0 items-center tabular-nums rounded px-0.5 text-[8px] font-semibold leading-none text-blue-400/90 bg-blue-500/10">
      ×{count}
    </span>
  );
  if (!onClick) return pill;
  return (
    <button
      type="button"
      onClick={onClick}
      title="View all calls for this contact"
      className="inline-flex shrink-0 items-center rounded px-0.5 text-[8px] font-semibold leading-none tabular-nums text-blue-400/90 bg-blue-500/10 hover:bg-blue-500/20 transition-colors"
    >
      ×{count}
    </button>
  );
}

/** Clickable Calendly link for table columns. */
export function WbahCalendlyLink({ lead }: { lead: LeadLike }) {
  const url = wbahCalendlyBookingUrl(lead);
  if (!url) return <span className="text-muted-foreground text-[11px]">—</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-[11px] font-medium text-primary hover:underline whitespace-nowrap"
      onClick={(e) => e.stopPropagation()}
    >
      Calendly
    </a>
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
        "flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-medium transition-colors border",
        booked && style
          ? cn(style.bg, style.text, style.ring, "ring-1 border-transparent hover:opacity-90")
          : "text-amber-400/80 hover:text-amber-400 hover:bg-amber-500/10 border-amber-500/20 hover:border-amber-500/40",
      )}
    >
      {booked ? (
        <Calendar className="h-2.5 w-2.5 shrink-0" strokeWidth={2.5} />
      ) : (
        <StickyNote className="h-2.5 w-2.5 shrink-0" />
      )}
      {!booked && <span>Notes</span>}
    </button>
  );
}
