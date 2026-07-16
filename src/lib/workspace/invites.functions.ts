import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireAction, writeAccessAudit } from "@/lib/permissions/permissions.server";
import { ROLE_KEYS, legacyRoleToRoleKey } from "@/lib/permissions/permissions.shared";
import { escapeHtml, renderBasicEmail } from "@/lib/email/resend.server";
import { sendWorkspaceEmail } from "@/lib/email/email-dispatch.server";

const ROLE_KEY_RE = /^[a-z0-9_]{2,40}$/;

function getAppUrl(): string {
  return (
    process.env.PUBLIC_APP_URL ||
    process.env.VITE_PUBLIC_APP_URL ||
    "https://webeereceptionist.com"
  );
}

/**
 * Create a workspace invite carrying an extended RBAC role. Requires the
 * `user_management` action grant (owners/admins by default).
 */
export const createInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { email: string; roleKey?: string }) => input)
  .handler(async ({ context, data }) => {
    const { userId, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    await requireAction(workspaceId, userId, "user_management");

    // Package seat enforcement: block invites once included + purchased extra
    // seats are used (counts active members + pending invites, fail closed).
    const { requireStaffSeat } = await import("@/lib/packages/entitlements.server");
    await requireStaffSeat(workspaceId);

    const email = data.email?.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error("A valid email address is required");
    }

    // Role: owner can never be granted via invite. Custom roles must exist.
    const roleKey = (data.roleKey ?? "manager").trim();
    if (!ROLE_KEY_RE.test(roleKey) || roleKey === "owner") throw new Error("Invalid role");
    if (!(ROLE_KEYS as readonly string[]).includes(roleKey)) {
      const { data: roleRow } = await supabaseAdmin
        .from("workspace_role_permissions")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("role_key", roleKey)
        .maybeSingle();
      if (!roleRow) throw new Error(`Unknown role "${roleKey}" — define its permissions first.`);
    }

    // Legacy enum column: admin stays admin, everything else is member.
    const legacyRole = roleKey === "admin" ? "admin" : "member";

    const { data: invite, error } = await (supabaseAdmin as any)
      .from("workspace_invites")
      .insert({
        email,
        role: legacyRole,
        invited_role_key: roleKey,
        invited_by: userId,
        workspace_id: workspaceId,
      })
      .select("id, token, email, expires_at, invited_role_key")
      .single();
    if (error) throw error;

    // Post-insert re-check (guards against concurrent invite creation racing
    // past the pre-check). If we've oversubscribed, roll this invite back.
    {
      const { getStaffSeatUsage } = await import("@/lib/packages/entitlements.server");
      const usage = await getStaffSeatUsage(workspaceId);
      if (usage.used > usage.allowance) {
        await supabaseAdmin.from("workspace_invites").delete().eq("id", invite.id);
        throw new Error(
          `You have reached your staff user limit (${usage.allowance} seat${usage.allowance === 1 ? "" : "s"}). Add extra staff users to invite more people.`,
        );
      }
    }

    await writeAccessAudit({
      workspaceId,
      actingUserId: userId,
      objectType: "invite",
      objectId: invite.id,
      actionType: "create",
      afterState: { email, roleKey },
      riskLevel: "medium",
    });

    // Best-effort invite email — invite still exists if email fails.
    try {
      const { data: ws } = await supabaseAdmin
        .from("workspaces")
        .select("name")
        .eq("id", workspaceId)
        .maybeSingle();
      const wsName = ws?.name ?? "a WEBEE workspace";
      const url = `${getAppUrl()}/invite/${invite.token}`;
      await sendWorkspaceEmail(supabaseAdmin, {
        workspaceId,
        to: email,
        subject: `You've been invited to join ${wsName}`,
        html: renderBasicEmail({
          heading: "You've been invited",
          bodyHtml: `<p>You've been invited to join <strong>${escapeHtml(wsName)}</strong> as <strong>${escapeHtml(roleKey.replace(/_/g, " "))}</strong>.</p><p style="margin-top:20px;"><a href="${url}" style="background:#6d5df6;color:#ffffff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600;">Accept Invitation</a></p><p style="color:#7c7c8a;font-size:13px;">If you weren't expecting this invitation, you can safely ignore this email.</p>`,
        }),
      });
    } catch (e: any) {
      console.warn("[invites] invite email failed (non-fatal):", e?.message ?? e);
    }

    return invite;
  });

/** Look up an invite by token (public — used on the accept page). */
export const getInviteByToken = createServerFn({ method: "GET" })
  .inputValidator((input: { token: string }) => input)
  .handler(async ({ data }) => {
    const { data: invite } = await (supabaseAdmin as any)
      .from("workspace_invites")
      .select("email, role, invited_role_key, expires_at, accepted_at, workspace_id")
      .eq("token", data.token)
      .maybeSingle();
    if (!invite || invite.accepted_at || new Date(invite.expires_at) < new Date()) {
      return { valid: false as const };
    }
    const { data: ws } = await supabaseAdmin
      .from("workspaces")
      .select("name")
      .eq("id", invite.workspace_id)
      .maybeSingle();
    return {
      valid: true as const,
      email: invite.email,
      roleKey: invite.invited_role_key ?? legacyRoleToRoleKey(invite.role),
      workspaceName: ws?.name ?? "Workspace",
    };
  });

