/**
 * BuzzChat Campaign Leads — list, qualify, export.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertNotWbahWorkspace } from "@/lib/wbah-exclusion.shared";
import { resolvePermissions } from "@/lib/permissions/permissions.server";
import { areaFromPropertyMeta } from "@/lib/whatsapp/inbox-campaign-org.shared";
import {
  CAMPAIGN_LEAD_STAGES,
  formatCampaignRequirement,
  listingOutcomePromotesToSalesPipeline,
  listingOutcomeToLeadStatus,
  LISTING_OUTCOMES,
  propertyLabelFromMeta,
  readCampaignQualification,
  readListingOutcome,
  readListingStage,
  writeListingStage,
  writeCampaignQualification,
  writeListingOutcome,
  type CampaignIntent,
  type CampaignLeadStage,
  type CampaignQualification,
  type ListingOutcome,
} from "@/lib/whatsapp/campaign-leads.shared";

const qualificationSchema = z.object({
  intent: z.enum(["sell", "rent", "both", ""]).default(""),
  asking_price: z.string().max(80).default(""),
  rental_price: z.string().max(80).default(""),
  availability: z.string().max(120).default(""),
  property_status: z.string().max(120).default(""),
  viewing_availability: z.string().max(120).default(""),
  notes: z.string().max(2000).default(""),
});

export type CampaignLeadRow = {
  id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  property: string;
  area: string;
  requirement: string;
  qualification: CampaignQualification;
  stage: CampaignLeadStage | string | null;
  listing_outcome: ListingOutcome | null;
  assigned_to: string | null;
  assigned_name: string | null;
  last_contacted_at: string | null;
  last_reply_at: string | null;
  has_buzzchat_reply: boolean;
  source: string | null;
  created_at: string | null;
};

function csvEscape(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

async function memberNames(
  sb: any,
  userIds: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const { data } = await sb
    .from("profiles")
    .select("user_id, full_name, email")
    .in("user_id", unique);
  const map = new Map<string, string>();
  for (const p of data ?? []) {
    map.set(p.user_id, p.full_name || p.email || p.user_id);
  }
  return map;
}

function mapRow(
  lead: Record<string, unknown>,
  names: Map<string, string>,
): CampaignLeadRow {
  const meta = (lead.meta as Record<string, unknown> | null) ?? {};
  const qualification = readCampaignQualification(meta);
  const assignedTo = (lead.assigned_to as string | null) ?? null;
  return {
    id: lead.id as string,
    full_name: (lead.full_name as string | null) ?? null,
    phone: (lead.phone as string | null) ?? null,
    email: (lead.email as string | null) ?? null,
    property: propertyLabelFromMeta(meta),
    area: areaFromPropertyMeta(meta),
    requirement: formatCampaignRequirement(qualification) || String(meta.Requirement ?? ""),
    qualification,
    stage: readListingStage(meta, lead.pipeline_stage as string | null),
    listing_outcome: readListingOutcome(meta)?.status ?? null,
    assigned_to: assignedTo,
    assigned_name: assignedTo ? names.get(assignedTo) ?? null : null,
    last_contacted_at: (lead.last_contacted_at as string | null) ?? null,
    last_reply_at: (lead.last_buzzchat_reply_at as string | null) ?? null,
    has_buzzchat_reply: Boolean(lead.has_buzzchat_reply),
    source: (lead.source as string | null) ?? (lead.lead_origin as string | null) ?? null,
    created_at: (lead.created_at as string | null) ?? null,
  };
}

export const listCampaignLeads = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        search: z.string().trim().max(120).optional(),
        stage: z.enum(CAMPAIGN_LEAD_STAGES).optional(),
        outcome: z.enum(LISTING_OUTCOMES).optional(),
        assignedTo: z.string().uuid().optional(),
        unassigned: z.boolean().optional(),
        limit: z.number().int().min(1).max(500).optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ context, data }): Promise<{ leads: CampaignLeadRow[]; total: number }> => {
    const { supabase, workspaceId, userId } = context;
    if (!workspaceId) return { leads: [], total: 0 };
    assertNotWbahWorkspace(workspaceId);
    const sb = supabase as any;
    const perms = await resolvePermissions(workspaceId, userId);
    const limit = data.limit ?? 200;

    let q = sb
      .from("leads")
      .select(
        "id, full_name, phone, email, notes, meta, pipeline_stage, assigned_to, last_contacted_at, last_buzzchat_reply_at, has_buzzchat_reply, lead_origin, source, created_at",
        { count: "exact" },
      )
      .eq("workspace_id", workspaceId)
      .or("has_buzzchat_reply.eq.true,lead_origin.in.(csv_import,whatsapp)")
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (perms.assignedRecordsOnly) q = q.eq("assigned_to", userId);
    if (data.stage) {
      q = q.or(`pipeline_stage.eq.${data.stage},meta->>listing_stage.eq.${data.stage}`);
    }
    if (data.unassigned) q = q.is("assigned_to", null);
    else if (data.assignedTo) q = q.eq("assigned_to", data.assignedTo);
    if (data.outcome) {
      q = q.filter("meta->listing_outcome->>status", "eq", data.outcome);
    }
    if (data.search) {
      const term = data.search.replace(/[%,()*\\]/g, "").trim();
      if (term) {
        q = q.or(`full_name.ilike.%${term}%,phone.ilike.%${term}%,email.ilike.%${term}%`);
      }
    }

    const { data: rows, error, count } = await q;
    if (error) throw new Error(error.message);

    const names = await memberNames(
      sb,
      ((rows ?? []) as Array<{ assigned_to?: string | null }>).map((r) => r.assigned_to ?? ""),
    );
    return {
      leads: ((rows ?? []) as Record<string, unknown>[]).map((row) => mapRow(row, names)),
      total: count ?? 0,
    };
  });

export const updateCampaignLeadStage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        leadId: z.string().min(1),
        stage: z.enum(CAMPAIGN_LEAD_STAGES),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId, userId } = context;
    if (!workspaceId) throw new Error("No workspace");
    assertNotWbahWorkspace(workspaceId);
    const sb = supabase as any;
    const perms = await resolvePermissions(workspaceId, userId);

    let sel = sb
      .from("leads")
      .select("id, meta, pipeline_stage")
      .eq("id", data.leadId)
      .eq("workspace_id", workspaceId);
    if (perms.assignedRecordsOnly) sel = sel.eq("assigned_to", userId);
    const { data: lead, error: loadErr } = await sel.maybeSingle();
    if (loadErr) throw new Error(loadErr.message);
    if (!lead) throw new Error("Lead not found");

    const meta = writeListingStage(
      (lead.meta as Record<string, unknown> | null) ?? {},
      data.stage,
    );
    const patch: Record<string, unknown> = {
      meta,
      updated_at: new Date().toISOString(),
    };
    if (data.stage === "converted") patch.pipeline_stage = "sale_done";
    else if (readListingStage(lead.meta as Record<string, unknown> | null, lead.pipeline_stage) === "converted") {
      patch.pipeline_stage = null;
    }

    let q = sb.from("leads").update(patch).eq("id", data.leadId).eq("workspace_id", workspaceId);
    if (perms.assignedRecordsOnly) q = q.eq("assigned_to", userId);
    const { error } = await q;
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateListingOutcome = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        leadId: z.string().min(1),
        outcome: z.enum(LISTING_OUTCOMES),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId, userId } = context;
    if (!workspaceId) throw new Error("No workspace");
    assertNotWbahWorkspace(workspaceId);
    const sb = supabase as any;
    const perms = await resolvePermissions(workspaceId, userId);

    let sel = sb
      .from("leads")
      .select("id, meta, pipeline_stage")
      .eq("id", data.leadId)
      .eq("workspace_id", workspaceId);
    if (perms.assignedRecordsOnly) sel = sel.eq("assigned_to", userId);
    const { data: lead, error: loadErr } = await sel.maybeSingle();
    if (loadErr) throw new Error(loadErr.message);
    if (!lead) throw new Error("Lead not found");

    const outcome = {
      status: data.outcome as ListingOutcome,
      at: new Date().toISOString(),
      by: userId ?? null,
    };
    const meta = writeListingOutcome(
      (lead.meta as Record<string, unknown> | null) ?? {},
      outcome,
    );
    const patch: Record<string, unknown> = {
      meta,
      updated_at: new Date().toISOString(),
    };
    const leadStatus = listingOutcomeToLeadStatus(data.outcome);
    if (leadStatus) patch.status = leadStatus;
    if (listingOutcomePromotesToSalesPipeline(data.outcome)) {
      patch.pipeline_stage = "sale_done";
    } else if (lead.pipeline_stage === "sale_done" || lead.pipeline_stage === "new_response") {
      patch.pipeline_stage = null;
    }

    let q = sb.from("leads").update(patch).eq("id", data.leadId).eq("workspace_id", workspaceId);
    if (perms.assignedRecordsOnly) q = q.eq("assigned_to", userId);
    const { error } = await q;
    if (error) throw new Error(error.message);
    return { ok: true, outcome: data.outcome };
  });

export const updateCampaignQualification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        leadId: z.string().min(1),
        qualification: qualificationSchema,
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId, userId } = context;
    if (!workspaceId) throw new Error("No workspace");
    assertNotWbahWorkspace(workspaceId);
    const sb = supabase as any;
    const perms = await resolvePermissions(workspaceId, userId);

    let sel = sb
      .from("leads")
      .select("id, meta")
      .eq("id", data.leadId)
      .eq("workspace_id", workspaceId);
    if (perms.assignedRecordsOnly) sel = sel.eq("assigned_to", userId);
    const { data: lead, error: loadErr } = await sel.maybeSingle();
    if (loadErr) throw new Error(loadErr.message);
    if (!lead) throw new Error("Lead not found");

    const qualification: CampaignQualification = {
      intent: data.qualification.intent as CampaignIntent,
      asking_price: data.qualification.asking_price,
      rental_price: data.qualification.rental_price,
      availability: data.qualification.availability,
      property_status: data.qualification.property_status,
      viewing_availability: data.qualification.viewing_availability,
      notes: data.qualification.notes,
    };
    const meta = writeCampaignQualification(
      (lead.meta as Record<string, unknown> | null) ?? {},
      qualification,
    );
    const { error } = await sb
      .from("leads")
      .update({ meta, updated_at: new Date().toISOString() })
      .eq("id", data.leadId)
      .eq("workspace_id", workspaceId);
    if (error) throw new Error(error.message);
    return { ok: true, qualification };
  });

export const exportCampaignLeadsCsv = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        search: z.string().trim().max(120).optional(),
        stage: z.enum(CAMPAIGN_LEAD_STAGES).optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId, userId } = context;
    if (!workspaceId) throw new Error("No workspace");
    assertNotWbahWorkspace(workspaceId);
    const sb = supabase as any;
    const perms = await resolvePermissions(workspaceId, userId);
    let q = sb
      .from("leads")
      .select(
        "id, full_name, phone, email, meta, pipeline_stage, assigned_to, last_contacted_at, last_buzzchat_reply_at, has_buzzchat_reply, lead_origin, source, created_at",
      )
      .eq("workspace_id", workspaceId)
      .or("has_buzzchat_reply.eq.true,lead_origin.in.(csv_import,whatsapp)")
      .order("updated_at", { ascending: false })
      .limit(500);
    if (perms.assignedRecordsOnly) q = q.eq("assigned_to", userId);
    if (data.stage) q = q.eq("pipeline_stage", data.stage);
    if (data.search) {
      const term = data.search.replace(/[%,()*\\]/g, "").trim();
      if (term) q = q.or(`full_name.ilike.%${term}%,phone.ilike.%${term}%,email.ilike.%${term}%`);
    }
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    const names = await memberNames(
      sb,
      ((rows ?? []) as Array<{ assigned_to?: string | null }>).map((r) => r.assigned_to ?? ""),
    );
    const leads = ((rows ?? []) as Record<string, unknown>[]).map((row) => mapRow(row, names));
    const header = [
      "owner",
      "phone",
      "email",
      "property",
      "requirement",
      "intent",
      "asking_price",
      "rental_price",
      "status",
      "agent",
      "last_contacted_at",
      "last_reply_at",
      "source",
    ].join(",");
    const csv = [
      header,
      ...leads.map((l) =>
        [
          csvEscape(l.full_name),
          csvEscape(l.phone),
          csvEscape(l.email),
          csvEscape(l.property),
          csvEscape(l.requirement),
          csvEscape(l.qualification.intent),
          csvEscape(l.qualification.asking_price),
          csvEscape(l.qualification.rental_price),
          csvEscape(l.stage),
          csvEscape(l.assigned_name),
          csvEscape(l.last_contacted_at),
          csvEscape(l.last_reply_at),
          csvEscape(l.source),
        ].join(","),
      ),
    ].join("\n");
    return { csv, count: leads.length };
  });
