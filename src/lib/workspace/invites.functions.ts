import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Create a workspace invite. Accessible by workspace owners/admins.
 */
export const createInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { email: string }) => input)
  .handler(async ({ context, data }) => {
    const { userId, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");

    const role = "member";

    const { data: invite, error } = await supabaseAdmin
      .from("workspace_invites")
      .insert({
        email: data.email,
        role,
        invited_by: userId,
        workspace_id: workspaceId,
      })
      .select("id, token, email, expires_at")
      .single();
    if (error) throw error;

    return invite;
  });

/**
 * Accept an invite by token. Adds user as workspace member.
 */
export const acceptInvite = createServerFn({ method: "POST" })
  .inputValidator((input: { token: string }) => input)
  .handler(async ({ data }) => {
    const { token } = data;

    const { data: invite, error: fetchErr } = await supabaseAdmin
      .from("workspace_invites")
      .select("*")
      .eq("token", token)
      .is("accepted_at", null)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (fetchErr || !invite) throw new Error("Invalid or expired invite");

    return { workspaceId: invite.workspace_id, role: invite.role };
  });

/**
 * List invites for a workspace. Accessible by workspace owners/admins.
 */
export const listInvites = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const { data, error } = await supabase
      .from("workspace_invites")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  });

/**
 * Revoke an invite. Accessible by workspace owners/admins.
 */
export const revokeInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { inviteId: string }) => input)
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const { error } = await supabase
      .from("workspace_invites")
      .delete()
      .eq("id", data.inviteId)
      .eq("workspace_id", workspaceId);
    if (error) throw error;
    return { ok: true };
  });
