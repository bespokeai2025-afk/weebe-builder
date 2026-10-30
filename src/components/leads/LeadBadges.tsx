/** Leads page — sentiment, score, call, booking, origin and contact-preference badges. */
import type { LeadPageRow } from "@/lib/dashboard/leads-page.shared";
import {
  Phone,
  BarChart3,
  Globe,
  Building2,
  Upload,
  UserCog,
  Plug,
  Mail,
  MessageCircle,
  MessageSquareText,
  Contact,
  AlertTriangle,
} from "lucide-react";
import { deriveLeadOrigin } from "@/lib/leads/lead-origin.shared";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/ui/status-badge";

export function sentimentBadge(s: string | null | undefined) {
  if (!s) return null;
  const tone: Record<string, "success" | "warning" | "danger" | "neutral"> = {
    positive: "success",
    neutral: "warning",
    negative: "danger",
  };
  return (
    <StatusBadge tone={tone[s] ?? "neutral"} size="sm">
      {s}
    </StatusBadge>
  );
}

export function scoreBadge(score: number | null | undefined) {
  if (score == null) return <span className="text-muted-foreground">—</span>;
  const color =
    score >= 70
      ? "text-emerald-600 dark:text-emerald-400"
      : score >= 40
        ? "text-amber-600 dark:text-amber-400"
        : "text-red-600 dark:text-red-400";
  return <span className={`font-semibold ${color}`}>{score}</span>;
}

export function interestBadge(level: string | null | undefined) {
  if (!level) return null;
  const tone: Record<string, "success" | "warning" | "danger" | "neutral"> = {
    high: "success",
    medium: "warning",
    low: "danger",
  };
  return (
    <StatusBadge tone={tone[level] ?? "neutral"} size="sm">
      {level}
    </StatusBadge>
  );
}

export function callStatusBadge(status: string | null | undefined) {
  if (!status) return <span className="text-muted-foreground text-[11px]">—</span>;
  const tone: Record<string, "success" | "danger" | "orange" | "info" | "neutral"> = {
    completed: "success",
    failed: "danger",
    no_answer: "orange",
    initiated: "info",
    in_progress: "info",
  };
  return (
    <StatusBadge tone={tone[status] ?? "neutral"} size="sm" className="font-medium capitalize">
      {status.replace(/_/g, " ")}
    </StatusBadge>
  );
}

export function bookingStatusBadge(status: string | null) {
  if (!status) return <span className="text-muted-foreground text-[11px]">—</span>;
  const lower = status.toLowerCase();
  const tone: Record<string, "success" | "warning" | "danger" | "neutral"> = {
    booked: "success",
    confirmed: "success",
    success: "success",
    pending: "warning",
    cancelled: "danger",
  };
  return (
    <StatusBadge tone={tone[lower] ?? "neutral"} size="sm" className="font-medium capitalize">
      {status.replace(/_/g, " ")}
    </StatusBadge>
  );
}

// ── Lead origin / source indicators ─────────────────────────────────────────
// Uses the canonical deriveLeadOrigin() — consistent across web + mobile.
// Never branches on workspace identity; same renderer for every workspace.
export type LeadBadgeSpec = { Icon: typeof Globe; label: string; tone: string; tooltip: string };

export const ORIGIN_ICON_MAP: Record<string, typeof Globe> = {
  whatsapp: MessageCircle,
  voice_call: Phone,
  web_form: Globe,
  crm: Building2,
  csv_import: Upload,
  manual: UserCog,
  api: Plug,
  email: Mail,
  sms: MessageSquareText,
  campaign: BarChart3,
  unknown: Contact,
};

export function leadOriginBadgeSpec(lead: LeadPageRow): LeadBadgeSpec | null {
  const origin = deriveLeadOrigin(lead);
  if (origin === "unknown") return null; // hide badge for unknown

  const Icon = ORIGIN_ICON_MAP[origin] ?? Contact;
  const LABELS: Record<string, string> = {
    whatsapp: "WhatsApp",
    voice_call: "Voice",
    web_form: "Web Form",
    crm: "CRM",
    csv_import: "CSV / Import",
    manual: "Manual",
    api: "API",
    email: "Email",
    sms: "SMS",
    campaign: "Campaign",
  };
  const TONES: Record<string, string> = {
    whatsapp: "text-emerald-400 bg-emerald-500/10",
    voice_call: "text-blue-400 bg-blue-500/10",
    web_form: "text-sky-400 bg-sky-500/10",
    crm: "text-violet-400 bg-violet-500/10",
    csv_import: "text-amber-400 bg-amber-500/10",
    manual: "text-slate-400 bg-slate-500/10",
    api: "text-emerald-400 bg-emerald-500/10",
    email: "text-orange-400 bg-orange-500/10",
    sms: "text-fuchsia-400 bg-fuchsia-500/10",
    campaign: "text-pink-400 bg-pink-500/10",
  };
  const label = LABELS[origin] ?? origin;
  const tone = TONES[origin] ?? "text-muted-foreground bg-muted/40";
  const provider = lead.origin_provider ?? null;
  const tooltip = provider ? `${label}\nvia ${provider}` : label;
  return { Icon, label, tone, tooltip };
}

