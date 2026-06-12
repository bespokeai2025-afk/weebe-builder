import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const getWorkspaceSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No active workspace");
    const sb = supabase as any;
    const { data, error } = await sb
      .from("workspace_settings")
      .select("*")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { workspaceId, settings: data };
  });

export const saveWorkspaceSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        business_name: z.string().nullable().optional(),
        timezone: z.string().optional(),
        notification_email: z.string().email().nullable().optional().or(z.literal("")),
        retell_default_agent_id: z.string().nullable().optional(),
        calcom_api_key: z.string().nullable().optional(),
        calcom_event_type_id: z.string().nullable().optional(),
        calcom_webhook_secret: z.string().nullable().optional(),
        whatsapp_phone_id: z.string().nullable().optional(),
        twilio_auth_token: z.string().nullable().optional(),
        builder_base_url: z.string().url().nullable().optional().or(z.literal("")),
        builder_api_token: z.string().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No active workspace");
    const sb = supabase as any;

    const payload = {
      workspace_id: workspaceId,
      business_name: data.business_name ?? null,
      timezone: data.timezone ?? "UTC",
      notification_email: data.notification_email || null,
      retell_default_agent_id: data.retell_default_agent_id
        ? data.retell_default_agent_id.replace(/^agents\//, "").trim() || null
        : null,
      calcom_api_key: data.calcom_api_key ?? null,
      calcom_event_type_id: data.calcom_event_type_id ?? null,
      calcom_webhook_secret: data.calcom_webhook_secret ?? null,
      whatsapp_phone_id: data.whatsapp_phone_id ?? null,
      twilio_auth_token: data.twilio_auth_token ?? null,
      builder_base_url: (data.builder_base_url || null) as string | null,
      builder_api_token: data.builder_api_token ?? null,
    };
    const { error } = await sb
      .from("workspace_settings")
      .upsert(payload, { onConflict: "workspace_id" });
    if (error) throw new Error(error.message);

    let calcomWebhook: {
      ok: boolean;
      message: string;
      created: boolean;
      webhookId?: string | number;
    } | null = null;
    if (payload.calcom_api_key) {
      try {
        const { registerCalcomWebhook } =
          await import("@/lib/providers/calcom/webhook-register.server");
        const origin =
          process.env.PUBLIC_SITE_URL?.trim().replace(/\/$/, "") ||
          process.env.PUBLIC_BASE_URL?.trim().replace(/\/$/, "") ||
          (process.env.REPLIT_DEV_DOMAIN
            ? `https://${process.env.REPLIT_DEV_DOMAIN}`
            : "");
        const r = await registerCalcomWebhook({
          workspaceId,
          subscriberUrl: `${origin}/api/public/calcom-webhook/${workspaceId}`,
        });
        calcomWebhook = {
          ok: r.ok,
          message: r.message,
          created: r.created,
          webhookId:
            typeof r.webhookId === "string" || typeof r.webhookId === "number"
              ? r.webhookId
              : undefined,
        };
      } catch (e) {
        console.warn("[saveWorkspaceSettings] calcom webhook register failed", e);
      }
    }
    return { ok: true, calcomWebhook };
  });

