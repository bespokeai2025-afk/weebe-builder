/**
 * BuzzChat Campaign Leads — list, qualify, export.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertNotWbahWorkspace } from "@/lib/wbah-exclusion.shared";
import { resolvePermissions } from "@/lib/permissions/permissions.server";
import { areaFromPropertyMeta } from "@/lib/whatsapp/inbox-campaign-org.shared";
import { fetchWorkspaceMessageStatsMaps, lookupWaContactMessageStats } from "@/lib/whatsapp/wa-contact-message-stats.server";
import {
  CAMPAIGN_LEAD_STAGES,
  LISTING_PIPELINE_STAGES,
  formatCampaignRequirement,
  daysInListingPipelineStage,
  propertyLabelFromMeta,
  readCampaignFollowUp,
  readCampaignQualification,
  readListingPipeline,
  readListingStage,
  startListingPipeline,
  writeListingPipelineOffer,
  writeListingPipelineStage,
  writeListingStage,
  writeCampaignFollowUp,
  writeCampaignQualification,
  type CampaignFollowUp,
  type CampaignIntent,
  type CampaignLeadStage,
  type CampaignQualification,
  type ListingOutcome,
  type ListingPipelineStage,
} from "@/lib/whatsapp/campaign-leads.shared";
import {
  campaignOutcomePromotesToPipeline,
  campaignOutcomeToLeadStatus,
  formatOffPlanRequirement,
  formatSecondaryRequirement,
  isValidOutcomeForCampaignType,
  readCampaignOutcome,
  readOffPlanQualification,
  readSecondaryQualification,
  writeCampaignOutcome,
  writeOffPlanQualification,
  writeSecondaryQualification,
  type BuyerOutcome,
  type CampaignOutcome,
  type CampaignType,
  type OffPlanQualification,
  type SecondaryQualification,
} from "@/lib/whatsapp/campaign-types.shared";

const qualificationSchema = z.object({
  intent: z.enum(["sell", "rent", "both", ""]).default(""),
  asking_price: z.string().max(80).default(""),
  rental_price: z.string().max(80).default(""),
  availability: z.string().max(120).default(""),
  property_status: z.string().max(120).default(""),
  viewing_availability: z.string().max(120).default(""),
  notes: z.string().max(2000).default(""),
});

const offPlanQualificationSchema = z.object({
  budget: z.string().max(80).default(""),
  preferred_area_project: z.string().max(120).default(""),
  developer_project: z.string().max(120).default(""),
  unit_type_size: z.string().max(120).default(""),
  investment_or_end_use: z.string().max(120).default(""),
  cash_or_financing: z.string().max(120).default(""),
  preferred_payment_plan: z.string().max(120).default(""),
  purchase_timeline: z.string().max(120).default(""),
  specific_requirements: z.string().max(2000).default(""),
});

const secondaryQualificationSchema = z.object({
  budget: z.string().max(80).default(""),
  preferred_area_community: z.string().max(120).default(""),
  property_type: z.string().max(120).default(""),
  bedrooms_size: z.string().max(120).default(""),
  cash_or_mortgage: z.string().max(120).default(""),
  ready_to_move_or_investment: z.string().max(120).default(""),
  purchase_timeline: z.string().max(120).default(""),
  specific_requirements: z.string().max(2000).default(""),
  existing_property_preference: z.string().max(120).default(""),
});

export type CampaignLeadRow = {
  id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  property: string;
  area: string;
  requirement: string;
  campaign_type: CampaignType;
  campaign_id: string | null;
  campaign_name: string | null;
  qualification: CampaignQualification;
  off_plan_qualification: OffPlanQualification | null;
  secondary_qualification: SecondaryQualification | null;
  stage: CampaignLeadStage | string | null;
  listing_outcome: ListingOutcome | null;
  buyer_outcome: BuyerOutcome | null;
  outcome_reason: string | null;
  follow_up: CampaignFollowUp;
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
  campaignType: CampaignType,
  campaignId: string | null = null,
  campaignName: string | null = null,
): CampaignLeadRow {
  const meta = (lead.meta as Record<string, unknown> | null) ?? {};
  const qualification = readCampaignQualification(meta);
  const offPlanQualification = campaignType === "off_plan" ? readOffPlanQualification(meta) : null;
  const secondaryQualification = campaignType === "secondary" ? readSecondaryQualification(meta) : null;
  const outcomeRecord = readCampaignOutcome(campaignType, meta);
  const outcome = outcomeRecord?.status ?? null;
  const assignedTo = (lead.assigned_to as string | null) ?? null;

  let requirement = "";
  if (campaignType === "off_plan" && offPlanQualification) {
    requirement = formatOffPlanRequirement(offPlanQualification);
  } else if (campaignType === "secondary" && secondaryQualification) {
    requirement = formatSecondaryRequirement(secondaryQualification);
  } else {
    requirement = formatCampaignRequirement(qualification) || String(meta.Requirement ?? "");
  }

  return {
    id: lead.id as string,
    full_name: (lead.full_name as string | null) ?? null,
    phone: (lead.phone as string | null) ?? null,
    email: (lead.email as string | null) ?? null,
    property: propertyLabelFromMeta(meta),
    area: areaFromPropertyMeta(meta),
    requirement,
    campaign_type: campaignType,
    campaign_id: campaignId,
    campaign_name: campaignName,
    qualification,
    off_plan_qualification: offPlanQualification,
    secondary_qualification: secondaryQualification,
    stage: readListingStage(meta, lead.pipeline_stage as string | null),
    listing_outcome: campaignType === "listing_acquisition" ? (outcome as ListingOutcome | null) : null,
    buyer_outcome: campaignType !== "listing_acquisition" ? (outcome as BuyerOutcome | null) : null,
    outcome_reason: outcomeRecord?.reason ?? null,
    follow_up: readCampaignFollowUp(meta),
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
        // Not a fixed z.enum(LISTING_OUTCOMES) — outcome vocabulary depends on
        // the lead's own campaign_type (buyer outcomes differ from listing
        // ones); the DB filter is a plain string match either way.
        outcome: z.string().max(60).optional(),
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
    const { byExact, byTail } = await fetchWorkspaceMessageStatsMaps(sb, workspaceId);
    return {
      leads: ((rows ?? []) as Record<string, unknown>[]).map((row) => {
        const stats = lookupWaContactMessageStats(row.phone as string | null, byExact, byTail);
        return mapRow(row, names, stats.last_campaign_type, stats.last_campaign_id, stats.last_campaign_name);
      }),
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

    let meta = writeListingStage(
      (lead.meta as Record<string, unknown> | null) ?? {},
      data.stage,
    );
    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (data.stage === "converted") {
      patch.pipeline_stage = "sale_done";
      // Setting the Stage to Converted is now the trigger for entering the
      // Listing Pipeline board (Agreed → ... → Closed), same as the
      // "Converted" remark used to do before the remark list was simplified.
      meta = startListingPipeline(meta);
    } else if (readListingStage(lead.meta as Record<string, unknown> | null, lead.pipeline_stage) === "converted") {
      patch.pipeline_stage = null;
    }
    patch.meta = meta;

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
        // Vocabulary depends on the lead's own campaign_type — validated
        // against the resolved type inside the handler, once the lead (and
        // therefore its phone/campaign) is known.
        outcome: z.string().min(1).max(60),
        // Optional free-text remark alongside the outcome (e.g. why "Not interested").
        reason: z.string().max(500).nullable().optional(),
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
      .select("id, meta, pipeline_stage, phone")
      .eq("id", data.leadId)
      .eq("workspace_id", workspaceId);
    if (perms.assignedRecordsOnly) sel = sel.eq("assigned_to", userId);
    const { data: lead, error: loadErr } = await sel.maybeSingle();
    if (loadErr) throw new Error(loadErr.message);
    if (!lead) throw new Error("Lead not found");

    const { byExact, byTail } = await fetchWorkspaceMessageStatsMaps(sb, workspaceId);
    const campaignType = lookupWaContactMessageStats(lead.phone, byExact, byTail).last_campaign_type;
    if (!isValidOutcomeForCampaignType(campaignType, data.outcome)) {
      throw new Error(
        `"${data.outcome}" is not a valid outcome for a ${campaignType} campaign lead.`,
      );
    }
    const outcomeValue = data.outcome as CampaignOutcome;

    const outcome = {
      status: outcomeValue,
      at: new Date().toISOString(),
      by: userId ?? null,
      reason: data.reason?.trim() || null,
    };
    let meta = writeCampaignOutcome(
      campaignType,
      (lead.meta as Record<string, unknown> | null) ?? {},
      outcome,
    );
    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    const leadStatus = campaignOutcomeToLeadStatus(campaignType, outcomeValue);
    if (leadStatus) patch.status = leadStatus;
    if (campaignOutcomePromotesToPipeline(campaignType, outcomeValue)) {
      patch.pipeline_stage = "sale_done";
      // "Client agrees to list, that is the Lead that moves to pipeline" —
      // the Listing Pipeline board (Agreed → ... → Closed) starts here, once,
      // for Listing Acquisition specifically.
      if (campaignType === "listing_acquisition") {
        meta = startListingPipeline(meta);
      }
    } else if (lead.pipeline_stage === "sale_done" || lead.pipeline_stage === "new_response") {
      patch.pipeline_stage = null;
    }
    patch.meta = meta;

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
        // Loose string map here — parsed against the schema matching the
        // lead's resolved campaign_type inside the handler (listing / off-plan
        // / secondary each have a different qualification shape).
        qualification: z.record(z.string(), z.string()).default({}),
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
      .select("id, meta, phone")
      .eq("id", data.leadId)
      .eq("workspace_id", workspaceId);
    if (perms.assignedRecordsOnly) sel = sel.eq("assigned_to", userId);
    const { data: lead, error: loadErr } = await sel.maybeSingle();
    if (loadErr) throw new Error(loadErr.message);
    if (!lead) throw new Error("Lead not found");

    const { byExact, byTail } = await fetchWorkspaceMessageStatsMaps(sb, workspaceId);
    const campaignType = lookupWaContactMessageStats(lead.phone, byExact, byTail).last_campaign_type;
    const existingMeta = (lead.meta as Record<string, unknown> | null) ?? {};

    let meta: Record<string, unknown>;
    let qualification: CampaignQualification | OffPlanQualification | SecondaryQualification;
    if (campaignType === "off_plan") {
      qualification = offPlanQualificationSchema.parse(data.qualification);
      meta = writeOffPlanQualification(existingMeta, qualification);
    } else if (campaignType === "secondary") {
      qualification = secondaryQualificationSchema.parse(data.qualification);
      meta = writeSecondaryQualification(existingMeta, qualification);
    } else {
      const parsed = qualificationSchema.parse(data.qualification);
      qualification = { ...parsed, intent: parsed.intent as CampaignIntent };
      meta = writeCampaignQualification(existingMeta, qualification);
    }

    const { error } = await sb
      .from("leads")
      .update({ meta, updated_at: new Date().toISOString() })
      .eq("id", data.leadId)
      .eq("workspace_id", workspaceId);
    if (error) throw new Error(error.message);
    return { ok: true, qualification };
  });

export const updateCampaignFollowUp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        leadId: z.string().min(1),
        date: z.string().max(40).nullable(),
        nextAction: z.string().max(500).default(""),
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

    const followUp: CampaignFollowUp = { date: data.date, nextAction: data.nextAction };
    const meta = writeCampaignFollowUp((lead.meta as Record<string, unknown> | null) ?? {}, followUp);

    const { error } = await sb
      .from("leads")
      .update({ meta, updated_at: new Date().toISOString() })
      .eq("id", data.leadId)
      .eq("workspace_id", workspaceId);
    if (error) throw new Error(error.message);
    return { ok: true, followUp };
  });

// ─── Listing Pipeline — second stage after a listing converts ─────────────
// Spec: "WHAT MANAGEMENT SHOULD SEE: Property, Owner, Agent, Stage, Days in
// stage, Last activity, Next action, Asking price, Offer, Final outcome."

export type ListingPipelineLeadRow = {
  id: string;
  full_name: string | null;
  phone: string | null;
  property: string;
  area: string;
  askingPrice: string;
  stage: ListingPipelineStage;
  daysInStage: number;
  offerAmount: string;
  assigned_to: string | null;
  assigned_name: string | null;
  last_contacted_at: string | null;
  nextAction: string;
  followUpDate: string | null;
};

function mapListingPipelineRow(
  lead: Record<string, unknown>,
  names: Map<string, string>,
): ListingPipelineLeadRow | null {
  const meta = (lead.meta as Record<string, unknown> | null) ?? {};
  const pipeline = readListingPipeline(meta);
  if (!pipeline) return null;
  const qualification = readCampaignQualification(meta);
  const followUp = readCampaignFollowUp(meta);
  const assignedTo = (lead.assigned_to as string | null) ?? null;
  return {
    id: lead.id as string,
    full_name: (lead.full_name as string | null) ?? null,
    phone: (lead.phone as string | null) ?? null,
    property: propertyLabelFromMeta(meta),
    area: areaFromPropertyMeta(meta),
    askingPrice: qualification.asking_price,
    stage: pipeline.stage,
    daysInStage: daysInListingPipelineStage(pipeline.enteredAt),
    offerAmount: pipeline.offerAmount,
    assigned_to: assignedTo,
    assigned_name: assignedTo ? names.get(assignedTo) ?? null : null,
    last_contacted_at: (lead.last_contacted_at as string | null) ?? null,
    nextAction: followUp.nextAction,
    followUpDate: followUp.date,
  };
}

export const listListingPipelineLeads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ leads: ListingPipelineLeadRow[] }> => {
    const { supabase, workspaceId, userId } = context;
    if (!workspaceId) return { leads: [] };
    assertNotWbahWorkspace(workspaceId);
    const sb = supabase as any;
    const perms = await resolvePermissions(workspaceId, userId);

    let q = sb
      .from("leads")
      .select("id, full_name, phone, meta, assigned_to, last_contacted_at")
      .eq("workspace_id", workspaceId)
      .not("meta->listing_pipeline->>stage", "is", null)
      .order("updated_at", { ascending: false })
      .limit(500);
    if (perms.assignedRecordsOnly) q = q.eq("assigned_to", userId);

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const names = await memberNames(
      sb,
      ((rows ?? []) as Array<{ assigned_to?: string | null }>).map((r) => r.assigned_to ?? ""),
    );
    const leads = ((rows ?? []) as Record<string, unknown>[])
      .map((row) => mapListingPipelineRow(row, names))
      .filter(Boolean) as ListingPipelineLeadRow[];
    return { leads };
  });

export const updateListingPipelineStage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        leadId: z.string().min(1),
        stage: z.enum(LISTING_PIPELINE_STAGES),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId, userId } = context;
    if (!workspaceId) throw new Error("No workspace");
    assertNotWbahWorkspace(workspaceId);
    const sb = supabase as any;
    const perms = await resolvePermissions(workspaceId, userId);

    let sel = sb.from("leads").select("id, meta").eq("id", data.leadId).eq("workspace_id", workspaceId);
    if (perms.assignedRecordsOnly) sel = sel.eq("assigned_to", userId);
    const { data: lead, error: loadErr } = await sel.maybeSingle();
    if (loadErr) throw new Error(loadErr.message);
    if (!lead) throw new Error("Lead not found");

    const meta = writeListingPipelineStage((lead.meta as Record<string, unknown> | null) ?? {}, data.stage);
    let q = sb
      .from("leads")
      .update({ meta, updated_at: new Date().toISOString() })
      .eq("id", data.leadId)
      .eq("workspace_id", workspaceId);
    if (perms.assignedRecordsOnly) q = q.eq("assigned_to", userId);
    const { error } = await q;
    if (error) throw new Error(error.message);
    return { ok: true, stage: data.stage };
  });

export const updateListingPipelineOffer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        leadId: z.string().min(1),
        offerAmount: z.string().max(80),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId, userId } = context;
    if (!workspaceId) throw new Error("No workspace");
    assertNotWbahWorkspace(workspaceId);
    const sb = supabase as any;
    const perms = await resolvePermissions(workspaceId, userId);

    let sel = sb.from("leads").select("id, meta").eq("id", data.leadId).eq("workspace_id", workspaceId);
    if (perms.assignedRecordsOnly) sel = sel.eq("assigned_to", userId);
    const { data: lead, error: loadErr } = await sel.maybeSingle();
    if (loadErr) throw new Error(loadErr.message);
    if (!lead) throw new Error("Lead not found");

    const meta = writeListingPipelineOffer((lead.meta as Record<string, unknown> | null) ?? {}, data.offerAmount);
    let q = sb
      .from("leads")
      .update({ meta, updated_at: new Date().toISOString() })
      .eq("id", data.leadId)
      .eq("workspace_id", workspaceId);
    if (perms.assignedRecordsOnly) q = q.eq("assigned_to", userId);
    const { error } = await q;
    if (error) throw new Error(error.message);
    return { ok: true, offerAmount: data.offerAmount };
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
    const { byExact, byTail } = await fetchWorkspaceMessageStatsMaps(sb, workspaceId);
    const leads = ((rows ?? []) as Record<string, unknown>[]).map((row) => {
      const campaignType = lookupWaContactMessageStats(
        row.phone as string | null,
        byExact,
        byTail,
      ).last_campaign_type;
      return mapRow(row, names, campaignType);
    });
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
