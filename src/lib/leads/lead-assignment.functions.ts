/**
 * Lead assignment server functions — assign / reassign / unassign leads to
 * human sales agents (workspace members), with a full audit trail and an
 * assignment notification to the assigned agent.
 *
 * Safety invariants:
 *   • Mutations require the `lead_assignment` action grant (owners/admins by
 *     default), resolved fail-closed via requireAction.
 *   • Assignee must be an active member of THIS workspace (never suspended).
 *   • All lead updates are scoped to the caller's workspace — a foreign lead
 *     id silently no-ops (workspace_id filter on the UPDATE).
 *   • Every change writes a lead_assignment_audit row (server-write-only
 *     table); notification dedup keys on the audit row id.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireAction, resolvePermissions } from "@/lib/permissions/permissions.server";

const sb = supabaseAdmin as any;

const MAX_BULK = 200;

const assignInput = z.object({
  leadIds: z.array(z.string().min(1)).min(1).max(MAX_BULK),
  /** Member user id, or null to unassign. */
  assignedTo: z.string().uuid().nullable(),
});

/**
 * Assign / reassign / unassign one or many leads. Returns per-lead results.
 */
export const assignLeads = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => assignInput.parse(input))
  .handler(async ({ context, data }) => {
    const { workspaceId, userId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    await requireAction(workspaceId, userId, "lead_assignment");

    // Validate the assignee is an active member of this workspace.
    let assigneeName: string | null = null;
    if (data.assignedTo) {
      const { data: member } = await sb
        .from("workspace_members")
        .select("user_id")
        .eq("workspace_id", workspaceId)
        .eq("user_id", data.assignedTo)
        .maybeSingle();
      if (!member) throw new Error("The selected user is not a member of this workspace.");
      const assigneePerms = await resolvePermissions(workspaceId, data.assignedTo);
      if (assigneePerms.roleKey === "suspended") {
        throw new Error("This user is suspended and cannot be assigned leads.");
      }
      const { data: prof } = await sb
        .from("profiles")
        .select("full_name, email")
        .eq("user_id", data.assignedTo)
        .maybeSingle();
      assigneeName = prof?.full_name || prof?.email || null;
    }

    // Load current assignees (workspace-scoped) for the audit trail.
    const { data: leads, error: loadErr } = await sb
      .from("leads")
      .select("id, assigned_to, full_name, phone, email")
      .eq("workspace_id", workspaceId)
      .in("id", data.leadIds);
    if (loadErr) throw new Error(loadErr.message);
    const found = (leads ?? []) as Array<{
      id: string; assigned_to: string | null;
      full_name: string | null; phone: string | null; email: string | null;
    }>;
    if (found.length === 0) return { updated: 0, skipped: data.leadIds.length };

    // Skip no-op rows (already assigned to the same user / already unassigned).
    const toChange = found.filter((l) => (l.assigned_to ?? null) !== data.assignedTo);
    if (toChange.length === 0) return { updated: 0, skipped: found.length };

    const nowIso = new Date().toISOString();

    // Audit-first: the audit trail is a hard guarantee. Write audit rows
    // BEFORE mutating leads — if the audit insert fails, nothing changes;
    // if the lead update then fails, compensate by removing the audit rows.
    const { data: auditRows, error: auditErr } = await sb
      .from("lead_assignment_audit")
      .insert(
        toChange.map((l) => ({
          workspace_id: workspaceId,
          lead_id: l.id,
          assigned_to: data.assignedTo,
          previous_assigned_to: l.assigned_to ?? null,
          assigned_by: userId,
        })),
      )
      .select("id, lead_id");
    if (auditErr) throw new Error(`Assignment audit could not be recorded: ${auditErr.message}`);

    const { error: updErr } = await sb
      .from("leads")
      .update({
        assigned_to: data.assignedTo,
        assigned_at: data.assignedTo ? nowIso : null,
        assigned_by: data.assignedTo ? userId : null,
        updated_at: nowIso,
      })
      .eq("workspace_id", workspaceId)
      .in("id", toChange.map((l) => l.id));
    if (updErr) {
      // Compensate: the change never happened, so the audit rows must go.
      const ids = ((auditRows ?? []) as any[]).map((r) => r.id);
      if (ids.length) await sb.from("lead_assignment_audit").delete().in("id", ids);
      throw new Error(updErr.message);
    }

    // Notify the assigned agent (person-directed, best-effort, deduped per
    // audit row so retries never double-notify). Unassign sends nothing.
    if (data.assignedTo && data.assignedTo !== userId) {
      try {
        const { emitCampaignNotification } = await import(
          "@/lib/notifications/notification-engine.shared"
        );
        const auditByLead = new Map<string, string>(
          ((auditRows ?? []) as any[]).map((r) => [r.lead_id, r.id]),
        );
        if (toChange.length === 1) {
          const l = toChange[0];
          const who = l.full_name?.trim() || l.phone?.trim() || l.email?.trim() || "a lead";
          await emitCampaignNotification(sb, {
            workspaceId,
            eventKey: "lead_assigned",
            campaignName: who,
            summary: `You've been assigned ${who}. Open the lead to follow up.`,
            severity: "info",
            targetUserIds: [data.assignedTo],
            leadId: l.id,
            dedupeKey: auditByLead.get(l.id)
              ? `lead_assigned:audit:${auditByLead.get(l.id)}`
              : `lead_assigned:lead:${l.id}:to:${data.assignedTo}:${nowIso}`,
          });
        } else {
          await emitCampaignNotification(sb, {
            workspaceId,
            eventKey: "lead_assigned",
            summary: `You've been assigned ${toChange.length} leads. Open your leads list to follow up.`,
            severity: "info",
            targetUserIds: [data.assignedTo],
            leadIds: toChange.map((l: any) => l.id),
            dedupeKey: auditRows?.[0]?.id
              ? `lead_assigned:audit:${auditRows[0].id}`
              : `lead_assigned:bulk:${data.assignedTo}:${nowIso}`,
          });
        }
      } catch (nErr: any) {
        console.warn("[lead-assign] notification failed (non-fatal):", nErr?.message ?? nErr);
      }
    }

    return { updated: toChange.length, skipped: found.length - toChange.length, assigneeName };
  });

/**
 * Members that can be assigned leads (any active, non-suspended member).
 * Requires membership only — used to render the assignee picker.
 */
export const listAssignableMembers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { workspaceId, userId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const perms = await resolvePermissions(workspaceId, userId);
    if (!perms.isMember) throw new Error("Not a member of this workspace");
    // Only users who can assign need the picker.
    if (!perms.actionAccess.lead_assignment) return [];

    const [{ data: members }, { data: extRoles }] = await Promise.all([
      sb.from("workspace_members").select("user_id, role").eq("workspace_id", workspaceId),
      sb.from("workspace_member_roles").select("user_id, role_key").eq("workspace_id", workspaceId),
    ]);
    const roleMap = new Map<string, string>((extRoles ?? []).map((r: any) => [r.user_id, r.role_key]));
    const active = (members ?? []).filter((m: any) => roleMap.get(m.user_id) !== "suspended");
    const ids = active.map((m: any) => m.user_id);
    const { data: profiles } = ids.length
      ? await sb.from("profiles").select("user_id, email, full_name").in("user_id", ids)
      : { data: [] };
    const profMap = new Map<string, any>((profiles ?? []).map((p: any) => [p.user_id, p]));
    return active.map((m: any) => ({
      userId: m.user_id,
      name: profMap.get(m.user_id)?.full_name || profMap.get(m.user_id)?.email || m.user_id,
      email: profMap.get(m.user_id)?.email ?? null,
      roleKey: roleMap.get(m.user_id) ?? null,
    }));
  });

