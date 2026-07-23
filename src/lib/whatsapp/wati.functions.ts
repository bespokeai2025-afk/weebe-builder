import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createClient } from "@supabase/supabase-js";
import {
  normalizeWatiApiHost,
  watiApiV1Base,
} from "@/lib/whatsapp/wati-api-base.shared";
import {
  buildWatiCreateTemplatePayload,
  normalizeWatiElementName,
  watiTemplateRowFromCreateResult,
} from "@/lib/whatsapp/wati-template-create.shared";
import {
  maybeAutoSyncWatiCampaigns,
  maybeAutoSyncWatiTemplates,
  syncWatiCampaignsForWorkspace,
  syncWatiTemplatesForWorkspace,
} from "@/lib/whatsapp/wati-sync.server";
import { reconcileWatiOutboundMessageStatuses } from "@/lib/whatsapp/wati-message-status.server";
import {
  buildWatiInboundWebhookUrl,
  registerWatiInboundWebhook,
} from "@/lib/whatsapp/wati-webhook.server";

function adminClient() {
  const url = process.env["SUPABASE_URL"] || process.env["VITE_SUPABASE_URL"];
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key) {
    throw new Error("Server misconfigured: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

type WatiConnRow = {
  api_key: string;
  tenant_id: string;
  api_host: string | null;
};

async function watiGet(
  tenantId: string,
  apiKey: string,
  path: string,
  apiHost?: string | null,
) {
  const res = await fetch(`${watiApiV1Base(tenantId, apiHost)}${path}`, {
    headers: {
      Authorization: `Bearer ${apiKey.replace(/^Bearer\s+/i, "")}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 120).replace(/\s+/g, " ");
    throw new Error(`${path} returned ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  return res.json();
}

async function watiPost(
  tenantId: string,
  apiKey: string,
  path: string,
  body: Record<string, unknown>,
  apiHost?: string | null,
): Promise<{ ok: boolean; status: number; data: Record<string, unknown>; text: string }> {
  const res = await fetch(`${watiApiV1Base(tenantId, apiHost)}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey.replace(/^Bearer\s+/i, "")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* non-json */
  }
  return { ok: res.ok, status: res.status, data, text };
}

export const getWatiConnection = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const sb = adminClient() as any;
    const { data } = await sb
      .from("wati_connections")
      .select(
        "tenant_id, api_host, status, last_tested_at, error_message, updated_at, inbound_webhook_url, webhook_manual",
      )
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (!data) return null;

    const { data: logs } = await sb
      .from("wati_sync_logs")
      .select("sync_type, status, records_synced, created_at")
      .eq("workspace_id", workspaceId)
      .eq("status", "success")
      .order("created_at", { ascending: false })
      .limit(10);

    const lastSync: Record<string, string> = {};
    for (const l of (logs ?? []) as any[]) {
      if (!lastSync[l.sync_type]) lastSync[l.sync_type] = l.created_at;
    }

    const webhookUrl =
      (data.inbound_webhook_url as string | null) || buildWatiInboundWebhookUrl(workspaceId);

    return {
      tenantId: data.tenant_id,
      apiHost: data.api_host as string | null,
      status: data.status as string,
      lastTestedAt: data.last_tested_at as string | null,
      errorMessage: data.error_message as string | null,
      updatedAt: data.updated_at as string,
      lastSync,
      webhookUrl,
      webhookManual: !!data.webhook_manual,
      webhookRegistered: !!data.webhook_manual,
    };
  });

export const connectWati = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      apiKey: z.string().min(10),
      tenantId: z.string().min(1),
      apiHost: z.string().optional(),
      webhookSecret: z.string().optional(),
    }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");

    const apiHost = normalizeWatiApiHost(data.apiHost);

    try {
      await watiGet(data.tenantId, data.apiKey, "/getContacts?pageSize=1", apiHost);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(
        msg.includes("WATI API")
          ? `Could not reach WATI API — ${msg.replace(/^WATI API /, "")}`
          : "Could not reach WATI API — check your API key and Tenant ID.",
      );
    }

    const sb = adminClient() as any;
    const { error: upsertErr } = await sb.from("wati_connections").upsert(
      {
        workspace_id: workspaceId,
        api_key: data.apiKey,
        tenant_id: data.tenantId,
        api_host: apiHost,
        webhook_secret: data.webhookSecret ?? null,
        status: "connected",
        last_tested_at: new Date().toISOString(),
        error_message: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id" },
    );
    if (upsertErr) {
      throw new Error(`Could not save WATI connection: ${upsertErr.message}`);
    }

    await sb.from("wati_sync_logs").insert({
      workspace_id: workspaceId,
      sync_type: "test",
      status: "success",
      records_synced: 0,
    });

    // Auto-register our inbound webhook with WATI so the user doesn't
    // have to paste the URL in WATI's dashboard manually.
    const webhookUrl = buildWatiInboundWebhookUrl(workspaceId);
    const webhookResult = await registerWatiInboundWebhook(
      { tenantId: data.tenantId, apiKey: data.apiKey, apiHost },
      webhookUrl,
    );

    await sb
      .from("wati_connections")
      .update({
        inbound_webhook_url: webhookUrl,
        webhook_manual: webhookResult.webhookManual,
        updated_at: new Date().toISOString(),
      })
      .eq("workspace_id", workspaceId);

    return { ok: true, webhookUrl, ...webhookResult };
  });

export const confirmWatiWebhookManual = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const sb = adminClient() as any;
    const webhookUrl = buildWatiInboundWebhookUrl(workspaceId);

    const { error } = await sb
      .from("wati_connections")
      .update({
        inbound_webhook_url: webhookUrl,
        webhook_manual: true,
        updated_at: new Date().toISOString(),
      })
      .eq("workspace_id", workspaceId)
      .eq("status", "connected");

    if (error) throw new Error(error.message);

    return {
      ok: true,
      webhookUrl,
      webhookRegistered: true,
      webhookManual: true,
      webhookNote:
        "Manual webhook setup confirmed. WATI will send inbound and delivery events to Webee.",
    };
  });

export const registerWatiWebhookFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const sb = adminClient() as any;
    const { data: conn } = await sb
      .from("wati_connections")
      .select("api_key, tenant_id, api_host, webhook_manual")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (!conn?.api_key || !conn?.tenant_id) {
      throw new Error("WATI not connected — connect it first.");
    }

    const webhookUrl = buildWatiInboundWebhookUrl(workspaceId);
    const result = await registerWatiInboundWebhook(
      { tenantId: conn.tenant_id, apiKey: conn.api_key, apiHost: conn.api_host },
      webhookUrl,
      { manualAlreadyConfigured: !!conn.webhook_manual },
    );

    await sb
      .from("wati_connections")
      .update({
        inbound_webhook_url: webhookUrl,
        webhook_manual: result.webhookManual || !!conn.webhook_manual,
        updated_at: new Date().toISOString(),
      })
      .eq("workspace_id", workspaceId);

    return { webhookUrl, ...result };
  });

export const disconnectWati = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const sb = adminClient() as any;
    await sb.from("wati_connections").delete().eq("workspace_id", workspaceId);
    return { ok: true };
  });

export const testWatiConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const sb = adminClient() as any;

    const { data: conn } = await sb
      .from("wati_connections")
      .select("api_key, tenant_id, api_host")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (!conn) throw new Error("No WATI connection found");

    try {
      await watiGet(conn.tenant_id, conn.api_key, "/getContacts?pageSize=1", conn.api_host);
      await sb.from("wati_connections").update({
        status: "connected",
        last_tested_at: new Date().toISOString(),
        error_message: null,
      }).eq("workspace_id", workspaceId);

      await sb.from("wati_sync_logs").insert({
        workspace_id: workspaceId,
        sync_type: "test",
        status: "success",
        records_synced: 0,
      });

      return { ok: true, status: "connected" };
    } catch (e: any) {
      await sb.from("wati_connections").update({
        status: "error",
        error_message: e.message,
      }).eq("workspace_id", workspaceId);

      await sb.from("wati_sync_logs").insert({
        workspace_id: workspaceId,
        sync_type: "test",
        status: "error",
        records_synced: 0,
        error_message: e.message,
      });

      throw new Error(`WATI connection test failed: ${e.message}`);
    }
  });

export const syncWatiTemplates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    try {
      const count = await syncWatiTemplatesForWorkspace(workspaceId);
      return { ok: true, count };
    } catch (e: any) {
      const sb = adminClient() as any;
      await sb.from("wati_sync_logs").insert({
        workspace_id: workspaceId,
        sync_type: "templates",
        status: "error",
        error_message: e.message,
      });
      throw e;
    }
  });

/** Create + submit template to WATI (Meta review via WATI). */
export const createWatiTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        elementName: z.string().min(1).max(80),
        body: z.string().min(1).max(1024),
        category: z.enum(["MARKETING", "UTILITY", "AUTHENTICATION"]),
        language: z.string().min(2).max(10).optional(),
        footer: z.string().max(60).optional(),
        paramSamples: z.record(z.string()).optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const sb = adminClient() as any;

    const { data: conn } = await sb
      .from("wati_connections")
      .select("api_key, tenant_id, api_host")
      .eq("workspace_id", workspaceId)
      .eq("status", "connected")
      .maybeSingle();

    if (!conn?.api_key) throw new Error("WATI not connected");

    const elementName = normalizeWatiElementName(data.elementName);
    if (!elementName) {
      throw new Error("Template name must use letters, numbers, and underscores only");
    }

    let payload: Record<string, unknown>;
    try {
      payload = buildWatiCreateTemplatePayload({
        elementName,
        body: data.body,
        category: data.category,
        language: data.language,
        footer: data.footer,
        paramSamples: data.paramSamples,
      });
    } catch (e) {
      throw new Error((e as Error).message);
    }

    const { ok, status, data: json, text } = await watiPost(
      conn.tenant_id,
      conn.api_key,
      "/whatsApp/templates",
      payload,
      conn.api_host,
    );

    if (!ok) {
      const msg = String(json.message ?? json.error ?? json.info ?? text).slice(0, 400);
      throw new Error(msg || `WATI create template failed (HTTP ${status})`);
    }

    if (json.ok === false) {
      throw new Error(String(json.message ?? json.error ?? "WATI rejected template creation").slice(0, 400));
    }

    const result = (json.result ?? json) as Record<string, unknown>;
    const row = watiTemplateRowFromCreateResult(workspaceId, {
      ...result,
      elementName: result.elementName ?? elementName,
      body: result.body ?? data.body,
      category: result.category ?? data.category,
      language: result.language ?? data.language ?? "en",
    });

    const { data: saved, error: upsertErr } = await sb
      .from("wati_templates")
      .upsert(row, { onConflict: "workspace_id,wati_template_id" })
      .select()
      .single();

    if (upsertErr) throw new Error(upsertErr.message);

    await sb.from("wati_sync_logs").insert({
      workspace_id: workspaceId,
      sync_type: "templates",
      status: "success",
      records_synced: 1,
    });

    const statusCode = row.status_code as number | null;
    const statusLabel =
      statusCode === 1 || statusCode === 5
        ? "pending"
        : statusCode === 2
          ? "approved"
          : statusCode === 0
            ? "draft"
            : "submitted";

    return {
      ok: true,
      template: saved,
      status: statusLabel,
      message:
        statusCode === 0
          ? "Template created in WATI as draft — submit for Meta review in WATI if it stays in Draft."
          : "Template submitted to WATI for Meta review (typically 30 min – 24 hours).",
    };
  });

export const syncWatiCampaigns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    try {
      const count = await syncWatiCampaignsForWorkspace(workspaceId);
      let statusUpdated = 0;
      try {
        statusUpdated = await reconcileWatiOutboundMessageStatuses(workspaceId);
      } catch {
        /* optional */
      }
      return { ok: true, count, statusUpdated };
    } catch (e: any) {
      const sb = adminClient() as any;
      await sb.from("wati_sync_logs").insert({
        workspace_id: workspaceId,
        sync_type: "campaigns",
        status: "error",
        error_message: e.message,
      });
      throw e;
    }
  });

export const syncWatiContacts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const sb = adminClient() as any;

    const { data: conn } = await sb
      .from("wati_connections")
      .select("api_key, tenant_id, api_host")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (!conn) throw new Error("No WATI connection");

    let json: any;
    try {
      json = await watiGet(conn.tenant_id, conn.api_key, "/getContacts?pageSize=500", conn.api_host);
    } catch (e: any) {
      await sb.from("wati_sync_logs").insert({ workspace_id: workspaceId, sync_type: "contacts", status: "error", error_message: e.message });
      throw e;
    }

    const contacts = (json?.contact_list ?? json?.contacts ?? []) as any[];
    let count = 0;
    for (const c of contacts) {
      const phone = c.wAid ?? c.phone ?? c.whatsappNumber;
      if (!phone) continue;
      await sb.from("wati_contacts").upsert(
        {
          workspace_id: workspaceId,
          wati_contact_id: String(c.id ?? c.wAid ?? phone),
          phone,
          name: c.name ?? c.fullName ?? null,
          tags: c.tags ?? [],
          opted_in: c.optedIn ?? false,
          synced_at: new Date().toISOString(),
        },
        { onConflict: "workspace_id,wati_contact_id" },
      );

      await sb.from("whatsapp_contacts").upsert(
        {
          workspace_id: workspaceId,
          phone,
          name: c.name ?? c.fullName ?? null,
          source: "wati",
          tags: c.tags ?? [],
        },
        { onConflict: "workspace_id,phone" },
      );
      count++;
    }

    await sb.from("wati_sync_logs").insert({ workspace_id: workspaceId, sync_type: "contacts", status: "success", records_synced: count });
    return { ok: true, count };
  });

export const listWatiTemplates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    await maybeAutoSyncWatiTemplates(workspaceId);
    const sb = adminClient() as any;
    const { data } = await sb
      .from("wati_templates")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("name");
    return (data ?? []) as any[];
  });

export const listWatiCampaigns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    await maybeAutoSyncWatiCampaigns(workspaceId);
    const sb = adminClient() as any;
    const { data } = await sb
      .from("wati_campaigns")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("synced_at", { ascending: false });
    return (data ?? []) as any[];
  });

export const listWatiContacts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const sb = adminClient() as any;
    const { data } = await sb
      .from("wati_contacts")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("name");
    return (data ?? []) as any[];
  });