export function LeadSourceBadge({ lead }: { lead: LeadPageRow }) {
  const spec = leadOriginBadgeSpec(lead);
  if (!spec) return null;
  const { Icon, tooltip, tone } = spec;
  return (
    <span
      title={tooltip}
      className={cn("inline-flex shrink-0 items-center justify-center rounded p-0.5", tone)}
    >
      <Icon className="h-2.5 w-2.5" />
    </span>
  );
}

export function preferredContactBadgeSpec(lead: LeadPageRow): LeadBadgeSpec | null {
  const raw = String(
    lead?.preferred_contact ??
      lead?.preferred_contact_method ??
      lead?.meta?.preferred_contact ??
      lead?.meta?.preferred_contact_method ??
      "",
  )
    .toLowerCase()
    .trim();
  if (!raw) return null;
  if (raw === "phone" || raw === "call")
    return { Icon: Phone, label: "Prefers phone", tone: "text-blue-400 bg-blue-500/10", tooltip: "Prefers phone" };
  if (raw === "email")
    return { Icon: Mail, label: "Prefers email", tone: "text-orange-400 bg-orange-500/10", tooltip: "Prefers email" };
  if (raw === "whatsapp")
    return {
      Icon: MessageCircle,
      label: "Prefers WhatsApp",
      tone: "text-emerald-400 bg-emerald-500/10",
      tooltip: "Prefers WhatsApp",
    };
  if (raw === "sms" || raw === "text")
    return {
      Icon: MessageSquareText,
      label: "Prefers SMS",
      tone: "text-fuchsia-400 bg-fuchsia-500/10",
      tooltip: "Prefers SMS",
    };
  if (raw === "any" || raw === "no_preference")
    return {
      Icon: Contact,
      label: "No contact preference",
      tone: "text-slate-400 bg-slate-500/10",
      tooltip: "No contact preference",
    };
  return null;
}

export function PreferredContactBadge({
  lead,
  onEmailClick,
}: {
  lead: LeadPageRow;
  onEmailClick?: (lead: LeadPageRow) => void;
}) {
  const spec = preferredContactBadgeSpec(lead);
  if (!spec) return null;
  const { Icon, label, tone } = spec;
  const raw = String(
    lead?.preferred_contact ??
      lead?.preferred_contact_method ??
      lead?.meta?.preferred_contact ??
      lead?.meta?.preferred_contact_method ??
      "",
  )
    .toLowerCase()
    .trim();

  if (raw === "email" && onEmailClick && lead?.email) {
    return (
      <button
        type="button"
        title={`${label} — click to email ${lead.email}`}
        onClick={(e) => {
          e.stopPropagation();
          onEmailClick(lead);
        }}
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded p-0.5 transition hover:ring-1 hover:ring-orange-400/60",
          tone,
        )}
      >
        <Icon className="h-2.5 w-2.5" />
      </button>
    );
  }

  return (
    <span
      title={label}
      className={cn("inline-flex shrink-0 items-center justify-center rounded p-0.5", tone)}
    >
      <Icon className="h-2.5 w-2.5" />
    </span>
  );
}

// ── Booking failed — follow up (Ava web-call bookings that errored) ────────
// Flag written by ava-web-call.server.ts: meta.booking_failed / booking_error.
export function BookingFailedBadge({ lead, detailed = false }: { lead: LeadPageRow; detailed?: boolean }) {
  if (!lead?.meta?.booking_failed) return null;
  const err =
    typeof lead?.meta?.booking_error === "string" && lead.meta.booking_error.trim()
      ? lead.meta.booking_error.trim()
      : null;
  return (
    <StatusBadge
      tone="danger"
      icon={<AlertTriangle className="h-2.5 w-2.5" />}
      title={err ? `Booking failed — follow up. Error: ${err}` : "Booking failed — follow up"}
    >
      {detailed ? "Booking failed — follow up" : "Booking failed"}
    </StatusBadge>
  );
}
