import { PlayRecordingButton } from "@/components/RecordingPlayerDialog";
import { WbahCallCalendlyLink, wbahHistoryCallToBookingRow } from "@/components/dashboard/WbahCallCalendlyLink";
import {
  formatWbahBookingStatusDisplay,
  isWbahCallAnalysisPending,
  wbahCallHistoryAppointmentCell,
} from "@/lib/dashboard/wbah-call-booking-display";
import type { WbahContactCallHistoryItem } from "@/lib/dashboard/wbah-call-history.types";
import { WBAH_TIMEZONE } from "@/lib/dashboard/wbah-timezone";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

function fmtDurSec(sec: number | null | undefined): string {
  if (sec == null || sec <= 0) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${s}s`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { timeZone: WBAH_TIMEZONE });
}

function bookingBadge(status: string | null | undefined) {
  const label = formatWbahBookingStatusDisplay(status);
  if (label === "—") return <span className="text-muted-foreground">—</span>;
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

export function WbahContactCallHistoryTable({
  calls,
  contactLabel,
  onViewTranscript,
}: {
  calls: WbahContactCallHistoryItem[];
  contactLabel: string;
  onViewTranscript?: (call: WbahContactCallHistoryItem) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-white/[0.06] text-left text-[10px] uppercase tracking-wide text-muted-foreground">
            <th className="px-2 py-1.5">Date</th>
            <th className="px-2 py-1.5">Status</th>
            <th className="px-2 py-1.5">Sentiment</th>
            <th className="px-2 py-1.5">Duration</th>
            <th className="px-2 py-1.5">Agent</th>
            <th className="px-2 py-1.5">Appointment</th>
            <th className="px-2 py-1.5">Booking</th>
            <th className="px-2 py-1.5">Calendly</th>
            <th className="px-2 py-1.5">Recording</th>
            <th className="px-2 py-1.5">Transcript</th>
          </tr>
        </thead>
        <tbody>
          {calls.map((c) => {
            const bookingRow = wbahHistoryCallToBookingRow(c as unknown as Record<string, unknown>);
            const pending = isWbahCallAnalysisPending(bookingRow);
            return (
              <tr key={c.id} className="border-b border-white/[0.04] align-middle">
                <td className="px-2 py-1.5 whitespace-nowrap text-muted-foreground">
                  {fmtDate(c.startedAt)}
                </td>
                <td className="px-2 py-1.5 whitespace-nowrap capitalize">
                  {(c.callStatus ?? "—").replace(/_/g, " ")}
                </td>
                <td className="px-2 py-1.5 capitalize">{c.sentiment ?? "—"}</td>
                <td className="px-2 py-1.5 whitespace-nowrap text-muted-foreground">
                  {fmtDurSec(c.durationSeconds)}
                </td>
                <td className="px-2 py-1.5 whitespace-nowrap text-muted-foreground">
                  {c.agentName ?? "—"}
                </td>
                <td className="px-2 py-1.5 whitespace-nowrap text-muted-foreground text-[11px]">
                  {pending ? "—" : wbahCallHistoryAppointmentCell(c as unknown as Record<string, unknown>)}
                </td>
                <td className="px-2 py-1.5 whitespace-nowrap">
                  {pending ? "—" : bookingBadge(c.bookingStatus)}
                </td>
                <td className="px-2 py-1.5 whitespace-nowrap">
                  <WbahCallCalendlyLink row={c as unknown as Record<string, unknown>} />
                </td>
                <td className="px-2 py-1.5">
                  {c.recordingUrl ? (
                    <PlayRecordingButton
                      url={c.recordingUrl}
                      contact={contactLabel}
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    />
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-2 py-1.5">
                  {c.hasTranscript && onViewTranscript ? (
                    <button
                      type="button"
                      onClick={() => onViewTranscript(c)}
                      className="text-violet-400 hover:underline"
                    >
                      View
                    </button>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
