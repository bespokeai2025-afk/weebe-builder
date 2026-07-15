/**
 * Workspace email dispatch layer (Task #370).
 *
 * Single entry point for all workspace-scoped automated email. Resolves the
 * sending provider by strict priority:
 *
 *   1. Workspace's own ACTIVE custom provider (workspace_email_provider_settings)
 *   2. Reseller PARENT's active custom provider — only when the child inherits
 *      branding (workspace_relationships active + branding_mode 'inherit')
 *   3. WEBEE platform default (RESEND_API_KEY / RESEND_FROM)
 *
 * Failure semantics (never throws):
 *   • Custom-provider failure is recorded on the settings row (last_send_*,
 *     consecutive_failures) and optionally falls back to the platform default
 *     when fallback_to_platform is enabled.
 *   • After FAILURE_ALERT_THRESHOLD consecutive custom failures, an in-app
 *     admin alert row is written to workspace_notifications (deduped while
 *     failures continue).
 *   • No secrets ever leave this module — errors are provider codes only.
 *
 * IMPORTANT: this file is imported from notification-engine.shared.ts, which
 * also runs inside the campaign-executor Vite plugin — keep imports RELATIVE
 * and node-builtin only.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { sendResendEmail, type SendEmailResult } from "./resend.server";

type Sb = any;

export const FAILURE_ALERT_THRESHOLD = 3;

// ── Credential encryption (same scheme as systemmind client-api-connections) ─

function deriveKey(): Buffer {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for credential encryption");
  return createHash("sha256").update(secret).digest();
}

/** Encrypt a config object → opaque blob `{ _enc: "ivHex:cipherHex" }`. Server-only. */
export function encryptEmailProviderConfig(cfg: Record<string, string>): Record<string, string> {
  if (Object.keys(cfg).length === 0) return {};
  const key = deriveKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-cbc", key, iv);
  let enc = cipher.update(JSON.stringify(cfg), "utf8", "hex");
  enc += cipher.final("hex");
  return { _enc: `${iv.toString("hex")}:${enc}` };
}

/** Decrypt the blob produced above. Server-only — NEVER expose via a server fn. */
export function decryptEmailProviderConfig(
  blob: Record<string, string> | null | undefined,
): Record<string, string> {
  if (!blob || !blob._enc) return {};
  try {
    const [ivHex, enc] = String(blob._enc).split(":");
    if (!ivHex || !enc) return {};
    const decipher = createDecipheriv("aes-256-cbc", deriveKey(), Buffer.from(ivHex, "hex"));
    let out = decipher.update(enc, "hex", "utf8");
    out += decipher.final("utf8");
    return JSON.parse(out);
  } catch {
    return {};
  }
}

// ── Provider resolution ──────────────────────────────────────────────────────

export type ResolvedEmailProvider = {
  source: "workspace_custom" | "parent_custom" | "platform_default";
  provider: "resend";
  /** null → platform env key */
  apiKey: string | null;
  from: string | null;
  replyTo: string | null;
  /** settings row the credentials came from (for failure bookkeeping) */
  settingsRowId: string | null;
  settingsWorkspaceId: string | null;
  fallbackToPlatform: boolean;
};

const PLATFORM_PROVIDER: ResolvedEmailProvider = {
  source: "platform_default",
  provider: "resend",
  apiKey: null,
  from: null,
  replyTo: null,
  settingsRowId: null,
  settingsWorkspaceId: null,
  fallbackToPlatform: false,
};

function buildFrom(fromName: string | null, fromEmail: string | null): string | null {
  if (!fromEmail) return null;
  return fromName ? `${fromName} <${fromEmail}>` : fromEmail;
}

async function loadActiveCustomSettings(sb: Sb, workspaceId: string) {
  const { data } = await sb
    .from("workspace_email_provider_settings")
    .select("id, workspace_id, provider, sending_mode, from_name, from_email, reply_to_email, encrypted_config, is_active, fallback_to_platform")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!data || !data.is_active || data.sending_mode !== "custom") return null;
  const cfg = decryptEmailProviderConfig(data.encrypted_config);
  if (!cfg.api_key) return null;
  return { row: data, apiKey: cfg.api_key as string };
}

