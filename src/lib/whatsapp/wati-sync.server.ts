/**
 * WATI → Supabase sync (templates, broadcasts). Used by list/analytics loaders and manual sync.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { watiApiV1Base, watiApiV3Base } from "@/lib/whatsapp/wati-api-base.shared";
import { watiTemplateRowFromApi } from "@/lib/whatsapp/wati-template-status.shared";

export const WATI_AUTO_SYNC_MS = 2 * 60 * 1000;

type WatiConn = {
  api_key: string;
  tenant_id: string;
  api_host: string | null;
};

type WatiCampaignRow = {
  workspace_id: string;
  wati_campaign_id: string;
  name: string;
  status: unknown;
  template_name: string | null;
  broadcast_name: string | null;
  sent: number;
  delivered: number;
  read_count: number;
  failed: number;
  synced_at: string;
};

function sb() {
  return supabaseAdmin as any;
}

function authHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey.replace(/^Bearer\s+/i, "")}`,
    "Content-Type": "application/json",
  };
}

async function watiGetV1(conn: WatiConn, path: string): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${watiApiV1Base(conn.tenant_id, conn.api_host)}${path}`, {
    headers: authHeaders(conn.api_key),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { ok: res.ok, status: res.status, json };
}

async function watiGetV3(conn: WatiConn, path: string): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${watiApiV3Base(conn.tenant_id, conn.api_host)}${path}`, {
    headers: authHeaders(conn.api_key),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { ok: res.ok, status: res.status, json };
}

async function getWatiConn(workspaceId: string): Promise<WatiConn | null> {
  const { data } = await sb()
    .from("wati_connections")
    .select("api_key, tenant_id, api_host, status")
    .eq("workspace_id", workspaceId)
    .eq("status", "connected")
    .maybeSingle();
  if (!data?.api_key || !data?.tenant_id) return null;
  return data as WatiConn;
}

async function shouldAutoSync(
  workspaceId: string,
  syncType: "templates" | "campaigns",
): Promise<boolean> {
  const table = syncType === "templates" ? "wati_templates" : "wati_campaigns";
  const { count } = await sb()
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq("workspace_id", workspaceId);

  if ((count ?? 0) === 0) return true;

  const { data: log } = await sb()
    .from("wati_sync_logs")
    .select("created_at")
    .eq("workspace_id", workspaceId)
    .eq("sync_type", syncType)
    .eq("status", "success")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!log?.created_at) return true;
  return Date.now() - new Date(log.created_at).getTime() > WATI_AUTO_SYNC_MS;
}

export async function syncWatiTemplatesForWorkspace(workspaceId: string): Promise<number> {
  const conn = await getWatiConn(workspaceId);
  if (!conn) return 0;

  const { ok, status, json } = await watiGetV1(conn, "/getMessageTemplates");
  if (!ok) {
    throw new Error(`/getMessageTemplates returned ${status}`);
  }

  const templates = (json.messageTemplates ?? json.templates ?? []) as Record<string, unknown>[];
  let count = 0;
  for (const t of templates) {
    await sb()
      .from("wati_templates")
      .upsert(watiTemplateRowFromApi(workspaceId, t), { onConflict: "workspace_id,wati_template_id" });
    count++;
  }

  await sb().from("wati_sync_logs").insert({
    workspace_id: workspaceId,
    sync_type: "templates",
    status: "success",
    records_synced: count,
  });
  return count;
}

function mapV3Broadcast(
  workspaceId: string,
  broadcast: Record<string, unknown>,
  stats?: Record<string, unknown> | null,
): WatiCampaignRow {
  const id = String(broadcast.id ?? "");
  return {
    workspace_id: workspaceId,
    wati_campaign_id: id,
    name: String(broadcast.name ?? "Broadcast"),
    status: broadcast.status ?? null,
    template_name: broadcast.template_id != null ? String(broadcast.template_id) : null,
    broadcast_name: broadcast.name != null ? String(broadcast.name) : null,
    sent: Number(stats?.total_sent ?? 0),
    delivered: Number(stats?.total_delivered ?? 0),
    read_count: Number(stats?.total_read ?? 0),
    failed: Number(stats?.total_failed ?? 0),
    synced_at: new Date().toISOString(),
  };
}

function mapV1Broadcast(workspaceId: string, b: Record<string, unknown>): WatiCampaignRow {
  return {
    workspace_id: workspaceId,
    wati_campaign_id: String(b.id ?? b.broadcastId),
    name: String(b.name ?? b.broadcastName ?? "Broadcast"),
    status: b.status ?? null,
    template_name: b.templateName != null ? String(b.templateName) : null,
    broadcast_name: b.broadcastName != null ? String(b.broadcastName) : String(b.name ?? null),
    sent: Number(b.sent ?? b.total ?? 0),
    delivered: Number(b.delivered ?? 0),
    read_count: Number(b.read ?? b.readCount ?? 0),
    failed: Number(b.failed ?? 0),
    synced_at: new Date().toISOString(),
  };
}

/** V3: GET /broadcasts + per-broadcast statistics — works on eu-api.wati.io */
async function fetchBroadcastsV3(conn: WatiConn, workspaceId: string): Promise<WatiCampaignRow[] | null> {
  const rows: WatiCampaignRow[] = [];
  let page = 1;
  const pageSize = 100;

  while (page <= 20) {
    const list = await watiGetV3(
      conn,
      `/broadcasts?page_number=${page}&page_size=${pageSize}`,
    );
    if (list.status === 404) return null;
    if (!list.ok) {
      throw new Error(`/broadcasts returned ${list.status}`);
    }

    const broadcasts = (list.json.broadcasts ?? []) as Record<string, unknown>[];
    const total = Number(list.json.total ?? 0);

    for (const b of broadcasts) {
      const id = b.id != null ? String(b.id) : "";
      if (!id) continue;

      let stats: Record<string, unknown> | null = null;
      const detail = await watiGetV3(conn, `/broadcasts/${encodeURIComponent(id)}`);
      if (detail.ok && detail.json.statistics) {
        stats = detail.json.statistics as Record<string, unknown>;
      }

      rows.push(mapV3Broadcast(workspaceId, b, stats));
    }

    if (broadcasts.length < pageSize || rows.length >= total) break;
    page++;
  }

  return rows;
}

