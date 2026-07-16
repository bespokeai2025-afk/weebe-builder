/**
 * Workspace email provider settings — server functions (Task #370).
 *
 * Guard model (fail closed):
 *   • Every fn resolves the active workspace, requires the
 *     `custom_email_provider` package feature AND settings-page access.
 *   • The settings table is server-only (RLS deny-all) — all reads/writes go
 *     through supabaseAdmin here.
 *   • API keys are encrypted at rest and NEVER returned: only a masked hint
 *     (last 4 chars) is exposed. Saving without a new key keeps the old one.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { resolveActiveWorkspace } from "@/lib/workspace/context.server";
import { isWbahWorkspaceId } from "@/lib/wbah-exclusion.shared";

async function ctxGuard(context: any, level: "view" | "edit") {
  const { supabase, workspaceId, userId } = context;
  if (!workspaceId) throw new Error("No active workspace");
  const ws = await resolveActiveWorkspace(supabase, userId);
  if (isWbahWorkspaceId(ws.workspaceId)) {
    throw new Error("This feature is not available for this workspace.");
  }
  const { requireFeatureAccess, requirePageAccessEntitled } = await import(
    "@/lib/packages/entitlements.server"
  );
  await requireFeatureAccess(ws.workspaceId, userId, "custom_email_provider");
  await requirePageAccessEntitled(ws.workspaceId, userId, "settings", level);
  return { workspaceId: ws.workspaceId, userId: userId as string };
}

function maskKeyHint(cfg: Record<string, string>): string | null {
  const key = cfg.api_key;
  if (!key) return null;
  return `••••••••${key.slice(-4)}`;
}

export const getEmailProviderSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { workspaceId } = await ctxGuard(context, "view");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { decryptEmailProviderConfig } = await import("@/lib/email/email-dispatch.server");
    const { data } = await (supabaseAdmin as any)
      .from("workspace_email_provider_settings")
      .select("provider, sending_mode, from_name, from_email, reply_to_email, encrypted_config, domain_status, is_active, fallback_to_platform, consecutive_failures, last_send_status, last_send_at, last_send_error, last_send_provider")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (!data) {
      return {
        exists: false,
        provider: "resend",
        sendingMode: "platform_default" as const,
        fromName: null as string | null,
        fromEmail: null as string | null,
        replyToEmail: null as string | null,
        apiKeyHint: null as string | null,
        domainStatus: "unverified",
        isActive: false,
        fallbackToPlatform: true,
        consecutiveFailures: 0,
        lastSendStatus: null as string | null,
        lastSendAt: null as string | null,
        lastSendError: null as string | null,
        lastSendProvider: null as string | null,
      };
    }
    return {
      exists: true,
      provider: data.provider,
      sendingMode: data.sending_mode as "platform_default" | "custom",
      fromName: data.from_name,
      fromEmail: data.from_email,
      replyToEmail: data.reply_to_email,
      apiKeyHint: maskKeyHint(decryptEmailProviderConfig(data.encrypted_config)),
      domainStatus: data.domain_status,
      isActive: data.is_active === true,
      fallbackToPlatform: data.fallback_to_platform !== false,
      consecutiveFailures: data.consecutive_failures ?? 0,
      lastSendStatus: data.last_send_status,
      lastSendAt: data.last_send_at,
      lastSendError: data.last_send_error,
      lastSendProvider: data.last_send_provider,
    };
  });

const saveSchema = z.object({
  sendingMode: z.enum(["platform_default", "custom"]),
  fromName: z.string().max(120).nullable().optional(),
  fromEmail: z.string().email().max(200).nullable().optional().or(z.literal("").transform(() => null)),
  replyToEmail: z.string().email().max(200).nullable().optional().or(z.literal("").transform(() => null)),
  /** New API key — omit/empty to keep the stored one. */
  apiKey: z.string().max(400).nullable().optional(),
  isActive: z.boolean(),
  fallbackToPlatform: z.boolean(),
});

