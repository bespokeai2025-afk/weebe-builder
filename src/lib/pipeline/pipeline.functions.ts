import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { cacheWrap } from "@/lib/cache/redis.server";

export type PipelineStage =
  | "lead"
  | "qualified"
  | "contact_made"
  | "second_call"
  | "bookings"
  | "sale_done"
  | "documentation"
  | "follow_up"
  | "dont_call";

export const PIPELINE_STAGES: {
  id: PipelineStage;
  label: string;
  color: string;
}[] = [
  { id: "lead",          label: "Leads",        color: "bg-blue-500" },
  { id: "qualified",     label: "Qualified",     color: "bg-violet-500" },
  { id: "contact_made",  label: "Contact Made",  color: "bg-orange-500" },
  { id: "second_call",   label: "Second Call",   color: "bg-yellow-500" },
  { id: "bookings",      label: "Bookings",      color: "bg-sky-500" },
  { id: "sale_done",     label: "Sale Done",     color: "bg-green-500" },
  { id: "documentation", label: "Documents",     color: "bg-teal-500" },
  { id: "follow_up",     label: "Follow Up",     color: "bg-indigo-500" },
  { id: "dont_call",     label: "Don't Call",    color: "bg-red-500" },
];

// All real lead_status enum values → pipeline stage
export const STATUS_TO_STAGE: Record<string, PipelineStage> = {
  need_to_call:  "lead",
  calling:       "lead",
  interested:    "lead",
  not_connected: "lead",
  qualified:     "qualified",
  completed:     "sale_done",
  not_interested:"dont_call",
  do_not_call:   "dont_call",
};

// Pipeline stage → lead status written back to DB
export const STAGE_TO_STATUS: Record<PipelineStage, string> = {
  lead:          "need_to_call",
  qualified:     "qualified",
  contact_made:  "calling",
  second_call:   "interested",
  bookings:      "interested",
  sale_done:     "completed",
  documentation: "qualified",
  follow_up:     "interested",
  dont_call:     "do_not_call",
};

export type PipelineLead = {
  id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  company_name: string | null;
  status: string | null;
  pipeline_stage: PipelineStage | null;
  effective_stage: PipelineStage;
  // real lead fields
  funding_amount: number | null;
  monthly_revenue: number | null;
  sale_amount: number | null;
  sentiment: "positive" | "neutral" | "negative" | null;
  call_outcome: string | null;
  attempt_count: number | null;
  interest_level: "high" | "medium" | "low" | null;
  last_contacted_at: string | null;
  created_at: string | null;
  source: string | null;
  state_name: string | null;
  // indicator flags
  hasBooking: boolean;
  hasNotes: boolean;
  hasDocuments: boolean;
};

function normalizePhone(p: string) {
  return p.replace(/[\s\-().]/g, "");
}

function mapLead(
  lead: Record<string, unknown>,
  hasPipelineStage: boolean,
  bookedIds: Set<string>,
  notedIds: Set<string>,
  docsPhones: Set<string>,
): PipelineLead {
  const id = lead.id as string;
  const ps = hasPipelineStage
    ? (lead.pipeline_stage as PipelineStage | null)
    : null;
  const effective = (
    ps ?? STATUS_TO_STAGE[lead.status as string] ?? "lead"
  ) as PipelineStage;
  const rawPhone = (lead.phone as string | null) ?? null;
  const normPhone = rawPhone ? normalizePhone(rawPhone) : null;
  return {
    id,
    full_name: (lead.full_name as string | null) ?? null,
    phone: rawPhone,
    email: (lead.email as string | null) ?? null,
    company_name: (lead.company_name as string | null) ?? null,
    status: (lead.status as string | null) ?? null,
    pipeline_stage: ps,
    effective_stage: effective,
    funding_amount: (lead.funding_amount as number | null) ?? null,
    monthly_revenue: (lead.monthly_revenue as number | null) ?? null,
    sale_amount: (lead.sale_amount as number | null) ?? ((lead.meta as any)?.sale_amount as number | null) ?? null,
    sentiment: (lead.sentiment as "positive" | "neutral" | "negative" | null) ?? null,
    call_outcome: (lead.call_outcome as string | null) ?? null,
    attempt_count: (lead.attempt_count as number | null) ?? null,
    interest_level: (lead.interest_level as "high" | "medium" | "low" | null) ?? null,
    last_contacted_at: (lead.last_contacted_at as string | null) ?? null,
    created_at: (lead.created_at as string | null) ?? null,
    source: (lead.source as string | null) ?? null,
    state_name: (lead.state_name as string | null) ?? null,
    hasBooking: bookedIds.has(id),
    hasNotes: notedIds.has(id),
    hasDocuments: normPhone ? docsPhones.has(normPhone) : false,
  };
}

