import { Copy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  extractWbahCallBookingFields,
  formatWbahBookingStatusDisplay,
  isWbahCallAnalysisPending,
  resolveVisibleWbahCalendlyUrlFromFields,
  resolveWbahCallBookingFields,
} from "@/lib/dashboard/wbah-call-booking-display";

type RowLike = Record<string, unknown> | null | undefined;

function bookingStatusBadge(status: string | null | undefined) {
  const label = formatWbahBookingStatusDisplay(status);
  if (label === "—") return null;
  const lower = String(status ?? "").toLowerCase();
  const tone =
    lower === "success"
      ? "bg-green-500/15 text-green-400 border-green-500/30"
      : lower === "failed"
        ? "bg-red-500/15 text-red-400 border-red-500/30"
        : "bg-muted text-muted-foreground border-white/[0.06]";
  return (
    <Badge variant="outline" className={cn("text-[10px] capitalize", tone)}>
      {label}
    </Badge>
  );
}

export function WbahCallCalendlyLink({
  row,
  label = "View Calendly booking",
  emptyLabel = "—",
  showBookingStatus = false,
  showCopy = false,
  className,
}: {
  row: RowLike;
  label?: string;
  emptyLabel?: string;
  showBookingStatus?: boolean;
  showCopy?: boolean;
  className?: string;
}) {
  const fields = resolveWbahCallBookingFields(row);
  if (isWbahCallAnalysisPending(fields)) {
    return <span className={cn("text-muted-foreground text-[11px]", className)}>—</span>;
  }

  const url = resolveVisibleWbahCalendlyUrlFromFields(fields);
  const statusBadge = showBookingStatus ? bookingStatusBadge(fields.booking_status) : null;

  if (!url) {
    const statusLower = (fields.booking_status ?? "").toLowerCase();
    const label = statusLower === "success" ? "No booking link" : emptyLabel;
    return (
      <span className={cn("inline-flex items-center gap-1.5", className)}>
        {statusBadge}
        <span className="text-muted-foreground text-[11px]">{label}</span>
      </span>
    );
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url!);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      {statusBadge}
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[11px] font-medium text-primary hover:underline whitespace-nowrap"
        onClick={(e) => e.stopPropagation()}
      >
        {label}
      </a>
      {showCopy ? (
        <button
          type="button"
          title="Copy booking link"
          className="inline-flex rounded p-0.5 text-muted-foreground hover:text-foreground"
          onClick={(e) => {
            e.stopPropagation();
            void copyLink();
          }}
        >
          <Copy className="h-3 w-3" />
        </button>
      ) : null}
    </span>
  );
}

/** Lead-row Calendly link (meta.booking_status + meta.calendly_booking_url). */
export function WbahLeadCalendlyLink({
  lead,
  label = "Open booking",
}: {
  lead: {
    meta?: {
      booking_status?: string | null;
      calendly_booking_url?: string | null;
    } | null;
  };
  label?: string;
}) {
  const meta = lead.meta ?? {};
  return (
    <WbahCallCalendlyLink
      row={{
        booking_status: meta.booking_status,
        calendly_booking_url: meta.calendly_booking_url,
      }}
      label={label}
    />
  );
}

/** Map getWbahContactCallHistory item to booking field shape. */
export function wbahHistoryCallToBookingRow(call: Record<string, unknown>) {
  return extractWbahCallBookingFields({
    appointment_date: call.appointmentDate ?? call.appointment_date,
    appointment_time: call.appointmentTime ?? call.appointment_time,
    booking_status: call.bookingStatus ?? call.booking_status,
    calendly_booking_url: call.calendlyBookingUrl ?? call.calendly_booking_url,
    sentiment_analysis: call.sentiment ?? call.sentiment_analysis,
    call_status: call.callStatus ?? call.call_status,
    call_summary: call.callSummary ?? call.call_summary,
  });
}
