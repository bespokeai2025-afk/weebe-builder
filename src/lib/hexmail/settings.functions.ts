import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type HexmailProvider = "sendgrid" | "resend" | "postmark";

export interface HexmailSettings {
  activeProvider: HexmailProvider | null;
  sendgrid: { apiKey: string; fromEmail: string; fromName: string };
  resend:   { apiKey: string; fromEmail: string; fromName: string };
  postmark: { serverToken: string; fromEmail: string; fromName: string };
}

const COLS = [
  "hexmail_active_provider",
  "hexmail_sendgrid_api_key",
  "hexmail_sendgrid_from_email",
  "hexmail_sendgrid_from_name",
  "hexmail_resend_api_key",
  "hexmail_resend_from_email",
  "hexmail_resend_from_name",
  "hexmail_postmark_server_token",
  "hexmail_postmark_from_email",
  "hexmail_postmark_from_name",
] as const;

export const getHexmailSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const sb = supabase as any;
    const { data } = await sb
      .from("workspace_settings")
      .select(COLS.join(", "))
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    const r = data ?? {};
    return {
      activeProvider: (r.hexmail_active_provider as HexmailProvider | null) ?? null,
      sendgrid: {
        apiKey:    (r.hexmail_sendgrid_api_key    as string) ?? "",
        fromEmail: (r.hexmail_sendgrid_from_email as string) ?? "",
        fromName:  (r.hexmail_sendgrid_from_name  as string) ?? "",
      },
      resend: {
        apiKey:    (r.hexmail_resend_api_key    as string) ?? "",
        fromEmail: (r.hexmail_resend_from_email as string) ?? "",
        fromName:  (r.hexmail_resend_from_name  as string) ?? "",
      },
      postmark: {
        serverToken: (r.hexmail_postmark_server_token as string) ?? "",
        fromEmail:   (r.hexmail_postmark_from_email   as string) ?? "",
        fromName:    (r.hexmail_postmark_from_name    as string) ?? "",
      },
    } as HexmailSettings;
  });

export const saveHexmailSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        activeProvider: z.enum(["sendgrid", "resend", "postmark"]).nullable(),
        sendgrid: z.object({
          apiKey:    z.string(),
          fromEmail: z.string(),
          fromName:  z.string(),
        }),
        resend: z.object({
          apiKey:    z.string(),
          fromEmail: z.string(),
          fromName:  z.string(),
        }),
        postmark: z.object({
          serverToken: z.string(),
          fromEmail:   z.string(),
          fromName:    z.string(),
        }),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const sb = supabase as any;
    const { error } = await sb.from("workspace_settings").upsert(
      {
        workspace_id:                    workspaceId,
        hexmail_active_provider:         data.activeProvider,
        hexmail_sendgrid_api_key:        data.sendgrid.apiKey    || null,
        hexmail_sendgrid_from_email:     data.sendgrid.fromEmail || null,
        hexmail_sendgrid_from_name:      data.sendgrid.fromName  || null,
        hexmail_resend_api_key:          data.resend.apiKey      || null,
        hexmail_resend_from_email:       data.resend.fromEmail   || null,
        hexmail_resend_from_name:        data.resend.fromName    || null,
        hexmail_postmark_server_token:   data.postmark.serverToken || null,
        hexmail_postmark_from_email:     data.postmark.fromEmail   || null,
        hexmail_postmark_from_name:      data.postmark.fromName    || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id" },
    );
    if (error) throw new Error(error.message);

    // Auto-register Resend webhook when a Resend API key is saved
    let webhookRegistered = false;
    if (data.resend.apiKey) {
      try {
        const { registerResendWebhookForWorkspace } = await import("@/lib/hexmail/deliverability.server");
        const result = await registerResendWebhookForWorkspace(workspaceId);
        webhookRegistered = !!(result as any)?.ok;
      } catch { /* non-fatal — user can register manually from Deliverability */ }
    }

    return { ok: true, webhookRegistered };
  });

export const testHexmailProvider = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        provider: z.enum(["sendgrid", "resend", "postmark"]),
        apiKey:   z.string().min(1),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { provider, apiKey } = data;

    try {
      let res: Response;
      if (provider === "resend") {
        res = await fetch("https://api.resend.com/domains", {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
      } else if (provider === "sendgrid") {
        res = await fetch("https://api.sendgrid.com/v3/user/profile", {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
      } else {
        res = await fetch("https://api.postmarkapp.com/server", {
          headers: {
            "X-Postmark-Server-Token": apiKey,
            Accept: "application/json",
          },
        });
      }

      if (res.ok) return { ok: true, message: "Connection successful" };
      const errText = await res.text().catch(() => res.statusText);
      return { ok: false, message: `API returned ${res.status}: ${errText.slice(0, 120)}` };
    } catch (e: any) {
      return { ok: false, message: e?.message ?? "Connection failed" };
    }
  });