/**
 * Accept an invite by token: adds the signed-in user as a workspace member
 * with the invited role. The signed-in email must match the invited email.
 */
export const acceptInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { token: string }) => input)
  .handler(async ({ context, data }) => {
    const { userId } = context;
    const sb = supabaseAdmin as any;

    const { data: invite, error: fetchErr } = await sb
      .from("workspace_invites")
      .select("*")
      .eq("token", data.token)
      .is("accepted_at", null)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (fetchErr || !invite) throw new Error("Invalid or expired invite");

    const { data: profile } = await sb
      .from("profiles")
      .select("email")
      .eq("user_id", userId)
      .maybeSingle();
    if (!profile?.email || profile.email.toLowerCase() !== String(invite.email).toLowerCase()) {
      throw new Error("This invite was sent to a different email address.");
    }

    const roleKey: string = invite.invited_role_key ?? legacyRoleToRoleKey(invite.role);
    const legacyRole = invite.role === "admin" ? "admin" : "member";

    // Membership (idempotent — cross-workspace impossible: workspace comes from the invite row).
    const { data: existing } = await sb
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", invite.workspace_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (!existing) {
      // Seat re-check at accept time (defence in depth: seats may have been
      // consumed since the invite was created). Existing members always pass.
      const { getStaffSeatUsage } = await import("@/lib/packages/entitlements.server");
      const usage = await getStaffSeatUsage(invite.workspace_id);
      // This invite is one of the pending ones, so it holds its own seat:
      // block only if members alone already meet/exceed the allowance.
      if (usage.activeMembers >= usage.allowance) {
        throw new Error(
          "This workspace has no staff seats available. Ask the workspace owner to add extra staff users, then try again.",
        );
      }
      const { error: memberErr } = await sb.from("workspace_members").insert({
        workspace_id: invite.workspace_id,
        user_id: userId,
        role: legacyRole,
      });
      if (memberErr) throw new Error(memberErr.message);
      // Post-insert re-check (guards against concurrent accepts racing past
      // the pre-check). If members alone now exceed allowance, roll back.
      const postUsage = await getStaffSeatUsage(invite.workspace_id);
      if (postUsage.activeMembers > postUsage.allowance) {
        await sb
          .from("workspace_members")
          .delete()
          .eq("workspace_id", invite.workspace_id)
          .eq("user_id", userId);
        throw new Error(
          "This workspace has no staff seats available. Ask the workspace owner to add extra staff users, then try again.",
        );
      }
    }
    await sb.from("workspace_member_roles").upsert(
      {
        workspace_id: invite.workspace_id,
        user_id: userId,
        role_key: roleKey,
        assigned_by_user_id: invite.invited_by,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id,user_id" },
    );
    {
      // The accept may change an EXISTING member's role — drop cached
      // resolved permissions everywhere (new members are never cached).
      const { invalidatePermissionsCache } = await import(
        "@/lib/permissions/permissions.server"
      );
      invalidatePermissionsCache(invite.workspace_id);
    }
    await sb
      .from("workspace_invites")
      .update({ accepted_at: new Date().toISOString() })
      .eq("id", invite.id);

    await writeAccessAudit({
      workspaceId: invite.workspace_id,
      actingUserId: userId,
      targetUserId: userId,
      objectType: "invite",
      objectId: invite.id,
      actionType: "accept",
      afterState: { roleKey },
      riskLevel: "medium",
    });

    // Notify workspace admins that the invite was accepted (best-effort).
    try {
      const { emitCampaignNotification } = await import("@/lib/notifications/notification-engine.shared");
      await emitCampaignNotification(supabaseAdmin as any, {
        workspaceId: invite.workspace_id,
        eventKey: "staff_invite_accepted",
        summary: `${profile.email} accepted their invite and joined the workspace (role: ${roleKey}).`,
      });
    } catch (nErr: any) {
      console.warn("[invites] accept notification failed (non-fatal):", nErr?.message ?? nErr);
    }

    return { workspaceId: invite.workspace_id, role: legacyRole, roleKey };
  });

/**
 * List invites for a workspace. Accessible by workspace owners/admins.
 */
export const listInvites = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, workspaceId, userId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    await requireAction(workspaceId, userId, "user_management");
    const { data, error } = await supabase
      .from("workspace_invites")
      .select("id, email, role, invited_role_key, accepted_at, expires_at, created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  });

/**
 * Revoke an invite. Requires the user_management grant.
 */
export const revokeInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { inviteId: string }) => input)
  .handler(async ({ context, data }) => {
    const { userId, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    await requireAction(workspaceId, userId, "user_management");
    const { error } = await (supabaseAdmin as any)
      .from("workspace_invites")
      .delete()
      .eq("id", data.inviteId)
      .eq("workspace_id", workspaceId);
    if (error) throw error;
    await writeAccessAudit({
      workspaceId,
      actingUserId: userId,
      objectType: "invite",
      objectId: data.inviteId,
      actionType: "revoke",
      riskLevel: "low",
    });
    return { ok: true };
  });
