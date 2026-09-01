/**
 * 24h listing-assignment SLA. If an assigned campaign lead has no agent
 * contact since assignment, mark No Activity, notify agent + admins, and
 * round-robin to the next member.
 *
 * Dev: campaign-scheduler plugin. Prod: /api/public/campaign-executor.
 * Do not reuse HiveMind 14-day idle.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isWbahWorkspaceId } from "@/lib/wbah-exclusion.shared";
import {
  isListingSlaBreached,
  LISTING_SLA_KEY,
  nextRoundRobinAssignee,
  writeListingOutcome,
  type ListingOutcomeRecord,
} from "@/lib/whatsapp/campaign-leads.shared";
import { emitCampaignNotification } from "@/lib/notifications/notification-engine.shared";

const sb = supabaseAdmin as any;
const MAX_PER_TICK = 40;

async function membersForWorkspace(workspaceId: string): Promise<string[]> {
  const [{ data: members }, { data: extRoles }] = await Promise.all([
    sb.from("workspace_members").select("user_id").eq("workspace_id", workspaceId),
    sb.from("workspace_member_roles").select("user_id, role_key").eq("workspace_id", workspaceId),
  ]);
  const suspended = new Set(
    ((extRoles ?? []) as Array<{ user_id: string; role_key: string | null }>)
      .filter((r) => r.role_key === "suspended")
      .map((r) => r.user_id),
  );
  return ((members ?? []) as Array<{ user_id: string }>)
    .map((m) => m.user_id)
    .filter((id) => id && !suspended.has(id));
}

export async function runListingAssignmentSlaTick(): Promise<{
  scanned: number;
  breached: number;
  shuffled: number;
  errors: number;
}> {
  const { data: rows, error } = await sb
    .from("leads")
    .select(
      "id, workspace_id, full_name, phone, assigned_to, assigned_at, last_contacted_at, pipeline_stage, meta",
    )
    .not("assigned_to", "is", null)
    .not("assigned_at", "is", null)
    .order("assigned_at", { ascending: true })
    .limit(800);

  if (error) {
    console.warn("[listing-sla] query failed:", error.message);
    return { scanned: 0, breached: 0, shuffled: 0, errors: 1 };
  }

  const candidates = ((rows ?? []) as Array<Record<string, unknown>>).filter((lead) => {
    const workspaceId = String(lead.workspace_id ?? "");
    if (!workspaceId || isWbahWorkspaceId(workspaceId)) return false;
    return isListingSlaBreached({
      assigned_to: lead.assigned_to as string | null,
      assigned_at: lead.assigned_at as string | null,
      last_contacted_at: lead.last_contacted_at as string | null,
      pipeline_stage: lead.pipeline_stage as string | null,
      meta: (lead.meta as Record<string, unknown> | null) ?? null,
    });
  });

  const memberCache = new Map<string, string[]>();
  let breached = 0;
  let shuffled = 0;
  let errors = 0;
  const nowIso = new Date().toISOString();

  for (const lead of candidates.slice(0, MAX_PER_TICK)) {
    const workspaceId = String(lead.workspace_id ?? "");
    const leadId = String(lead.id ?? "");
    const assignedTo = String(lead.assigned_to ?? "");
    const assignedAt = String(lead.assigned_at ?? "");
    if (!workspaceId || !leadId || !assignedTo) continue;

    try {
      if (!memberCache.has(workspaceId)) {
        memberCache.set(workspaceId, await membersForWorkspace(workspaceId));
      }
      const nextId = nextRoundRobinAssignee(memberCache.get(workspaceId) ?? [], assignedTo);

      const outcome: ListingOutcomeRecord = {
        status: "no_activity",
        at: nowIso,
        by: null,
      };
      const meta = {
        ...writeListingOutcome((lead.meta as Record<string, unknown> | null) ?? {}, outcome),
        [LISTING_SLA_KEY]: {
          assignedAt,
          breachedAt: nowIso,
          shuffledFrom: assignedTo,
          shuffledTo: nextId,
        },
      };
      const patch: Record<string, unknown> = {
        meta,
        updated_at: nowIso,
      };
      if (nextId) {
        patch.assigned_to = nextId;
        patch.assigned_at = nowIso;
        patch.assigned_by = assignedTo;
      }

      const { error: updErr } = await sb
        .from("leads")
        .update(patch)
        .eq("id", leadId)
        .eq("workspace_id", workspaceId);
      if (updErr) throw new Error(updErr.message);

      if (nextId) {
        await sb.from("lead_assignment_audit").insert({
          workspace_id: workspaceId,
          lead_id: leadId,
          assigned_to: nextId,
          previous_assigned_to: assignedTo,
          assigned_by: assignedTo,
        });
        shuffled++;
      }

      const who =
        String(lead.full_name ?? "").trim() ||
        String(lead.phone ?? "").trim() ||
        "a listing lead";

      await emitCampaignNotification(sb, {
        workspaceId,
        eventKey: "needs_admin_attention",
        summary: nextId
          ? `No activity for 24h on ${who}. Reassigned to the next agent.`
          : `No activity for 24h on ${who}. Marked No Activity.`,
        severity: "warning",
        leadId,
        recommendedAction: "Open Listing Leads and follow up.",
        dedupeKey: `listing_sla:${leadId}:${assignedAt}`,
      });
      await emitCampaignNotification(sb, {
        workspaceId,
        eventKey: "lead_assigned",
        campaignName: who,
        summary: `24h SLA: ${who} had no activity and was marked No Activity.`,
        severity: "warning",
        targetUserIds: nextId ? [assignedTo, nextId] : [assignedTo],
        leadId,
        dedupeKey: `listing_sla_agent:${leadId}:${assignedAt}`,
      });
      breached++;
    } catch (e) {
      errors++;
      console.warn("[listing-sla] lead failed", leadId, e instanceof Error ? e.message : e);
    }
  }

  return { scanned: (rows ?? []).length, breached, shuffled, errors };
}
