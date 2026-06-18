/**
 * Webuyanyhouse Workspace — campaign server functions.
 *
 * These are the only WeeBespoke API calls that still exist as separate
 * server functions. All other data (leads, CRM contacts) is synced into
 * the WEBEE database via wbah.functions.ts and served by standard WEBEE
 * page server functions.
 *
 * Campaigns from WeeBespoke cannot be stored in the WEBEE campaigns table
 * (different schema), so they are fetched live and displayed as an extra
 * tab in the existing Campaigns page — only for webuyanyhouse workspace users.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import * as api from "./client.server";

// ── Internal: require webuyanyhouse membership + get API token callbacks ───────

async function requireWbahCbs(userId: string) {
  if (!userId) throw new Error("Unauthorized");

  const { data: memberships } = await (supabaseAdmin as any)
    .from("workspace_members")
    .select("workspace_id, workspaces(slug)")
    .eq("user_id", userId);

  const wbahMembership = (memberships ?? []).find(
    (m: any) => m.workspaces?.slug === "webuyanyhouse",
  );

  if (!wbahMembership) {
    throw new Error("Access denied — not a member of the Webuyanyhouse workspace");
  }

  const { data: integration } = await (supabaseAdmin as any)
    .from("enterprise_integrations")
    .select("access_token, refresh_token, status")
    .eq("integration_key", "webespoke_enterprise")
    .eq("client_name", "Webuyanyhouse")
    .maybeSingle();

  if (!integration?.access_token || integration.status !== "connected") {
    throw new Error("WeeBespoke API not connected — contact your administrator");
  }

  const getTokens = async () => ({
    accessToken:  integration.access_token as string,
    refreshToken: (integration.refresh_token ?? "") as string,
  });

  const saveNewAccessToken = async (token: string) => {
    await (supabaseAdmin as any)
      .from("enterprise_integrations")
      .update({ access_token: token })
      .eq("integration_key", "webespoke_enterprise")
      .eq("client_name", "Webuyanyhouse");
  };

  return { getTokens, saveNewAccessToken };
}

// ── Campaigns (live from WeeBespoke API — shown as a tab in /campaigns) ────────

export const getWbahCampaigns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const cbs = await requireWbahCbs(context.userId);
    const res = await api.wbahGetCampaigns(cbs.getTokens, cbs.saveNewAccessToken);
    return Array.isArray(res.data) ? res.data : [];
  });

export const createWbahCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.record(z.string(), z.unknown()).parse(i ?? {}))
  .handler(async ({ context, data }) => {
    const cbs = await requireWbahCbs(context.userId);
    const res = await api.wbahCreateCampaign(data as Record<string, unknown>, cbs.getTokens, cbs.saveNewAccessToken);
    if (!res.ok) throw new Error(res.error ?? "Failed to create campaign");
    return res.data;
  });

export const pauseWbahCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string() }).parse(i ?? {}))
  .handler(async ({ context, data }) => {
    const cbs = await requireWbahCbs(context.userId);
    const res = await api.wbahPauseCampaign(data.id, cbs.getTokens, cbs.saveNewAccessToken);
    if (!res.ok) throw new Error(res.error ?? "Failed to pause campaign");
    return res.data;
  });

export const resumeWbahCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string() }).parse(i ?? {}))
  .handler(async ({ context, data }) => {
    const cbs = await requireWbahCbs(context.userId);
    const res = await api.wbahResumeCampaign(data.id, cbs.getTokens, cbs.saveNewAccessToken);
    if (!res.ok) throw new Error(res.error ?? "Failed to resume campaign");
    return res.data;
  });

export const deleteWbahCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string() }).parse(i ?? {}))
  .handler(async ({ context, data }) => {
    const cbs = await requireWbahCbs(context.userId);
    const res = await api.wbahDeleteCampaign(data.id, cbs.getTokens, cbs.saveNewAccessToken);
    if (!res.ok) throw new Error(res.error ?? "Failed to delete campaign");
    return res.data;
  });

// ── Call Logs — read from synced leads table (workspace-scoped) ───────────────

export const getWbahCallLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // Verify the user has access to the webuyanyhouse workspace
    const { data: memberships } = await (supabaseAdmin as any)
      .from("workspace_members")
      .select("workspace_id, workspaces(id, slug)")
      .eq("user_id", context.userId);

    const wbahMembership = (memberships ?? []).find(
      (m: any) => m.workspaces?.slug === "webuyanyhouse",
    );
    if (!wbahMembership) throw new Error("Access denied");

    const wsId = wbahMembership.workspace_id as string;

    // Leads synced from /call-output-data/get-userCall-lead are stored as call logs
    const { data: rows, error } = await (supabaseAdmin as any)
      .from("leads")
      .select("id, full_name, phone, call_status, sentiment, call_summary, callback_date, created_at, metadata")
      .eq("workspace_id", wsId)
      .order("created_at", { ascending: false })
      .limit(500);

    if (error) throw new Error(error.message);
    return (rows ?? []) as Array<{
      id: string;
      full_name: string | null;
      phone: string | null;
      call_status: string | null;
      sentiment: string | null;
      call_summary: string | null;
      callback_date: string | null;
      created_at: string | null;
      metadata: Record<string, unknown> | null;
    }>;
  });
