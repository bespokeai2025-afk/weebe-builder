import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { renderBasicEmail, escapeHtml } from "@/lib/email/resend.server";
import { createEmailProviderWithFallback } from "@/lib/providers/email/factory";
import type { EmailConfig } from "@/lib/providers/email/factory";

const APP_URL =
  process.env.PUBLIC_SITE_URL?.trim().replace(/\/$/, "") ||
  (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "");

async function assertAdmin(userId: string) {
  // Check profiles.user_type first — this is what the route guard and
  // updateUserType use, so it's the authoritative admin flag.
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("user_type")
    .eq("user_id", userId)
    .maybeSingle();
  if (profile?.user_type === "admin") return;

  // Fall back to legacy user_roles table.
  const { data: roles } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin");
  if (!roles || roles.length === 0) throw new Error("Forbidden");
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

    // Look up the requesting user's profile (email + default workspace).
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("email, full_name, default_workspace_id")
      .eq("user_id", req.user_id)
      .maybeSingle();

    // When approving with a Retell API key, store it in the user's workspace
    // settings so cloneRetellAgentForDeploy can use it automatically.
    if (data.approve && data.retellApiKey?.trim()) {
      const apiKey = data.retellApiKey.trim();
      const workspaceId = profile?.default_workspace_id;
      if (workspaceId) {
        await supabaseAdmin
          .from("workspace_settings")
          .update({ retell_workspace_id: apiKey } as never)
          .eq("workspace_id", workspaceId);
      }
    }

    // Notify the user by email (non-critical — never block the decision).
    if (profile?.email) {
      const rawName = profile.full_name?.trim() || "there";
      const rawWorkspaceName = req.workspace_name || "your workspace";
      const name = escapeHtml(rawName);
      const workspaceName = escapeHtml(rawWorkspaceName);
      try {
        // Route notification email through the provider framework.
        // Primary: Resend (platform RESEND_API_KEY). Fallback: per-workspace
        // SendGrid key if one has been stored in provider_settings.
        const adminWorkspaceId = context.workspaceId ?? "";
        const { data: sgRow } = await supabaseAdmin
          .from("provider_settings" as never)
          .select("credentials")
          .eq("workspace_id" as never, adminWorkspaceId)
          .eq("provider_category" as never, "email")
          .eq("provider_name" as never, "sendgrid")
          .eq("status" as never, "connected")
          .maybeSingle() as any;
        const sgKey: string | null = sgRow?.credentials?.apiKey ?? null;
        const primaryCfg: EmailConfig = {
          provider: "resend",
          apiKey: process.env.RESEND_API_KEY ?? "",
          defaultFrom: process.env.RESEND_FROM,
        };
        const fallbackCfg: EmailConfig | null = sgKey
          ? { provider: "sendgrid", apiKey: sgKey }
          : null;
        const emailProvider = createEmailProviderWithFallback(
          { ...primaryCfg, workspaceId: adminWorkspaceId },
          fallbackCfg,
        );

        let subject: string;
        let html: string;
        let text: string;
        if (data.approve) {
          const cta = APP_URL
            ? `<p style="margin:20px 0 0;"><a href="${APP_URL}/dashboard" style="display:inline-block;background:#6366f1;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-size:14px;font-weight:600;">Open your workspace</a></p>`
            : "";
          subject = `Your workspace "${rawWorkspaceName}" has been approved`;
          html = renderBasicEmail({
            heading: "Your workspace is approved",
            bodyHtml: `<p style="margin:0 0 12px;">Hi ${name},</p>
              <p style="margin:0 0 12px;">Good news — your workspace <strong>${workspaceName}</strong> has been approved and is ready to use. You can now build agents and take them live.</p>
              ${cta}`,
          });
          text = `Hi ${rawName},\n\nYour workspace "${rawWorkspaceName}" has been approved and is ready to use.${APP_URL ? `\n\nOpen it: ${APP_URL}/dashboard` : ""}\n\n— Webespoke AI`;
        } else {
          subject = `Update on your workspace request "${rawWorkspaceName}"`;
          html = renderBasicEmail({
            heading: "Workspace request update",
            bodyHtml: `<p style="margin:0 0 12px;">Hi ${name},</p>
              <p style="margin:0 0 12px;">Thanks for your interest. Unfortunately your request for the workspace <strong>${workspaceName}</strong> was not approved at this time.</p>
              <p style="margin:0;">If you think this was a mistake or want to discuss it, just reply to this email.</p>`,
          });
          text = `Hi ${rawName},\n\nYour request for the workspace "${rawWorkspaceName}" was not approved at this time. Reply to this email if you'd like to discuss it.\n\n— Webespoke AI`;
        }

        const sendResult = await emailProvider.sendEmail({ to: profile.email, subject, html, text });
        const result = { success: sendResult.accepted.length > 0, error: sendResult.rejected.length > 0 ? "rejected" : undefined };
        if (!result.success) {
          console.error(
            `[workspace] approval email not sent (request=${data.id}, user=${req.user_id}): ${result.error}`,
          );
        }
      } catch (err) {
        console.error("[workspace] approval email failed:", err);
      }
    }

    return { ok: true };
  });