async function fetchIndicators(
  sb: any,
  workspaceId: string,
): Promise<{ bookedIds: Set<string>; notedIds: Set<string>; docsPhones: Set<string> }> {
  const [bookingsRes, notesRes, docsRes] = await Promise.all([
    sb
      .from("calendar_bookings")
      .select("lead_id")
      .eq("workspace_id", workspaceId)
      .not("lead_id", "is", null),
    (supabaseAdmin as any)
      .from("entity_notes")
      .select("entity_id")
      .eq("workspace_id", workspaceId)
      .eq("entity_type", "lead"),
    (supabaseAdmin as any)
      .from("contact_documents")
      .select("contact_id")
      .eq("workspace_id", workspaceId)
      .eq("uploaded_by", "client"),
  ]);

  const bookedIds = new Set<string>(
    ((bookingsRes.data ?? []) as { lead_id: string }[]).map((r) => r.lead_id),
  );
  const notedIds = new Set<string>(
    ((notesRes.data ?? []) as { entity_id: string }[]).map((r) => r.entity_id),
  );

  // Resolve data_record IDs → phone numbers
  const docsPhones = new Set<string>();
  const rawContactIds = (docsRes.data ?? []) as { contact_id: string }[];
  const uniqueContactIds = [...new Set(rawContactIds.map((r) => r.contact_id))];
  if (uniqueContactIds.length > 0) {
    const { data: records } = await (supabaseAdmin as any)
      .from("data_records")
      .select("mobile_number")
      .in("id", uniqueContactIds);
    ((records ?? []) as { mobile_number: string | null }[]).forEach((r) => {
      if (r.mobile_number) docsPhones.add(normalizePhone(r.mobile_number));
    });
  }

  return { bookedIds, notedIds, docsPhones };
}

