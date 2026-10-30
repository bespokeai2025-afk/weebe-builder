/**
 * Leads page — filters, totals and paging, shared by the server and the page.
 *
 * The page used to download every lead (WBAH: all ~7,000 positive/neutral contacts, with summaries
 * and transcript flags; other workspaces: the latest 1,000 with their calls' full transcripts) and
 * filter in the browser. Other workspaces silently stopped at 1,000, so search and filters never
 * saw older leads. The server now applies these same rules and returns one page plus totals.
 *
 * Moved unchanged from leads.index.tsx so results match what the page showed before.
 */
import { deriveLeadOrigin } from "@/lib/leads/lead-origin.shared";
import { normalizeSentiment } from "@/lib/sentiment";
import { rowMatchesAgent, type AgentMatchTarget } from "@/lib/agents/agent-match.shared";
import {
  leadMatchesStatusCategory,
  type LeadStatusCategory,
} from "@/lib/dashboard/lead-status-categories";
import { hasWbahAppointmentBooked, wbahBookingAgentName } from "@/lib/dashboard/wbah-appointment-display";

export type LeadsPageFilters = {
  search?: string;
  status?: string;
  statusCategory?: LeadStatusCategory;
  sentiment?: string;
  callStatus?: string;
  /** WBAH agent name, or "all". */
  wbahAgent?: string;
  /** Workspace agent (other workspaces). */
  agent?: AgentMatchTarget | null;
  /** Minimum call duration in seconds. */
  minDurationSec?: number;
  outcome?: "" | "successful" | "unsuccessful";
  /** Applied to the last call (WBAH) or last contact / creation date. */
  dateFrom?: string;
  dateTo?: string;
  origin?: string;
  quick?: string;
};

/** Per-lead call details: WBAH rows carry them here, other workspaces in `retell_call`. */
export type LeadRowMeta = {
  agent_name?: string | null;
  agent_id?: string | null;
  partial_qualified?: boolean;
  last_called_at?: string | null;
  call_status?: string | null;
  recording_url?: string | null;
  has_transcript?: boolean;
  end_reason?: string | null;
  duration_ms?: number | null;
  disconnection_reason?: string | null;
  call_count?: number;
  appointment_date?: string | null;
  appointment_time?: string | null;
  booking_status?: string | null;
  calendly_booking_url?: string | null;
  [key: string]: unknown;
};

/** The latest call for a lead (other workspaces). */
export type LeadRetellCall = {
  id?: string;
  call_status?: string | null;
  duration_seconds?: number | null;
  recording_url?: string | null;
  transcript?: string | null;
  disconnection_reason?: string | null;
  call_summary?: string | null;
  sentiment?: string | null;
  started_at?: string | null;
};

/** One row on the Leads page: a `leads` row, or a WBAH contact derived from its calls. */
export type LeadPageRow = {
  id: string;
  full_name?: string | null;
  /** Older rows and some imports carry a plain name. */
  name?: string | null;
  company_name?: string | null;
  phone?: string | null;
  email?: string | null;
  status?: string | null;
  sentiment?: string | null;
  lead_score?: number | null;
  interest_level?: string | null;
  call_summary?: string | null;
  next_action?: string | null;
  last_contacted_at?: string | null;
  created_at?: string | null;
  meeting_requested?: boolean | null;
  callback_date?: string | null;
  has_buzzchat_reply?: boolean | null;
  agent_id?: string | null;
  meta?: LeadRowMeta | null;
  retell_call?: LeadRetellCall | null;
  [key: string]: unknown;
};

type AnyLead = LeadPageRow;

export function leadDurationSeconds(l: AnyLead): number {
  if (l?.retell_call?.duration_seconds != null) return Number(l.retell_call.duration_seconds) || 0;
  if (l?.meta?.duration_ms != null) return (Number(l.meta.duration_ms) || 0) / 1000;
  return 0;
}

export function leadCallStatus(l: AnyLead): string {
  return String(l?.retell_call?.call_status ?? l?.meta?.call_status ?? "").toLowerCase();
}

/** Other workspaces whose leads come from Retell calls (vs WBAH's derived contacts). */
export function leadsAreRetell(leads: AnyLead[], isWbah: boolean): boolean {
  return !isWbah && leads.some((l) => l.retell_call != null);
}

