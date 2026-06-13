import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

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
};

const BASE_SELECT = [
  "id",
  "full_name",
  "phone",
  "email",
  "company_name",
  "status",
  "funding_amount",
  "monthly_revenue",
  "sale_amount",
  "sentiment",
  "call_outcome",
  "attempt_count",
  "interest_level",
  "last_contacted_at",
  "created_at",
  "source",
  "state_name",
].join(", ");

function mapLead(
  lead: Record<string, unknown>,
  hasPipelineStage: boolean,
  bookedIds: Set<string>,
  notedIds: Set<string>,
): PipelineLead {
  const id = lead.id as string;
  const ps = hasPipelineStage
    ? (lead.pipeline_stage as PipelineStage | null)
    : null;
  const effective = (
    ps ?? STATUS_TO_STAGE[lead.status as string] ?? "lead"
  ) as PipelineStage;
  return {
    id,
    full_name: (lead.full_name as string | null) ?? null,
    phone: (lead.phone as string | null) ?? null,
    email: (lead.email as string | null) ?? null,
    company_name: (lead.company_name as string | null) ?? null,
    status: (lead.status as string | null) ?? null,
    pipeline_stage: ps,
    effective_stage: effective,
    funding_amount: (lead.funding_amount as number | null) ?? null,
    monthly_revenue: (lead.monthly_revenue as number | null) ?? null,
    sale_amount: (lead.sale_amount as number | null) ?? null,
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
  };
}

async function fetchIndicators(
  sb: any,
  workspaceId: string,
): Promise<{ bookedIds: Set<string>; notedIds: Set<string> }> {
  const [bookingsRes, notesRes] = await Promise.all([
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
  ]);
  const bookedIds = new Set<string>(
    ((bookingsRes.data ?? []) as { lead_id: string }[]).map((r) => r.lead_id),
  );
  const notedIds = new Set<string>(
    ((notesRes.data ?? []) as { entity_id: string }[]).map((r) => r.entity_id),
  );
  return { bookedIds, notedIds };
}

export const getPipelineLeads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PipelineLead[]> => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) return [];
    const sb = supabase as any;

    // Fetch leads + indicators in parallel
    const [leadsResult, indicators] = await Promise.all([
      sb
        .from("leads")
        .select(`${BASE_SELECT}, pipeline_stage`)
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false }),
      fetchIndicators(sb, workspaceId),
    ]);

    const { bookedIds, notedIds } = indicators;

    if (!leadsResult.error) {
      return ((leadsResult.data ?? []) as Array<Record<string, unknown>>).map(
        (l) => mapLead(l, true, bookedIds, notedIds),
      );
    }

    const isColumnError =
      String(leadsResult.error.message).toLowerCase().includes("pipeline_stage") ||
      String(leadsResult.error.code) === "42703";

    if (!isColumnError) throw new Error(leadsResult.error.message);

    const { data: d2, error: e2 } = await sb
      .from("leads")
      .select(BASE_SELECT)
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });

    if (e2) throw new Error(e2.message);
    return ((d2 ?? []) as Array<Record<string, unknown>>).map((l) =>
      mapLead(l, false, bookedIds, notedIds),
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
      if (
        String(error.message).toLowerCase().includes("sale_amount") ||
        String(error.code) === "42703"
      ) {
        throw new Error(
          "MIGRATION_NEEDED: Apply supabase/migrations/20260613180000_sale_amount.sql in your Supabase Dashboard.",
        );
      }
      throw new Error(error.message);
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
      if (
        String(error.message).toLowerCase().includes("pipeline_stage") ||
        String(error.code) === "42703"
      ) {
        throw new Error(
          "MIGRATION_NEEDED: Apply supabase/migrations/20260613160000_pipeline_stage.sql in your Supabase Dashboard to persist stage changes.",
        );
      }
      throw new Error(error.message);
    }
    return { ok: true };
  });