// ── WBAH pipeline (derived from wbah_calls) ──────────────────────────────────
// WBAH's `leads` table is dup-inflated to ~400k rows, so ordering it breaches the
// DB statement timeout and the pipeline never loads. Instead we derive the board
// from the clean wbah_calls table (one row per contact, latest call) and show
// ONLY qualified/positive contacts (latest-call sentiment === "positive"), which
// matches the dashboard's "Qualified" definition for this workspace.
async function getWbahPipelineLeads(workspaceId: string): Promise<PipelineLead[]> {
  return cacheWrap(`webee:pipeline-leads:${workspaceId}`, 60, async () => {
    const PAGE = 1000;
    const all: any[] = [];
    let from = 0;
    for (;;) {
      const { data, error } = await (supabaseAdmin as any)
        .from("wbah_calls")
        .select(
          "id, customer_name, phone, agent_name, call_status, sentiment, duration_seconds, started_at, appointment_date, booking_status, calendly_booking_url",
        )
        .eq("workspace_id", workspaceId)
        .order("started_at", { ascending: false, nullsFirst: false })
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`DB query failed: ${error.message}`);
      const batch: any[] = data ?? [];
      all.push(...batch);
      if (batch.length < PAGE) break;
      from += PAGE;
    }

    // Dedup per contact (phone). Rows are latest-first, so the first time we
    // see a phone is that contact's most-recent call.
    const seen = new Set<string>();
    const latest: any[] = [];
    for (const c of all) {
      const key = c.phone && String(c.phone).trim() ? String(c.phone).trim() : `id:${c.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      latest.push(c);
    }

    // Pipeline shows only qualified/positive contacts.
    const positive = latest.filter(
      (c) => String(c.sentiment ?? "").toLowerCase() === "positive",
    );

    return positive.map((c): PipelineLead => {
      const startedIso: string | null = c.started_at ?? null;
      const booked = Boolean(
        (c.appointment_date && String(c.appointment_date).trim()) ||
          (c.calendly_booking_url && String(c.calendly_booking_url).trim()),
      );
      return {
        id: c.id,
        full_name: c.customer_name ?? "Unknown",
        phone: c.phone ?? null,
        email: null,
        company_name: null,
        status: "qualified",
        pipeline_stage: null,
        effective_stage: booked ? "bookings" : "qualified",
        funding_amount: null,
        monthly_revenue: null,
        sale_amount: null,
        sentiment: "positive",
        call_outcome: (c.call_status as string | null) ?? null,
        attempt_count: null,
        interest_level: null,
        last_contacted_at: startedIso,
        created_at: startedIso,
        source: null,
        state_name: null,
        hasBooking: booked,
        hasNotes: false,
        hasDocuments: false,
      };
    });
  });
}

export const getPipelineLeads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PipelineLead[]> => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) return [];
    const sb = supabase as any;

    // WBAH reads from wbah_calls (its leads table is too large to order).
    const { data: wsRow } = await sb
      .from("workspaces")
      .select("slug")
      .eq("id", workspaceId)
      .maybeSingle();
    if (wsRow?.slug === "webuyanyhouse") {
      return getWbahPipelineLeads(workspaceId);
    }

    // Standard workspaces read the leads table. select("*") avoids the brittle
    // hard-coded column list — a single missing optional column used to make all
    // fallback tiers fail and break the whole page. mapLead reads fields
    // defensively, so unknown/absent columns are simply ignored.
    const [r1, indicators] = await Promise.all([
      sb
        .from("leads")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(1000),
      fetchIndicators(sb, workspaceId),
    ]);
    if (r1.error) throw new Error(r1.error.message);
    const { bookedIds, notedIds, docsPhones } = indicators;
    const rows = (r1.data ?? []) as Array<Record<string, unknown>>;
    const hasPipelineStage = rows.length > 0 && "pipeline_stage" in rows[0];
    return rows.map((l) =>
      mapLead(l, hasPipelineStage, bookedIds, notedIds, docsPhones),
    );
  });

// ── Lead detail (call summary + booking) ─────────────────────────────────────
export type LeadBooking = {
  id: string;
  title: string;
  start_at: string;
  end_at: string;
  attendee_name: string | null;
  attendee_phone: string | null;
  attendee_email: string | null;
  meeting_url: string | null;
  notes: string | null;
  status: string;
};

export type LeadDetail = {
  callSummary: string | null;
  appointmentBooked: boolean;
  appointmentDate: string | null;
  appointmentReason: string | null;
  booking: LeadBooking | null;
};

export const getLeadDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        leadId: z.string(),
        phone: z.string().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }): Promise<LeadDetail> => {
    const { supabase, workspaceId } = context;
    const empty: LeadDetail = {
      callSummary: null,
      appointmentBooked: false,
      appointmentDate: null,
      appointmentReason: null,
      booking: null,
    };
    if (!workspaceId) return empty;
    const sb = supabase as any;

    // Latest call summary for this lead's phone
    let callSummary: string | null = null;
    let appointmentBooked = false;
    let appointmentDate: string | null = null;
    let appointmentReason: string | null = null;

    if (data.phone) {
      const { data: sd } = await sb
        .from("booking_summaries")
        .select("summary, appointment_booked, appointment_date, appointment_reason")
        .eq("workspace_id", workspaceId)
        .eq("customer_phone", data.phone)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (sd) {
        callSummary = (sd.summary as string | null) ?? null;
        appointmentBooked = Boolean(sd.appointment_booked);
        appointmentDate = (sd.appointment_date as string | null) ?? null;
        appointmentReason = (sd.appointment_reason as string | null) ?? null;
      }
    }

    // Most recent calendar booking for this lead
    const { data: bd } = await sb
      .from("calendar_bookings")
      .select(
        "id, title, start_at, end_at, attendee_name, attendee_phone, attendee_email, meeting_url, notes, status",
      )
      .eq("workspace_id", workspaceId)
      .eq("lead_id", data.leadId)
      .order("start_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    return {
      callSummary,
      appointmentBooked,
      appointmentDate,
      appointmentReason,
      booking: (bd as LeadBooking | null) ?? null,
    };
  });

export const setSaleDoneAmount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ leadId: z.string(), amount: z.number().nonnegative() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const sb = supabase as any;
    const { error } = await sb
      .from("leads")
      .update({ sale_amount: data.amount, updated_at: new Date().toISOString() })
      .eq("id", data.leadId)
      .eq("workspace_id", workspaceId);
    if (error) {
      const isMissingCol =
        String(error.message).toLowerCase().includes("sale_amount") ||
        String(error.code) === "42703";
      if (!isMissingCol) throw new Error(error.message);
      // Column not yet migrated — persist in meta JSON as fallback
      const { data: row } = await sb
        .from("leads")
        .select("meta")
        .eq("id", data.leadId)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      const newMeta = { ...(row?.meta ?? {}), sale_amount: data.amount };
      const { error: metaErr } = await sb
        .from("leads")
        .update({ meta: newMeta, updated_at: new Date().toISOString() })
        .eq("id", data.leadId)
        .eq("workspace_id", workspaceId);
      if (metaErr) throw new Error(metaErr.message);
    }
    return { ok: true };
  });

export const setLeadPipelineStage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ leadId: z.string(), stage: z.string() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const sb = supabase as any;
    const stage = data.stage as PipelineStage;
    const newStatus = STAGE_TO_STATUS[stage] ?? "need_to_call";
    const { error } = await sb
      .from("leads")
      .update({
        pipeline_stage: stage,
        status: newStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.leadId)
      .eq("workspace_id", workspaceId);
    if (error) {
      const isMissingCol =
        String(error.message).toLowerCase().includes("pipeline_stage") ||
        String(error.code) === "42703";
      if (!isMissingCol) throw new Error(error.message);
      // pipeline_stage column not yet migrated — still update status so the
      // leads section reflects the move (e.g. "Don't Call" → do_not_call)
      const { error: statusErr } = await sb
        .from("leads")
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq("id", data.leadId)
        .eq("workspace_id", workspaceId);
      if (statusErr) throw new Error(statusErr.message);
    }
    return { ok: true };
  });
