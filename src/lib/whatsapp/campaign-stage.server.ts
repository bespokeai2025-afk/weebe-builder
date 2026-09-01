/**
 * Campaign-lead pipeline stage bumps. Relative-import safe for lead-sync.
 * Listing work lives on meta.listing_stage. pipeline_stage is only set to
 * sale_done when the listing is converted — never new_response / engaged.
 */
import {
  DEFAULT_CAMPAIGN_LEAD_STAGE,
  isSalesPipelineLocked,
  nextStageOnInboundReply,
  nextStageOnOutbound,
  readListingStage,
  writeListingStage,
  type CampaignLeadStage,
} from "./campaign-leads.shared";
import { normalizeWhatsAppPhone } from "./wati-campaign.server";

type Sb = { from: (table: string) => any };

async function setListingStage(
  sb: Sb,
  workspaceId: string,
  leadId: string,
  stage: CampaignLeadStage,
): Promise<void> {
  const { data } = await sb
    .from("leads")
    .select("pipeline_stage, meta")
    .eq("id", leadId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  const currentPipeline = (data?.pipeline_stage as string | null) ?? null;
  if (isSalesPipelineLocked(currentPipeline) && stage !== "converted") return;

  const meta = writeListingStage(
    (data?.meta as Record<string, unknown> | null) ?? {},
    stage,
  );
  const patch: Record<string, unknown> = {
    meta,
    updated_at: new Date().toISOString(),
  };
  if (stage === "converted") patch.pipeline_stage = "sale_done";

  const { error } = await sb
    .from("leads")
    .update(patch)
    .eq("id", leadId)
    .eq("workspace_id", workspaceId);
  if (error) console.warn("[campaign-stage] update failed", error.message);
}

export async function applyInboundCampaignStage(
  sb: Sb,
  workspaceId: string,
  leadId: string,
  created: boolean,
): Promise<void> {
  const { data } = await sb
    .from("leads")
    .select("pipeline_stage, meta")
    .eq("id", leadId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  const currentPipeline = (data?.pipeline_stage as string | null) ?? null;
  if (isSalesPipelineLocked(currentPipeline)) return;

  if (created) {
    await setListingStage(sb, workspaceId, leadId, DEFAULT_CAMPAIGN_LEAD_STAGE);
    return;
  }
  const current = readListingStage(
    (data?.meta as Record<string, unknown> | null) ?? {},
    currentPipeline,
  );
  const next = nextStageOnInboundReply(current);
  if (next) await setListingStage(sb, workspaceId, leadId, next);
}

export async function applyOutboundCampaignStage(
  sb: Sb,
  workspaceId: string,
  leadId: string,
): Promise<void> {
  const { data } = await sb
    .from("leads")
    .select("pipeline_stage, meta")
    .eq("id", leadId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  const currentPipeline = (data?.pipeline_stage as string | null) ?? null;
  if (isSalesPipelineLocked(currentPipeline)) return;
  const current = readListingStage(
    (data?.meta as Record<string, unknown> | null) ?? {},
    currentPipeline,
  );
  const next = nextStageOnOutbound(current);
  if (next) await setListingStage(sb, workspaceId, leadId, next);
}

export async function applyOutboundCampaignStageByPhone(
  sb: Sb,
  workspaceId: string,
  phone: string,
): Promise<void> {
  const normalized = normalizeWhatsAppPhone(phone);
  if (!normalized) return;
  const { data } = await sb
    .from("leads")
    .select("id, pipeline_stage, meta")
    .eq("workspace_id", workspaceId)
    .eq("phone", normalized)
    .maybeSingle();
  if (!data?.id) return;
  if (isSalesPipelineLocked(data.pipeline_stage as string | null)) return;
  const current = readListingStage(
    (data.meta as Record<string, unknown> | null) ?? {},
    data.pipeline_stage as string | null,
  );
  const next = nextStageOnOutbound(current);
  if (next) await setListingStage(sb, workspaceId, data.id, next);
}

export async function markCampaignLeadsAssigned(
  sb: Sb,
  workspaceId: string,
  leadIds: string[],
): Promise<void> {
  if (leadIds.length === 0) return;
  const { data } = await sb
    .from("leads")
    .select("id, pipeline_stage, meta")
    .eq("workspace_id", workspaceId)
    .in("id", leadIds);
  const now = new Date().toISOString();
  for (const row of (data ?? []) as Array<{
    id: string;
    pipeline_stage: string | null;
    meta: Record<string, unknown> | null;
  }>) {
    if (isSalesPipelineLocked(row.pipeline_stage)) continue;
    const stage = readListingStage(row.meta, row.pipeline_stage);
    if (stage === "converted" || stage === "closed") continue;
    const meta = writeListingStage(row.meta ?? {}, "assigned");
    const { error } = await sb
      .from("leads")
      .update({ meta, updated_at: now })
      .eq("id", row.id)
      .eq("workspace_id", workspaceId);
    if (error) console.warn("[campaign-stage] assign bump failed", error.message);
  }
}