export const saveEmailProviderSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => saveSchema.parse(input))
  .handler(async ({ data: input, context }) => {
    const { workspaceId, userId } = await ctxGuard(context, "edit");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { encryptEmailProviderConfig, decryptEmailProviderConfig } = await import(
      "@/lib/email/email-dispatch.server"
    );
    const sb = supabaseAdmin as any;

    const { data: existing } = await sb
      .from("workspace_email_provider_settings")
      .select("id, encrypted_config")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    const newKey = (input.apiKey ?? "").trim();
    let encrypted: Record<string, string>;
    if (newKey) {
      encrypted = encryptEmailProviderConfig({ api_key: newKey });
    } else {
      encrypted = existing?.encrypted_config ?? {};
    }

    const hasKey = Boolean(decryptEmailProviderConfig(encrypted).api_key);
    if (input.sendingMode === "custom" && input.isActive) {
      if (!hasKey) throw new Error("An API key is required to activate a custom email provider.");
      if (!input.fromEmail) throw new Error("A from email address is required to activate a custom email provider.");
    }

    const nowIso = new Date().toISOString();
    const row = {
      workspace_id: workspaceId,
      provider: "resend",
      sending_mode: input.sendingMode,
      from_name: input.fromName?.trim() || null,
      from_email: input.fromEmail?.trim() || null,
      reply_to_email: input.replyToEmail?.trim() || null,
      encrypted_config: encrypted,
      is_active: input.isActive,
      fallback_to_platform: input.fallbackToPlatform,
      // Reset the failure counter on any settings change so a fixed key gets a
      // clean slate (and the admin alert can fire again if it breaks anew).
      consecutive_failures: 0,
      updated_at: nowIso,
      ...(existing ? {} : { created_by: userId }),
    };
    const { error } = existing
      ? await sb.from("workspace_email_provider_settings").update(row).eq("id", existing.id)
      : await sb.from("workspace_email_provider_settings").insert(row);
    if (error) throw new Error(`Failed to save email provider settings: ${error.message}`);

    const { writeAccessAudit } = await import("@/lib/permissions/permissions.server");
    await writeAccessAudit({
      workspaceId,
      actingUserId: userId,
      objectType: "email_provider_settings",
      objectId: workspaceId,
      actionType: existing ? "email_provider_updated" : "email_provider_created",
      afterState: {
        sendingMode: input.sendingMode,
        isActive: input.isActive,
        fallbackToPlatform: input.fallbackToPlatform,
        fromEmail: input.fromEmail ?? null,
        keyRotated: Boolean(newKey),
      },
      riskLevel: "medium",
    });
    return { ok: true };
  });

export const sendEmailProviderTest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ to: z.string().email().max(200) }).parse(input))
  .handler(async ({ data: input, context }) => {
    const { workspaceId, userId } = await ctxGuard(context, "edit");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendWorkspaceEmail } = await import("@/lib/email/email-dispatch.server");
    const { renderBasicEmail } = await import("@/lib/email/resend.server");

    const result = await sendWorkspaceEmail(supabaseAdmin as any, {
      workspaceId,
      to: input.to,
      subject: "WEBEE email provider test",
      html: renderBasicEmail({
        heading: "Email provider test",
        bodyHtml:
          "<p>This is a test email from your workspace email settings. If you're reading this, sending works.</p>",
      }),
    });

    const { writeAccessAudit } = await import("@/lib/permissions/permissions.server");
    await writeAccessAudit({
      workspaceId,
      actingUserId: userId,
      objectType: "email_provider_settings",
      objectId: workspaceId,
      actionType: "email_provider_test_send",
      afterState: {
        success: result.success,
        providerUsed: result.providerUsed,
        fellBack: result.fellBack,
        ...(result.success ? {} : { error: (result.error ?? "unknown").slice(0, 200) }),
      },
      riskLevel: "low",
    });
    return {
      success: result.success,
      providerUsed: result.providerUsed,
      fellBack: result.fellBack,
      error: result.success ? null : (result.error ?? "unknown"),
    };
  });
