/**
 * Campaign-lead pipeline stage bumps. Relative-import safe for lead-sync.
 */
import {
  DEFAULT_CAMPAIGN_LEAD_STAGE,
  isCampaignLeadStage,
  nextStageOnInboundReply,
  nextStageOnOutbound,
  type CampaignLeadStage,
} from "./campaign-leads.shared";
import { normalizeWhatsAppPhone } from "./wati-campaign.server";

type Sb = { from: (table: string) => any };

async function setStage(
  sb: Sb,
  workspaceId: string,
  leadId: string,
  stage: CampaignLeadStage,
): Promise<void> {
  const { error } = await sb
    .from("leads")
    .update({ pipeline_stage: stage, updated_at: new Date().toISOString() })
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
  if (created) {
    await setStage(sb, workspaceId, leadId, DEFAULT_CAMPAIGN_LEAD_STAGE);
    return;
  }
  const { data } = await sb
    .from("leads")
    .select("pipeline_stage")
    .eq("id", leadId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  const current = (data?.pipeline_stage as string | null) ?? null;
  const next = nextStageOnInboundReply(current);
  if (next) await setStage(sb, workspaceId, leadId, next);
}

export async function applyOutboundCampaignStage(
  sb: Sb,
  workspaceId: string,
  leadId: string,
): Promise<void> {
  const { data } = await sb
    .from("leads")
    .select("pipeline_stage")
    .eq("id", leadId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  const current = (data?.pipeline_stage as string | null) ?? null;
  const next = nextStageOnOutbound(current);
  if (next) await setStage(sb, workspaceId, leadId, next);
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
    .select("id, pipeline_stage")
    .eq("workspace_id", workspaceId)
    .eq("phone", normalized)
    .maybeSingle();
  if (!data?.id) return;
  const next = nextStageOnOutbound(data.pipeline_stage as string | null);
  if (next) await setStage(sb, workspaceId, data.id, next);
}

export async function markCampaignLeadsAssigned(
  sb: Sb,
  workspaceId: string,
  leadIds: string[],
): Promise<void> {
  if (leadIds.length === 0) return;
  const { data } = await sb
    .from("leads")
    .select("id, pipeline_stage")
    .eq("workspace_id", workspaceId)
    .in("id", leadIds);
  const ids = ((data ?? []) as Array<{ id: string; pipeline_stage: string | null }>)
    .filter((row) => {
      const stage = row.pipeline_stage;
      if (!isCampaignLeadStage(stage)) return false;
      return stage !== "converted" && stage !== "closed";
    })
    .map((row) => row.id);
  if (ids.length === 0) return;
  const { error } = await sb
    .from("leads")
    .update({ pipeline_stage: "assigned", updated_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .in("id", ids);
  if (error) console.warn("[campaign-stage] assign bump failed", error.message);
}