export function leadMatchesPageFilters(
  l: AnyLead,
  f: LeadsPageFilters,
  ctx: { isWbah: boolean; isRetell: boolean },
): boolean {
  const { isWbah, isRetell } = ctx;
  const search = String(f.search ?? "").trim();
  if (search) {
    const q = search.toLowerCase();
    if (
      !(
        (l.full_name ?? "").toLowerCase().includes(q) ||
        (l.phone ?? "").includes(q) ||
        (l.email ?? "").toLowerCase().includes(q) ||
        (l.company_name ?? "").toLowerCase().includes(q)
      )
    )
      return false;
  }
  if (f.status && l.status !== f.status) return false;
  if (!leadMatchesStatusCategory(l.status, f.statusCategory ?? "all")) return false;
  if (f.sentiment && normalizeSentiment(l.sentiment) !== f.sentiment) return false;
  if (f.callStatus) {
    const cs = isRetell ? l.retell_call?.call_status : isWbah ? l.meta?.call_status : null;
    if (cs !== f.callStatus) return false;
  }
  if (f.wbahAgent && f.wbahAgent !== "all" && (l.meta?.agent_name ?? "") !== f.wbahAgent) return false;
  if (
    !isWbah &&
    f.agent &&
    !rowMatchesAgent(f.agent, { agentId: l.agent_id ?? l.meta?.agent_id, agentName: l.meta?.agent_name })
  )
    return false;
  // Call duration greater than N seconds.
  if (f.minDurationSec && f.minDurationSec > 0 && leadDurationSeconds(l) < f.minDurationSec) return false;
  // Call outcome: successful = completed / positive; unsuccessful = failed/no-answer/busy/negative.
  if (f.outcome === "successful") {
    const cs = leadCallStatus(l);
    if (!(cs === "completed" || normalizeSentiment(l.sentiment) === "positive")) return false;
  }
  if (f.outcome === "unsuccessful") {
    const cs = leadCallStatus(l);
    const bad =
      ["failed", "no_answer", "busy", "not_connected"].includes(cs) ||
      normalizeSentiment(l.sentiment) === "negative";
    if (!bad) return false;
  }
  if (f.dateFrom || f.dateTo) {
    const dateStr = l.meta?.last_called_at ?? l.last_contacted_at ?? l.created_at ?? null;
    if (!dateStr) return false;
    const ts = new Date(dateStr).getTime();
    if (isNaN(ts)) return false;
    if (f.dateFrom && ts < new Date(f.dateFrom).getTime()) return false;
    if (f.dateTo && ts > new Date(f.dateTo).getTime()) return false;
  }
  if (f.origin && deriveLeadOrigin(l) !== f.origin) return false;
  if (f.quick) {
    const ns = normalizeSentiment(l.sentiment);
    const st = l.status;
    switch (f.quick) {
      case "before_call":
        if (st !== "need_to_call") return false;
        break;
      case "after_call":
        if (st === "need_to_call") return false;
        break;
      case "positive":
        if (ns !== "positive") return false;
        break;
      case "neutral":
        if (ns !== "neutral") return false;
        break;
      case "partial_qualified":
        if (!l.meta?.partial_qualified) return false;
        break;
      case "disqualified":
        if (st !== "not_interested") return false;
        break;
      case "callback":
        if (!(l.callback_date || st === "callback_requested")) return false;
        break;
      case "not_called":
        if (st !== "not_connected") return false;
        break;
      case "buzzchat_replied":
        if (!l.has_buzzchat_reply) return false;
        break;
    }
  }
  return true;
}

/** Headline numbers for the page — always over every lead, not the filtered set. */
export type LeadsPageSummary = {
  total: number;
  positive: number;
  avgScore: number | null;
  meetingsRequested: number;
  scheduled: number;
  isRetell: boolean;
  /** Every agent name on a lead, for the agent filter. */
  agentNames: string[];
  /** Agents on booked leads, in order, so badge colours stay the same on every page. */
  bookedAgentNames: string[];
};

export function summarizeLeads(leads: AnyLead[], isWbah: boolean): LeadsPageSummary {
  const withScore = leads.filter((l) => l.lead_score != null);
  const agentNames = new Set<string>();
  const bookedAgentNames: string[] = [];
  for (const l of leads) {
    const name = l.meta?.agent_name;
    if (name) agentNames.add(String(name));
    if (isWbah && hasWbahAppointmentBooked(l)) {
      const booked = wbahBookingAgentName(l);
      if (booked) bookedAgentNames.push(booked);
    }
  }
  return {
    total: leads.length,
    positive: leads.filter((l) => normalizeSentiment(l.sentiment) === "positive").length,
    avgScore: withScore.length
      ? Math.round(withScore.reduce((a, l) => a + Number(l.lead_score), 0) / withScore.length)
      : null,
    meetingsRequested: leads.filter((l) => l.meeting_requested).length,
    scheduled: leads.filter((l) => l.status === "scheduled").length,
    isRetell: leadsAreRetell(leads, isWbah),
    agentNames: [...agentNames],
    bookedAgentNames,
  };
}

export const LEADS_PAGE_SIZES = [10, 25, 50, 100] as const;

export type LeadsPageResult<T = LeadPageRow> = {
  rows: T[];
  /** Leads matching the filters. */
  matching: number;
  page: number;
  pageSize: number;
  summary: LeadsPageSummary;
};

/** Filter, then cut one page. `page` is clamped to the last page. */
export function pageOfLeads<T extends AnyLead>(
  leads: T[],
  filters: LeadsPageFilters,
  opts: { isWbah: boolean; page: number; pageSize: number },
): { rows: T[]; matching: number; page: number; matchingIds: () => string[] } {
  const isRetell = leadsAreRetell(leads, opts.isWbah);
  const filtered = leads.filter((l) =>
    leadMatchesPageFilters(l, filters, { isWbah: opts.isWbah, isRetell }),
  );
  const pageSize = Math.max(1, Math.min(500, Math.floor(opts.pageSize) || 25));
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(Math.max(1, Math.floor(opts.page) || 1), totalPages);
  return {
    rows: filtered.slice((page - 1) * pageSize, page * pageSize),
    matching: filtered.length,
    page,
    matchingIds: () => filtered.map((l) => String(l.id)),
  };
}
