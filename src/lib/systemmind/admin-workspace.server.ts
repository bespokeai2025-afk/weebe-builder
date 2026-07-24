import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function requirePlatformAdmin(userId: string) {
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("user_type")
    .eq("user_id", userId)
    .maybeSingle();
  if (data?.user_type !== "admin") throw new Error("Forbidden: admins only");
}

function makeSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "workspace";
}

async function slugExists(slug: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("workspaces")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  return !!data;
}

async function uniqueSlug(base: string): Promise<string> {
  let slug = base;
  let i = 0;
  while (await slugExists(slug)) {
    i++;
    slug = `${base}-${i}`;
  }
  return slug;
}

/**
 * Admin: create a brand-new client workspace and set its owner.
 * Returns the new workspace id.
 */
export const adminCreateClientWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      name:       z.string().min(2, "Name must be at least 2 chars"),
      ownerEmail: z.string().email("Invalid email"),
      planTier:   z.string().optional(),
    }),
  )
  .handler(async ({ context, data }) => {
    await requirePlatformAdmin(context.userId);

    const slug = await uniqueSlug(makeSlug(data.name));

    // Look up owner by email via auth admin BEFORE the insert —
    // workspaces.owner_id is NOT NULL, so we must supply an owner up front.
    const { data: usersPage } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
    const email = data.ownerEmail.trim().toLowerCase();
    const ownerUser = usersPage?.users?.find((u) => (u.email ?? "").toLowerCase() === email);

    // If the owner email has no platform account yet, the creating admin is
    // set as a placeholder owner; the real owner can be linked once they sign up.
    const { data: ws, error: wsErr } = await supabaseAdmin
      .from("workspaces")
      .insert({ name: data.name, slug, owner_id: ownerUser?.id ?? context.userId })
      .select("id")
      .single();
    if (wsErr) throw new Error(wsErr.message);

    // Set plan tier if supplied
    if (data.planTier) {
      await supabaseAdmin
        .from("workspace_settings")
        .upsert({ workspace_id: ws.id, plan_tier: data.planTier }, { onConflict: "workspace_id" });
    }

    if (ownerUser) {
      await supabaseAdmin
        .from("workspace_members")
        .insert({ workspace_id: ws.id, user_id: ownerUser.id, role: "owner" });

      await supabaseAdmin
        .from("profiles")
        .update({ default_workspace_id: ws.id })
        .eq("user_id", ownerUser.id);
    }

    return { workspaceId: ws.id, slug, ownerLinked: !!ownerUser };
  });

/**
 * Admin: set a workspace's active/suspended status via workspace_settings.
 */
export const adminSetWorkspaceStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      workspaceId: z.string().uuid(),
      status:      z.enum(["active", "suspended"]),
    }),
  )
  .handler(async ({ context, data }) => {
    await requirePlatformAdmin(context.userId);

    const { error } = await supabaseAdmin
      .from("workspace_settings")
      .upsert(
        { workspace_id: data.workspaceId, workspace_status: data.status },
        { onConflict: "workspace_id" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Admin: list all workspaces with status info.
 */
export const adminListWorkspacesForClients = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requirePlatformAdmin(context.userId);

    const { data, error } = await supabaseAdmin
      .from("workspaces")
      .select("id, name, slug, created_at, workspace_settings(plan_tier, workspace_status, active_modules)")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    return (data ?? []).map((ws) => {
      const settings = (ws.workspace_settings as any)?.[0] ?? {};
      return {
        id:            ws.id,
        name:          ws.name,
        slug:          ws.slug,
        createdAt:     ws.created_at,
        planTier:      settings.plan_tier ?? "free",
        status:        settings.workspace_status ?? "active",
        activeModules: settings.active_modules ?? [],
      };
    });
  });