/** Legacy V1 — not available on many EU tenants (404). */
async function fetchBroadcastsV1(conn: WatiConn, workspaceId: string): Promise<WatiCampaignRow[] | null> {
  const res = await watiGetV1(conn, "/getBroadcastStats");
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`/getBroadcastStats returned ${res.status}`);
  }

  const broadcasts = (res.json.broadcasts ?? res.json.result ?? []) as Record<string, unknown>[];
  return broadcasts.map((b) => mapV1Broadcast(workspaceId, b));
}

/** Mirror Webee-launched campaign stats when WATI has no broadcast list (API sends only). */
async function syncFromWebeeCampaigns(workspaceId: string): Promise<number> {
  const { data: campaigns } = await sb()
    .from("whatsapp_campaigns")
    .select("id, name, status, stats, wati_template_name, updated_at")
    .eq("workspace_id", workspaceId)
    .eq("provider", "wati");

  let count = 0;
  for (const c of campaigns ?? []) {
    const stats = (c.stats ?? {}) as Record<string, number>;
    if ((stats.sent ?? 0) === 0 && c.status !== "completed") continue;

    await sb()
      .from("wati_campaigns")
      .upsert(
        {
          workspace_id: workspaceId,
          wati_campaign_id: `webee_${c.id}`,
          name: c.name ?? "Webee campaign",
          status: c.status,
          template_name: c.wati_template_name ?? null,
          broadcast_name: c.name ?? null,
          sent: stats.sent ?? 0,
          delivered: stats.delivered ?? 0,
          read_count: stats.read ?? 0,
          failed: stats.failed ?? 0,
          synced_at: new Date().toISOString(),
        },
        { onConflict: "workspace_id,wati_campaign_id" },
      );
    count++;
  }
  return count;
}

export async function syncWatiCampaignsForWorkspace(workspaceId: string): Promise<number> {
  const conn = await getWatiConn(workspaceId);
  if (!conn) return 0;

  let rows: WatiCampaignRow[] | null = null;
  let source = "v3";

  try {
    rows = await fetchBroadcastsV3(conn, workspaceId);
  } catch (e) {
    console.warn("[WATI] V3 broadcast sync failed:", (e as Error).message);
  }

  if (rows === null) {
    source = "v1";
    try {
      rows = await fetchBroadcastsV1(conn, workspaceId);
    } catch (e) {
      console.warn("[WATI] V1 broadcast sync failed:", (e as Error).message);
      rows = null;
    }
  }

  let count = 0;
  if (rows && rows.length > 0) {
    for (const row of rows) {
      await sb()
        .from("wati_campaigns")
        .upsert(row, { onConflict: "workspace_id,wati_campaign_id" });
      count++;
    }
  } else {
    // API template sends may not appear in WATI broadcast list — use Webee campaign stats
    source = "webee";
    count = await syncFromWebeeCampaigns(workspaceId);
  }

  await sb().from("wati_sync_logs").insert({
    workspace_id: workspaceId,
    sync_type: "campaigns",
    status: "success",
    records_synced: count,
    error_message: rows === null && count === 0 ? `Used ${source} fallback (WATI broadcast API unavailable)` : null,
  });

  return count;
}

/** Pull from WATI when cache is empty or older than WATI_AUTO_SYNC_MS. */
export async function maybeAutoSyncWatiTemplates(workspaceId: string): Promise<void> {
  if (!(await shouldAutoSync(workspaceId, "templates"))) return;
  try {
    await syncWatiTemplatesForWorkspace(workspaceId);
  } catch (e) {
    console.warn("[WATI] Auto template sync failed:", (e as Error).message);
  }
}

export async function maybeAutoSyncWatiCampaigns(workspaceId: string): Promise<void> {
  if (!(await shouldAutoSync(workspaceId, "campaigns"))) return;
  try {
    await syncWatiCampaignsForWorkspace(workspaceId);
  } catch (e) {
    console.warn("[WATI] Auto campaign sync failed:", (e as Error).message);
  }
}

/** Always refresh broadcast stats (after campaign launch). */
export async function forceSyncWatiCampaigns(workspaceId: string): Promise<number> {
  try {
    return await syncWatiCampaignsForWorkspace(workspaceId);
  } catch (e) {
    console.warn("[WATI] Force campaign sync failed:", (e as Error).message);
    try {
      return await syncFromWebeeCampaigns(workspaceId);
    } catch {
      return 0;
    }
  }
}
