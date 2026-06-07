import type { SupabaseClient } from "@supabase/supabase-js";
import { getDeployMode, getRetailWorkspaceId } from "@/lib/deploy/config.server";

/**
 * Resolve workspace id for an authenticated user.
 * In retail mode, always uses RETAIL_WORKSPACE_ID (shared platform workspace).
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

  return undefined;
}
