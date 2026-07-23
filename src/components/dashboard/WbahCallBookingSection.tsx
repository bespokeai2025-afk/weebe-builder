import {
  resolveWbahBookingUiState,
  type WbahBookingUiState,
} from "@/lib/dashboard/wbah-call-booking-display";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[minmax(8rem,34%)_1fr] gap-3 px-3 py-2">
      <p className="text-[11px] font-medium text-foreground">{label}</p>
      <p className="text-[11px] text-muted-foreground break-all">{value}</p>
    </div>
  );
}

function PendingBlock({ polling }: { polling?: boolean }) {
  return (
    <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2.5 flex items-center gap-2">
      {polling && <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-500 shrink-0" />}
      <p className="text-[11px] text-amber-200/90">
        Call analysis pending… Booking and sentiment appear after analysis completes (usually 1–2 minutes).
      </p>
    </div>
  );
}

function BookedBlock({ ui }: { ui: Extract<WbahBookingUiState, { kind: "booked" }> }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Badge className="text-[10px] bg-green-500/15 text-green-400 border-green-500/30">
          Booked
        </Badge>
        <span className="text-[11px] text-muted-foreground capitalize">{ui.statusLabel}</span>
      </div>
      <div className="rounded-lg border border-white/[0.06] divide-y divide-white/[0.04]">
        <Row label="Appointment date" value={ui.dateLabel} />
        <Row label="Appointment time" value={ui.timeLabel} />
        <Row label="Booking status" value={ui.statusLabel} />
        <Row label="Calendly link" value={ui.calendlyLabel} />
      </div>
    </div>
  );
}

export function WbahCallBookingSection({
  callRow,
  polling,
}: {
  callRow: Record<string, unknown> | null | undefined;
  polling?: boolean;
}) {
  if (!callRow) return null;

  const ui = resolveWbahBookingUiState(callRow);

  return (
    <div className="space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Booking
      </p>
      {ui.kind === "pending" && <PendingBlock polling={polling} />}
      {ui.kind === "booked" && <BookedBlock ui={ui} />}
      {ui.kind === "positive_no_booking" && (
        <div className="rounded-lg border border-white/[0.06] divide-y divide-white/[0.04]">
          <Row label="Outcome" value={ui.label} />
          <Row label="Sentiment" value={ui.sentimentLabel} />
          <Row label="Calendly link" value="Booking link hidden" />
        </div>
      )}
      {ui.kind === "normal" && (
        <div className="rounded-lg border border-white/[0.06] divide-y divide-white/[0.04]">
          {ui.sentimentLabel && <Row label="Sentiment" value={ui.sentimentLabel} />}
          <Row label="Appointment date" value={ui.dateLabel} />
          <Row label="Appointment time" value={ui.timeLabel} />
          <Row label="Booking status" value={ui.statusLabel} />
          <Row label="Calendly link" value={ui.calendlyLabel} />
        </div>
      )}
      <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
        CRM lead status and email may differ from call booking data — use booking status on the call row as source of truth.
      </p>
    </div>
  );
}