/**
 * Resolve the effective provider for a workspace. NEVER throws — resolution
 * problems fall back to the platform default.
 */
export async function resolveWorkspaceEmailProvider(
  sb: Sb,
  workspaceId: string | null | undefined,
): Promise<ResolvedEmailProvider> {
  try {
    if (!workspaceId) return PLATFORM_PROVIDER;

    const own = await loadActiveCustomSettings(sb, workspaceId);
    if (own) {
      return {
        source: "workspace_custom",
        provider: "resend",
        apiKey: own.apiKey,
        from: buildFrom(own.row.from_name, own.row.from_email),
        replyTo: own.row.reply_to_email ?? null,
        settingsRowId: own.row.id,
        settingsWorkspaceId: workspaceId,
        fallbackToPlatform: own.row.fallback_to_platform !== false,
      };
    }

    // Reseller parent custom provider — only when this child inherits branding.
    const { data: rel } = await sb
      .from("workspace_relationships")
      .select("parent_workspace_id, status")
      .eq("child_workspace_id", workspaceId)
      .maybeSingle();
    if (rel?.parent_workspace_id && rel.status === "active") {
      const { data: client } = await sb
        .from("reseller_client_accounts")
        .select("branding_mode")
        .eq("child_workspace_id", workspaceId)
        .maybeSingle();
      const mode = client?.branding_mode ?? "inherit";
      if (mode === "inherit") {
        const parent = await loadActiveCustomSettings(sb, rel.parent_workspace_id);
        if (parent) {
          return {
            source: "parent_custom",
            provider: "resend",
            apiKey: parent.apiKey,
            from: buildFrom(parent.row.from_name, parent.row.from_email),
            replyTo: parent.row.reply_to_email ?? null,
            settingsRowId: parent.row.id,
            settingsWorkspaceId: rel.parent_workspace_id,
            fallbackToPlatform: parent.row.fallback_to_platform !== false,
          };
        }
      }
    }
  } catch (err: any) {
    console.warn("[email-dispatch] provider resolution failed (using platform default):", err?.message ?? err);
  }
  return PLATFORM_PROVIDER;
}

// ── Sending ──────────────────────────────────────────────────────────────────