export const syncFromBuilder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No active workspace");
    const sb = supabase as any;

    const { data: settings, error: sErr } = await sb
      .from("workspace_settings")
      .select("builder_base_url, builder_api_token")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (sErr) throw new Error(sErr.message);
    const baseUrl = (settings?.builder_base_url ?? "").toString().trim().replace(/\/$/, "");
    const token = (settings?.builder_api_token ?? "").toString().trim();
    if (!baseUrl) throw new Error("Set Builder URL first.");
    if (!token) throw new Error("Set Builder API token first.");

    const url = `${baseUrl}/api/public/integrations/export`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
    } catch (e: any) {
      throw new Error(`Could not reach Builder: ${e?.message ?? "network error"}`);
    }
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Builder responded ${res.status}: ${text.slice(0, 300)}`);
    }
    let body: any;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      throw new Error("Builder returned non-JSON response.");
    }

    const syncedAt = new Date().toISOString();
    const patch: Record<string, unknown> = {
      builder_last_synced_at: syncedAt,
      builder_last_sync_status: "ok",
    };
    const filled: string[] = [];
    const pick = (k: string, v: unknown) => {
      if (typeof v === "string" && v.trim()) {
        patch[k] = v.trim();
        filled.push(k);
      }
    };
    pick("calcom_api_key", body?.calcom?.apiToken ?? body?.calcom_api_key);
    pick("calcom_event_type_id", body?.calcom?.eventTypeId ?? body?.calcom_event_type_id);
    pick("twilio_auth_token", body?.twilio?.authToken ?? body?.twilio_auth_token);
    pick("whatsapp_phone_id", body?.twilio?.phoneId ?? body?.whatsapp_phone_id);
    pick("timezone", body?.timezone);
    pick("business_name", body?.businessName ?? body?.business_name);
    pick("notification_email", body?.notificationEmail ?? body?.notification_email);
    pick("retell_default_agent_id", body?.retellDefaultAgentId ?? body?.retell_default_agent_id);

    const { error: uErr } = await sb
      .from("workspace_settings")
      .update(patch as never)
      .eq("workspace_id", workspaceId);
    if (uErr) throw new Error(uErr.message);

    if (typeof patch.calcom_api_key === "string") {
      try {
        const { registerCalcomWebhook } =
          await import("@/lib/providers/calcom/webhook-register.server");
        const origin =
          process.env.PUBLIC_SITE_URL?.trim().replace(/\/$/, "") ||
          process.env.PUBLIC_BASE_URL?.trim().replace(/\/$/, "") ||
          (process.env.REPLIT_DEV_DOMAIN
            ? `https://${process.env.REPLIT_DEV_DOMAIN}`
            : "");
        await registerCalcomWebhook({
          workspaceId,
          subscriberUrl: `${origin}/api/public/calcom-webhook/${workspaceId}`,
        });
      } catch (e) {
        console.warn("[syncFromBuilder] calcom webhook register failed", e);
      }
    }

    return { ok: true, filled, syncedAt };
  });

export const getElevenLabsKey = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const workspaceId = context.workspaceId;
    if (!workspaceId) return { connected: false, columnMissing: false, masked: null };
    try {
      const { data, error } = await supabaseAdmin
        .from("workspace_settings")
        .select("elevenlabs_api_key" as never)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      const msg = (error as any)?.message ?? "";
      if (msg.includes("column") || msg.includes("does not exist")) {
        return { connected: false, columnMissing: true, masked: null };
      }
      const key = (data as any)?.elevenlabs_api_key ?? null;
      return {
        connected: !!key,
        columnMissing: false,
        masked: key ? `sk_...${String(key).slice(-4)}` : null,
      };
    } catch {
      return { connected: false, columnMissing: true, masked: null };
    }
  });

export const saveElevenLabsApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { key: string }) => input)
  .handler(async ({ context, data }) => {
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No active workspace");
    try {
      const { error } = await supabaseAdmin
        .from("workspace_settings")
        .upsert(
          { workspace_id: workspaceId, elevenlabs_api_key: data.key || null } as never,
          { onConflict: "workspace_id" },
        );
      const msg = (error as any)?.message ?? "";
      if (msg.includes("column") || msg.includes("does not exist")) {
        return { ok: false, columnMissing: true };
      }
      if (error) throw new Error(msg);
      return { ok: true, columnMissing: false };
    } catch (e: any) {
      const msg = e?.message ?? "";
      if (msg.includes("column") || msg.includes("does not exist")) {
        return { ok: false, columnMissing: true };
      }
      throw e;
    }
  });

export const getOpenAiKey = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const workspaceId = context.workspaceId;
    if (!workspaceId) return { connected: false, columnMissing: false, masked: null };
    try {
      const { data, error } = await supabaseAdmin
        .from("workspace_settings")
        .select("openai_api_key" as never)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      const msg = (error as any)?.message ?? "";
      if (msg.includes("column") || msg.includes("does not exist")) {
        return { connected: false, columnMissing: true, masked: null };
      }
      const key = (data as any)?.openai_api_key ?? null;
      return {
        connected: !!key,
        columnMissing: false,
        masked: key ? `sk-...${String(key).slice(-4)}` : null,
      };
    } catch {
      return { connected: false, columnMissing: true, masked: null };
    }
  });

export const saveOpenAiApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { key: string }) => input)
  .handler(async ({ context, data }) => {
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No active workspace");
    try {
      const { error } = await supabaseAdmin
        .from("workspace_settings")
        .upsert(
          { workspace_id: workspaceId, openai_api_key: data.key || null } as never,
          { onConflict: "workspace_id" },
        );
      const msg = (error as any)?.message ?? "";
      if (msg.includes("column") || msg.includes("does not exist")) {
        return { ok: false, columnMissing: true };
      }
      if (error) throw new Error(msg);
      return { ok: true, columnMissing: false };
    } catch (e: any) {
      const msg = e?.message ?? "";
      if (msg.includes("column") || msg.includes("does not exist")) {
        return { ok: false, columnMissing: true };
      }
      throw e;
    }
  });
