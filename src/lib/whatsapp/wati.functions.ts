import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createClient } from "@supabase/supabase-js";

function adminClient() {
  const url = process.env["SUPABASE_URL"]!;
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"]!;
  return createClient(url, key, { auth: { persistSession: false } });
}

function watiBase(tenantId: string) {
  return `https://live-mt-server.wati.io/${tenantId}/api/v1`;
}

async function watiGet(tenantId: string, apiKey: string, path: string) {
  const res = await fetch(`${watiBase(tenantId)}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`WATI API ${path} returned ${res.status}`);
  return res.json();
}

export const getWatiConnection = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const sb = adminClient() as any;
    const { data } = await sb
      .from("wati_connections")
      .select("tenant_id, status, last_tested_at, error_message, updated_at")
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

    return {
      tenantId: data.tenant_id,
      status: data.status as string,
      lastTestedAt: data.last_tested_at as string | null,
      errorMessage: data.error_message as string | null,
      updatedAt: data.updated_at as string,
      lastSync,
    };
  });

export const connectWati = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      apiKey: z.string().min(10),
      tenantId: z.string().min(1),
      webhookSecret: z.string().optional(),
    }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");

    try {
      await watiGet(data.tenantId, data.apiKey, "/getContacts?pageSize=1");
    } catch {
      throw new Error("Could not reach WATI API — check your API key and Tenant ID.");
    }

    const sb = adminClient() as any;
    await sb.from("wati_connections").upsert(
      {
        workspace_id: workspaceId,
        api_key: data.apiKey,
        tenant_id: data.tenantId,
        webhook_secret: data.webhookSecret ?? null,
        status: "connected",
        last_tested_at: new Date().toISOString(),
        error_message: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id" },
    );

    await sb.from("wati_sync_logs").insert({
      workspace_id: workspaceId,
      sync_type: "test",
      status: "success",
      records_synced: 0,
    });

    // Auto-register our inbound webhook with WATI so the user doesn't
    // have to paste the URL in WATI's dashboard manually.
    const domain = process.env.REPLIT_DEV_DOMAIN;
    const origin = domain ? `https://${domain}` : (process.env.VITE_PUBLIC_APP_URL ?? "");
    const webhookUrl = `${origin}/api/webhook/wati-inbound?workspace=${workspaceId}`;
    const webhookResult = await registerWatiWebhook(data.tenantId, data.apiKey, webhookUrl);

    return { ok: true, webhookUrl, ...webhookResult };
  });

/**
 * Register our inbound URL with WATI's webhook configuration API.
 * WATI: POST /api/v1/updateWebhook  body: { webhookUrl }
 */
async function registerWatiWebhook(
  tenantId: string,
  apiKey: string,
  webhookUrl: string,
): Promise<{ webhookRegistered: boolean; webhookNote: string }> {
  try {
    const res = await fetch(`${watiBase(tenantId)}/updateWebhook`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ webhookUrl }),
    });

    if (res.ok) {
      return {
        webhookRegistered: true,
        webhookNote: "Webhook registered automatically in WATI. Inbound messages will flow through WeeBee.",
      };
    }

    const txt = await res.text();
    console.warn("[wati-connect] webhook register failed:", res.status, txt);
    return {
      webhookRegistered: false,
      webhookNote: `WATI connected but auto-webhook failed (${res.status}). Go to WATI Settings → Webhook and paste the URL above manually.`,
    };
  } catch (e) {
    console.error("[wati-connect] webhook register error", e);
    return {
      webhookRegistered: false,
      webhookNote: "WATI connected. Auto-webhook failed — paste the webhook URL in WATI Settings → Webhook manually.",
    };
  }
}

export const registerWatiWebhookFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const sb = adminClient() as any;
    const { data: conn } = await sb
      .from("wati_connections")
      .select("api_key, tenant_id")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (!conn?.api_key || !conn?.tenant_id) {
      throw new Error("WATI not connected — connect it first.");
    }

    const domain = process.env.REPLIT_DEV_DOMAIN;
    const origin = domain ? `https://${domain}` : (process.env.VITE_PUBLIC_APP_URL ?? "");
    const webhookUrl = `${origin}/api/webhook/wati-inbound?workspace=${workspaceId}`;
    const result = await registerWatiWebhook(conn.tenant_id, conn.api_key, webhookUrl);
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
      .select("api_key, tenant_id")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (!conn) throw new Error("No WATI connection found");

    try {
      await watiGet(conn.tenant_id, conn.api_key, "/getContacts?pageSize=1");
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
    const sb = adminClient() as any;

    const { data: conn } = await sb
      .from("wati_connections")
      .select("api_key, tenant_id")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (!conn) throw new Error("No WATI connection");

    let json: any;
    try {
      json = await watiGet(conn.tenant_id, conn.api_key, "/getMessageTemplates");
    } catch (e: any) {
      await sb.from("wati_sync_logs").insert({ workspace_id: workspaceId, sync_type: "templates", status: "error", error_message: e.message });
      throw e;
    }

    const templates = (json?.messageTemplates ?? json?.templates ?? []) as any[];
    let count = 0;
    for (const t of templates) {
      await sb.from("wati_templates").upsert(
        {
          workspace_id: workspaceId,
          wati_template_id: String(t.id ?? t.elementName ?? t.name),
          name: t.elementName ?? t.name ?? "Untitled",
          status: t.status,
          language: t.language,
          category: t.category,
          components: t.components ?? null,
          synced_at: new Date().toISOString(),
        },
        { onConflict: "workspace_id,wati_template_id" },
      );
      count++;
    }

    await sb.from("wati_sync_logs").insert({ workspace_id: workspaceId, sync_type: "templates", status: "success", records_synced: count });
    return { ok: true, count };
  });

export const syncWatiCampaigns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const sb = adminClient() as any;

    const { data: conn } = await sb
      .from("wati_connections")
      .select("api_key, tenant_id")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (!conn) throw new Error("No WATI connection");

    let json: any;
    try {
      json = await watiGet(conn.tenant_id, conn.api_key, "/getBroadcastStats");
    } catch (e: any) {
      await sb.from("wati_sync_logs").insert({ workspace_id: workspaceId, sync_type: "campaigns", status: "error", error_message: e.message });
      throw e;
    }

    const broadcasts = (json?.broadcasts ?? json?.result ?? []) as any[];
    let count = 0;
    for (const b of broadcasts) {
      await sb.from("wati_campaigns").upsert(
        {
          workspace_id: workspaceId,
          wati_campaign_id: String(b.id ?? b.broadcastId),
          name: b.name ?? b.broadcastName ?? "Broadcast",
          status: b.status,
          template_name: b.templateName ?? null,
          broadcast_name: b.broadcastName ?? b.name ?? null,
          sent: b.sent ?? b.total ?? 0,
          delivered: b.delivered ?? 0,
          read_count: b.read ?? b.readCount ?? 0,
          failed: b.failed ?? 0,
          synced_at: new Date().toISOString(),
        },
        { onConflict: "workspace_id,wati_campaign_id" },
      );
      count++;
    }

    await sb.from("wati_sync_logs").insert({ workspace_id: workspaceId, sync_type: "campaigns", status: "success", records_synced: count });
    return { ok: true, count };
  });

export const syncWatiContacts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const sb = adminClient() as any;

    const { data: conn } = await sb
      .from("wati_connections")
      .select("api_key, tenant_id")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (!conn) throw new Error("No WATI connection");

    let json: any;
    try {
      json = await watiGet(conn.tenant_id, conn.api_key, "/getContacts?pageSize=500");
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
