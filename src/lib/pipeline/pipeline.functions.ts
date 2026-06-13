import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type PipelineStage =
  | "lead"
  | "qualified"
  | "contact_made"
  | "second_call"
  | "sale_done"
  | "documentation"
  | "follow_up"
  | "dont_call";

export const PIPELINE_STAGES: { id: PipelineStage; label: string; color: string }[] = [
  { id: "lead",          label: "Leads",          color: "bg-blue-500" },
  { id: "qualified",     label: "Qualified",       color: "bg-violet-500" },
  { id: "contact_made",  label: "Contact Made",    color: "bg-orange-500" },
  { id: "second_call",   label: "Second Call",     color: "bg-yellow-500" },
  { id: "sale_done",     label: "Sale Done",       color: "bg-green-500" },
  { id: "documentation", label: "Documentation",   color: "bg-teal-500" },
  { id: "follow_up",     label: "Follow Up",       color: "bg-indigo-500" },
  { id: "dont_call",     label: "Don't Call",      color: "bg-red-500" },
];

export const STATUS_TO_STAGE: Record<string, PipelineStage> = {
  need_to_call:       "lead",
  no_answer:          "lead",
  interested:         "lead",
  calling:            "lead",
  qualified:          "qualified",
  callback_requested: "contact_made",
  completed:          "sale_done",
  not_interested:     "dont_call",
  scheduled:          "follow_up",
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
  lead_score: number | null;
  interest_level: string | null;
  last_contacted_at: string | null;
  created_at: string | null;
  migrationNeeded?: boolean;
};

function mapLead(lead: Record<string, unknown>, hasPipelineStage: boolean): PipelineLead {
  const ps = hasPipelineStage ? (lead.pipeline_stage as PipelineStage | null) : null;
  const effective =
    (ps ?? STATUS_TO_STAGE[lead.status as string] ?? "lead") as PipelineStage;
  return {
    id: lead.id as string,
    full_name: (lead.full_name as string | null) ?? null,
    phone: (lead.phone as string | null) ?? null,
    email: (lead.email as string | null) ?? null,
    company_name: (lead.company_name as string | null) ?? null,
    status: (lead.status as string | null) ?? null,
    pipeline_stage: ps,
    effective_stage: effective,
    lead_score: (lead.lead_score as number | null) ?? null,
    interest_level: (lead.interest_level as string | null) ?? null,
    last_contacted_at: (lead.last_contacted_at as string | null) ?? null,
    created_at: (lead.created_at as string | null) ?? null,
  };
}

const BASE_SELECT =
  "id, full_name, phone, email, company_name, status, lead_score, interest_level, last_contacted_at, created_at";

export const getPipelineLeads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PipelineLead[]> => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) return [];
    const sb = supabase as any;

    // Try with pipeline_stage first; fall back without it if the migration
    // hasn't been applied yet (column doesn't exist → PostgREST 42703 error).
    const { data: d1, error: e1 } = await sb
      .from("leads")
      .select(`${BASE_SELECT}, pipeline_stage`)
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });

    if (!e1) {
      return ((d1 ?? []) as Array<Record<string, unknown>>).map((l) =>
        mapLead(l, true),
      );
    }

    // Column not found — try without pipeline_stage
    const isColumnError =
      String(e1.message).toLowerCase().includes("pipeline_stage") ||
      String(e1.code) === "42703" ||
      String(e1.message).toLowerCase().includes("column");

    if (!isColumnError) throw new Error(e1.message);

    const { data: d2, error: e2 } = await sb
      .from("leads")
      .select(BASE_SELECT)
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });

    if (e2) throw new Error(e2.message);

    return ((d2 ?? []) as Array<Record<string, unknown>>).map((l) =>
      mapLead(l, false),
    );
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
    const { error } = await sb
      .from("leads")
      .update({ pipeline_stage: data.stage, updated_at: new Date().toISOString() })
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
