import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { resolveActiveWorkspace, setWorkspaceCookie } from "./context.server";

/**
 * Get the current user's workspace context (injects cookie if missing).
 */
export const getMyContext = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const ws = await resolveActiveWorkspace(supabase, userId);

    const { data: profile } = await supabase
      .from("profiles")
      .select("user_type, default_workspace_id, email, full_name")
      .eq("user_id", userId)
      .maybeSingle();

    return {
      workspaceId: ws.workspaceId,
      workspaceRole: ws.workspaceRole,
      userType: profile?.user_type ?? "user",
      email: profile?.email ?? "",
      fullName: profile?.full_name ?? "",
    };
  });

/**
 * List workspaces the current user is a member of.
 */
export const listWorkspaces = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("workspace_members")
      .select("workspace_id, role, workspaces!inner(name, slug)")
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return (data ?? []).map((m) => ({
      id: m.workspace_id,
      name: (m.workspaces as unknown as { name: string }).name,
      slug: (m.workspaces as unknown as { slug: string }).slug,
      role: m.role,
    }));
  });

/**
 * Switch active workspace. Validates membership, sets cookie.
 */
export const switchWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const ws = await resolveActiveWorkspace(supabase, userId);
    setWorkspaceCookie(ws.workspaceId);
    return { workspaceId: ws.workspaceId, workspaceRole: ws.workspaceRole };
  });

/**
 * Create a personal workspace for a user (used in backfill migration).
 */
export async function ensurePersonalWorkspace(
  userId: string,
  displayName: string,
): Promise<string> {
  const baseSlug =
    displayName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "workspace";

  let slug = baseSlug;
  let suffix = 0;
  while (await workspaceSlugExists(slug)) {
    suffix++;
    slug = `${baseSlug}-${suffix}`;
  }

  const { data: ws, error } = await supabaseAdmin
    .from("workspaces")
    .insert({ name: `${displayName}'s workspace`, slug, owner_id: userId })
    .select("id")
    .single();
  if (error) throw error;

  await supabaseAdmin
    .from("workspace_members")
    .insert({ workspace_id: ws.id, user_id: userId, role: "owner" });

  await supabaseAdmin
    .from("profiles")
    .update({ default_workspace_id: ws.id })
    .eq("user_id", userId);

  // Package gating: every new workspace gets an explicit subscription row
  // (trial by default). Best-effort — the resolver fails closed to trial anyway.
  try {
    const { provisionWorkspacePackage } = await import("@/lib/packages/entitlements.server");
    await provisionWorkspacePackage({ workspaceId: ws.id, actingUserId: userId });
  } catch (e: any) {
    console.warn("[workspace] package provision failed (non-fatal):", e?.message ?? e);
  }

  return ws.id;
}

async function workspaceSlugExists(slug: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("workspaces")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  return !!data;
}
