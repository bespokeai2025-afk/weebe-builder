import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function assertAdmin(userId: string) {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin");
  if (!data || data.length === 0) throw new Error("Forbidden");
}

/** Current user: get their most recent workspace request (or null). */
export const getMyWorkspaceRequest = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("workspace_requests")
      .select("id, workspace_name, status, created_at, decided_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  });

/** Current user: submit a workspace creation request. */
export const requestWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { workspaceName: string }) => {
    const name = (input?.workspaceName ?? "").trim();
    if (!name || name.length < 2 || name.length > 80)
      throw new Error("Workspace name must be 2-80 characters");
    return { workspaceName: name };
  })
  .handler(async ({ context, data }) => {
    const { userId } = context;
    // If an existing pending or approved request exists, return it.
    const { data: existing } = await supabaseAdmin
      .from("workspace_requests")
      .select("id, workspace_name, status")
      .eq("user_id", userId)
      .in("status", ["pending", "approved"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing) return existing;

    const { data: row, error } = await supabaseAdmin
      .from("workspace_requests")
      .insert({
        user_id: userId,
        workspace_name: data.workspaceName,
        status: "pending",
      })
      .select("id, workspace_name, status")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

/** Admin: list all workspace requests with user email. */
export const listWorkspaceRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { data: reqs, error } = await supabaseAdmin
      .from("workspace_requests")
      .select("id, user_id, workspace_name, status, created_at, decided_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    if (!reqs || reqs.length === 0) return [];
    const userIds = Array.from(new Set(reqs.map((r) => r.user_id)));
    const { data: profs } = await supabaseAdmin
      .from("profiles")
      .select("user_id, email")
      .in("user_id", userIds);
    const emailMap = new Map((profs ?? []).map((p) => [p.user_id, p.email]));
    return reqs.map((r) => ({ ...r, email: emailMap.get(r.user_id) ?? "" }));
  });

/** Admin: approve or deny a workspace request.
 *  When approving, pass retellApiKey to store the dedicated Retell
 *  sub-account API key for the user's workspace (so Go Live is one-click).
 */
export const decideWorkspaceRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { id: string; approve: boolean; retellApiKey?: string }) => input,
  )
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);

    // Look up the request to get the user_id.
    const { data: req, error: reqErr } = await supabaseAdmin
      .from("workspace_requests")
      .select("id, user_id, workspace_name")
      .eq("id", data.id)
      .maybeSingle();
    if (reqErr) throw new Error(reqErr.message);
    if (!req) throw new Error("Workspace request not found");

    const { error } = await supabaseAdmin
      .from("workspace_requests")
      .update({
        status: data.approve ? "approved" : "denied",
        decided_at: new Date().toISOString(),
        decided_by: context.userId,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);

    // When approving with a Retell API key, store it in the user's workspace
    // settings so cloneRetellAgentForDeploy can use it automatically.
    if (data.approve && data.retellApiKey?.trim()) {
      const apiKey = data.retellApiKey.trim();
      // Find the user's default workspace.
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("default_workspace_id")
        .eq("user_id", req.user_id)
        .maybeSingle();
      const workspaceId = profile?.default_workspace_id;
      if (workspaceId) {
        await supabaseAdmin
          .from("workspace_settings")
          .update({ retell_workspace_id: apiKey } as never)
          .eq("workspace_id", workspaceId);
      }
    }

    return { ok: true };
  });
