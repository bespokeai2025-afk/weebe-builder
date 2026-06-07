import { createServerFn } from "@tanstack/react-start";
import { getRequest, setCookie, getCookie } from "@tanstack/react-start/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveWorkspaceIdForUser } from "@/lib/workspace/resolve-workspace.server";
import { getDeployMode, getRetailWorkspaceId } from "@/lib/deploy/config.server";

const WORKSPACE_COOKIE = "wb_workspace_id";

export interface WorkspaceContext {
  workspaceId: string;
  workspaceRole: "owner" | "admin" | "member";
}

export function readWorkspaceCookie(): string | null {
  return getCookie(WORKSPACE_COOKIE) ?? null;
}

export function setWorkspaceCookie(workspaceId: string): void {
  setCookie(WORKSPACE_COOKIE, workspaceId, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

/**
 * Resolve the active workspace for a given user.
 *
 * Priority:
 * 1. Cookie value (if valid membership)
 * 2. profiles.default_workspace_id (fallback)
 * 3. First workspace the user is a member of
 */
export async function resolveActiveWorkspace(
  supabase: SupabaseClient,
  userId: string,
): Promise<WorkspaceContext> {
  const workspaceId = await resolveWorkspaceIdForUser(
    supabase,
    userId,
    readWorkspaceCookie() ?? undefined,
  );

  if (!workspaceId) {
    throw new Error("No workspace found for user");
  }

  if (getDeployMode() === "retail") {
    const retailId = getRetailWorkspaceId();
    if (retailId) setWorkspaceCookie(retailId);
  }

  const { data: role } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!role) {
    throw new Error("No workspace membership found for user");
  }

  return { workspaceId, workspaceRole: role.role };
}