async function sendViaCustomResend(
  provider: ResolvedEmailProvider,
  params: { to: string; subject: string; html: string; text?: string },
): Promise<SendEmailResult> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: provider.from || `Notifications <onboarding@resend.dev>`,
        to: [params.to],
        subject: params.subject,
        html: params.html,
        ...(params.text ? { text: params.text } : {}),
        ...(provider.replyTo ? { reply_to: provider.replyTo } : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[email-dispatch] custom resend send failed (${res.status}): ${body.slice(0, 300)}`);
      return { success: false, error: `resend_http_${res.status}` };
    }
    const data = (await res.json().catch(() => ({}))) as { id?: string };
    return { success: true, id: data.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[email-dispatch] custom resend send threw:", message);
    return { success: false, error: "custom_provider_network_error" };
  }
}

/** Bookkeeping on the settings row after a custom send. Never throws. */
async function recordCustomSendOutcome(
  sb: Sb,
  provider: ResolvedEmailProvider,
  result: SendEmailResult,
): Promise<void> {
  if (!provider.settingsRowId) return;
  try {
    const nowIso = new Date().toISOString();
    if (result.success) {
      await sb
        .from("workspace_email_provider_settings")
        .update({
          consecutive_failures: 0,
          last_send_status: "sent",
          last_send_at: nowIso,
          last_send_error: null,
          last_send_provider: provider.source,
          updated_at: nowIso,
        })
        .eq("id", provider.settingsRowId);
      return;
    }
    const { data: row } = await sb
      .from("workspace_email_provider_settings")
      .select("consecutive_failures")
      .eq("id", provider.settingsRowId)
      .maybeSingle();
    const failures = (row?.consecutive_failures ?? 0) + 1;
    await sb
      .from("workspace_email_provider_settings")
      .update({
        consecutive_failures: failures,
        last_send_status: "failed",
        last_send_at: nowIso,
        last_send_error: (result.error ?? "unknown").slice(0, 400),
        last_send_provider: provider.source,
        updated_at: nowIso,
      })
      .eq("id", provider.settingsRowId);

    // In-app admin alert once the threshold is crossed (dedupe: only on the
    // exact crossing so ongoing failures don't spam a new alert per email).
    if (failures === FAILURE_ALERT_THRESHOLD && provider.settingsWorkspaceId) {
      await emitProviderFailureAlert(sb, provider.settingsWorkspaceId, failures, result.error ?? "unknown");
    }
  } catch (err: any) {
    console.warn("[email-dispatch] outcome bookkeeping failed (non-fatal):", err?.message ?? err);
  }
}

/** In-app alert to workspace owner + admins about repeated custom-provider failures. */
async function emitProviderFailureAlert(
  sb: Sb,
  workspaceId: string,
  failures: number,
  lastError: string,
): Promise<void> {
  try {
    const admins = new Set<string>();
    const { data: ws } = await sb.from("workspaces").select("owner_id").eq("id", workspaceId).maybeSingle();
    if (ws?.owner_id) admins.add(ws.owner_id);
    const { data: members } = await sb
      .from("workspace_members")
      .select("user_id, role")
      .eq("workspace_id", workspaceId)
      .in("role", ["owner", "admin"]);
    for (const m of members ?? []) admins.add(m.user_id);
    if (admins.size === 0) return;
    const rows = Array.from(admins).map((uid) => ({
      workspace_id: workspaceId,
      event_key: "email_provider_failing",
      channel: "in_app",
      recipient_user_id: uid,
      title: "Custom email provider is failing",
      message:
        `Your custom email provider has failed ${failures} times in a row (last error: ${lastError.slice(0, 200)}). ` +
        `Emails are falling back to the WEBEE default sender if fallback is enabled, otherwise they are not being delivered. ` +
        `Check your provider settings in Account Settings → Email.`,
      severity: "critical",
      delivery_status: "sent",
      sent_at: new Date().toISOString(),
    }));
    await sb.from("workspace_notifications").insert(rows);
  } catch (err: any) {
    console.warn("[email-dispatch] failure alert emit failed (non-fatal):", err?.message ?? err);
  }
}

export interface WorkspaceEmailParams {
  workspaceId: string | null | undefined;
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface WorkspaceEmailResult extends SendEmailResult {
  /** which provider actually delivered (or attempted last) */
  providerUsed: "workspace_custom" | "parent_custom" | "platform_default";
  /** true when the custom provider failed and the platform default was used */
  fellBack: boolean;
}

/**
 * Send a workspace-scoped automated email through the effective provider.
 * NEVER throws. Custom-provider failures fall back to the platform default
 * when the settings row allows it.
 */
export async function sendWorkspaceEmail(
  sb: Sb,
  params: WorkspaceEmailParams,
): Promise<WorkspaceEmailResult> {
  const provider = await resolveWorkspaceEmailProvider(sb, params.workspaceId);

  if (provider.source === "platform_default" || !provider.apiKey) {
    const result = await sendResendEmail({
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text,
    });
    return { ...result, providerUsed: "platform_default", fellBack: false };
  }

  const result = await sendViaCustomResend(provider, params);
  await recordCustomSendOutcome(sb, provider, result);
  if (result.success) {
    return { ...result, providerUsed: provider.source, fellBack: false };
  }

  if (provider.fallbackToPlatform) {
    const fallback = await sendResendEmail({
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text,
    });
    return {
      ...fallback,
      error: fallback.success ? undefined : `custom_failed_then_${fallback.error ?? "platform_failed"}`,
      providerUsed: "platform_default",
      fellBack: true,
    };
  }

  return { ...result, providerUsed: provider.source, fellBack: false };
}
