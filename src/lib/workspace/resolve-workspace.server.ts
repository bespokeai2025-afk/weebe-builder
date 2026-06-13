import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getDeployMode, getRetailWorkspaceId } from "@/lib/deploy/config.server";

/**
 * Resolve workspace id for an authenticated user.
 * In retail mode, always uses RETAIL_WORKSPACE_ID (shared platform workspace).
 *
 * In approval mode: looks up the user's workspace membership.  If none exists
 * (user signed up before the auto-provision trigger), a personal workspace is
 * created on the fly so the builder is always fully accessible.
 */
export async function resolveWorkspaceIdForUser(
  supabase: SupabaseClient,
  userId: string,
  cookieWorkspaceId?: string,
): Promise<string | undefined> {
  if (getDeployMode() === "retail") {
    const retailId = getRetailWorkspaceId();
    if (!retailId) {
      throw new Error(
        "Retail deploy mode is misconfigured: set RETAIL_WORKSPACE_ID and RETELL_RETAIL_API_KEY.",
      );
    }
    const { data: member } = await supabase
      .from("workspace_members")
      .select("workspace_id")
      .eq("workspace_id", retailId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!member) {
      throw new Error(
        "You are not a member of the retail workspace. Ask an admin to run scripts/backfill-retail-workspace.ts.",
      );
    }
    return retailId;
  }

  if (cookieWorkspaceId) {
    const { data: ws } = await supabase
      .from("workspace_members")
      .select("workspace_id")
      .eq("workspace_id", cookieWorkspaceId)
      .eq("user_id", userId)
      .maybeSingle();
    if (ws) return cookieWorkspaceId;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("default_workspace_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (profile?.default_workspace_id) {
    const { data: role } = await supabase
      .from("workspace_members")
      .select("workspace_id")
      .eq("workspace_id", profile.default_workspace_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (role) return profile.default_workspace_id;
  }

  const { data: memberships } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", userId)
    .limit(1);

  if (memberships && memberships.length > 0) {
    return memberships[0].workspace_id;
  }

  // No workspace found — user signed up before the auto-provision trigger.
  // Create a personal workspace now so the builder is immediately usable.
  return autoProvisionWorkspace(userId);
}

async function autoProvisionWorkspace(userId: string): Promise<string | undefined> {
  try {
    const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId);
    const email = authUser?.user?.email ?? "";
    const displayName =
      (authUser?.user?.user_metadata?.full_name as string | undefined) ??
      email.split("@")[0] ??
      "user";

    const baseSlug = displayName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    const safeBase = baseSlug.length >= 3 ? baseSlug.substring(0, 55) : `user-${userId.substring(0, 8)}`;
    const slug = `${safeBase}-${userId.substring(0, 6)}`;

    const { data: ws, error: wsErr } = await supabaseAdmin
      .from("workspaces")
      .insert({ name: `${displayName}'s Workspace`, slug, owner_id: userId })
      .select("id")
      .single();

    if (wsErr || !ws) {
      console.error("[resolve-workspace] auto-provision workspace insert failed:", wsErr?.message);
      return undefined;
    }

    await supabaseAdmin
      .from("workspace_members")
      .insert({ workspace_id: ws.id, user_id: userId, role: "owner" });

    await supabaseAdmin
      .from("workspace_settings")
      .insert({ workspace_id: ws.id, business_name: displayName });

    await supabaseAdmin
      .from("profiles")
      .update({ default_workspace_id: ws.id })
      .eq("user_id", userId);

    // Provision telephony config so every workspace is HyperStream-ready
    // immediately — no manual setup required per user.
    await supabaseAdmin
      .from("telephony_configs")
      .insert({ workspace_id: ws.id, provider: "twilio", is_active: true })
      .then(() => {}) // ignore conflicts (unique constraint)
      .catch(() => {});

    console.info(`[resolve-workspace] auto-provisioned workspace ${ws.id} for user ${userId}`);
    return ws.id;
  } catch (err) {
    console.error("[resolve-workspace] auto-provision failed:", err);
    return undefined;
  }
}