/** Assignment history for one lead (members-readable audit trail). */
export const getLeadAssignmentHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: { leadId: string }) => z.object({ leadId: z.string().min(1) }).parse(input))
  .handler(async ({ context, data }) => {
    const { workspaceId, userId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const perms = await resolvePermissions(workspaceId, userId);
    if (!perms.isMember) throw new Error("Not a member of this workspace");

    // Assigned-records-only roles may only view history for their own leads —
    // otherwise the audit table leaks assignment relationships workspace-wide.
    if (perms.assignedRecordsOnly) {
      const { data: own } = await sb
        .from("leads")
        .select("id")
        .eq("id", data.leadId)
        .eq("workspace_id", workspaceId)
        .eq("assigned_to", userId)
        .maybeSingle();
      if (!own) return [];
    }

    const { data: rows, error } = await sb
      .from("lead_assignment_audit")
      .select("id, lead_id, assigned_to, previous_assigned_to, assigned_by, created_at")
      .eq("workspace_id", workspaceId)
      .eq("lead_id", data.leadId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);

    const userIds = new Set<string>();
    for (const r of rows ?? []) {
      if (r.assigned_to) userIds.add(r.assigned_to);
      if (r.previous_assigned_to) userIds.add(r.previous_assigned_to);
      if (r.assigned_by) userIds.add(r.assigned_by);
    }
    const { data: profiles } = userIds.size
      ? await sb.from("profiles").select("user_id, email, full_name").in("user_id", Array.from(userIds))
      : { data: [] };
    const profMap = new Map<string, any>((profiles ?? []).map((p: any) => [p.user_id, p]));
    const nameOf = (id: string | null) =>
      id ? (profMap.get(id)?.full_name || profMap.get(id)?.email || id) : null;

    return (rows ?? []).map((r: any) => ({
      id: r.id,
      assignedTo: r.assigned_to,
      assignedToName: nameOf(r.assigned_to),
      previousAssignedTo: r.previous_assigned_to,
      previousAssignedToName: nameOf(r.previous_assigned_to),
      assignedBy: r.assigned_by,
      assignedByName: nameOf(r.assigned_by),
      createdAt: r.created_at,
    }));
  });
