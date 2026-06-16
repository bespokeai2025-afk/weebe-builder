import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildScopedView } from "./registry";
import { getProviderUsage, getProviderUsageLast30Days, upsertProviderSetting } from "./usage.server";
import { runProviderHealthCheck, runAllProviderHealthChecks } from "./health.server";
import type { RegistryEntry } from "./registry";

export type ProviderUsageStat = {
  requests: number;
  errors: number;
  errorRatePct: number;
  totalCostUsd: number;
  avgLatencyMs: number;
  lastUsedAt: string | null;
};

export type ProviderHealthSummary = {
  category: string;
  providers: Array<RegistryEntry & {
    requests: number;
    errors: number;
    totalCostUsd: number;
    totalDurationMs: number;
    lastUsedAt: string | null;
  }>;
  connectedCount: number;
  totalCount: number;
  totalSpend: number;
};

export const getProviderRegistryData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{
    byCategory: Record<string, ProviderHealthSummary>;
    totalSpend: number;
    totalConnected: number;
    totalProviders: number;
    recentErrors: number;
  }> => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    // Load DB-persisted provider settings (optional — table may not exist yet)
    let dbSettings: any[] = [];
    try {
      const { data } = await sb
        .from("provider_settings")
        .select("provider_name, provider_category, status, is_default, is_fallback, priority")
        .eq("workspace_id", workspaceId);
      dbSettings = data ?? [];
    } catch {}

    // Derive "connected" status from existing workspace_settings columns so the page
    // reflects real integration state without requiring the migration to be applied first.
    const { data: ws } = await sb
      .from("workspace_settings")
      .select("retell_workspace_id, elevenlabs_api_key, openai_api_key, calcom_api_key, twilio_account_sid, twilio_auth_token, hubspot_api_key, ghl_api_key, resend_api_key")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    const watiConn = await sb
      .from("wati_connections")
      .select("tenant_id, status")
      .eq("workspace_id", workspaceId)
      .maybeSingle()
      .then((r: any) => r.data);

    // Build a set of providers the DB explicitly marks as connected
    // (from saveProviderCredentials / testProviderConnection) so that
    // per-workspace credential saves aren't overridden by missing env vars.
    const dbConnectedSet = new Set(
      dbSettings
        .filter(r => r.status === "connected")
        .map(r => `${r.provider_category}:${r.provider_name}`),
    );

    // For every provider, OR with dbConnectedSet so that credentials saved through
    // the credential form (which sets status="connected" in provider_settings) are
    // treated as connected even when the legacy workspace_settings column is absent.
    // DB health status is authoritative: if the user ran "Test Connection" and it
    // succeeded, we must not silently downgrade back to disconnected.
    const derivedConnected: Record<string, boolean> = {
      "llm:openai":        !!(ws?.openai_api_key || process.env.OPENAI_API_KEY)  || dbConnectedSet.has("llm:openai"),
      "llm:gemini":        !!(process.env.GEMINI_API_KEY)                        || dbConnectedSet.has("llm:gemini"),
      "llm:claude":        !!(process.env.ANTHROPIC_API_KEY)                     || dbConnectedSet.has("llm:claude"),
      "llm:openrouter":    dbConnectedSet.has("llm:openrouter"),
      "voice:retell":      !!(ws?.retell_workspace_id || process.env.RETELL_API_KEY) || dbConnectedSet.has("voice:retell"),
      "voice:openai":      !!(ws?.openai_api_key || process.env.OPENAI_API_KEY)      || dbConnectedSet.has("voice:openai"),
      "voice:elevenlabs":  !!(ws?.elevenlabs_api_key || process.env.ELEVENLABS_API_KEY) || dbConnectedSet.has("voice:elevenlabs"),
      "telephony:twilio":  !!(ws?.twilio_account_sid && ws?.twilio_auth_token)       || dbConnectedSet.has("telephony:twilio"),
      "telephony:frejun":  dbConnectedSet.has("telephony:frejun"),
      "whatsapp:wati":     !!(watiConn?.status === "active"),
      "whatsapp:twilio":   !!(ws?.twilio_account_sid && ws?.twilio_auth_token)       || dbConnectedSet.has("whatsapp:twilio"),
      "whatsapp:meta":     dbConnectedSet.has("whatsapp:meta"),
      "email:resend":      !!(ws?.resend_api_key || process.env.RESEND_API_KEY)      || dbConnectedSet.has("email:resend"),
      "email:sendgrid":    dbConnectedSet.has("email:sendgrid"),
      "crm:hubspot":       !!(ws?.hubspot_api_key)                                   || dbConnectedSet.has("crm:hubspot"),
      "crm:gohighlevel":   !!(ws?.ghl_api_key)                                       || dbConnectedSet.has("crm:gohighlevel"),
      "calendar:calcom":   !!(ws?.calcom_api_key)                                     || dbConnectedSet.has("calendar:calcom"),
      "calendar:google":   dbConnectedSet.has("calendar:google"),
      "knowledge:retell_kb": !!(ws?.retell_workspace_id || process.env.RETELL_API_KEY) || dbConnectedSet.has("knowledge:retell_kb"),
      "knowledge:pinecone":  dbConnectedSet.has("knowledge:pinecone"),
      "image:gpt_image":   !!(ws?.openai_api_key || process.env.OPENAI_API_KEY)      || dbConnectedSet.has("image:gpt_image"),
      "image:imagen":      dbConnectedSet.has("image:imagen"),
      "video:runway":      dbConnectedSet.has("video:runway"),
      "video:google_veo":  dbConnectedSet.has("video:google_veo"),
      "analytics:google_analytics": dbConnectedSet.has("analytics:google_analytics"),
      "advertising:google_ads":     dbConnectedSet.has("advertising:google_ads"),
      "advertising:meta_ads":       dbConnectedSet.has("advertising:meta_ads"),
    };

    // Build a per-request scoped view — never mutates the global REGISTRY
    const allProviders = buildScopedView(dbSettings, derivedConnected);

    // Usage data (fails gracefully if table doesn't exist yet)
    const usageRows = await getProviderUsage(workspaceId);
    const usageMap = new Map(usageRows.map(r => [`${r.provider_category}:${r.provider_name}`, r]));

    const result: Record<string, ProviderHealthSummary> = {};
    let totalSpend = 0;
    let totalConnected = 0;
    let totalProviders = 0;
    let recentErrors = 0;

    for (const [cat, entries] of Object.entries(allProviders)) {
      let catSpend = 0;
      let catConnected = 0;

      const withUsage = entries.map(entry => {
        const key = `${cat}:${entry.name}`;
        const usage = usageMap.get(key);
        if (entry.status === "connected") catConnected++;
        const spend = Number(usage?.total_cost_usd ?? 0);
        catSpend += spend;
        if (usage?.errors) recentErrors += usage.errors;

        return {
          ...entry,
          requests: usage?.requests ?? 0,
          errors: usage?.errors ?? 0,
          totalCostUsd: spend,
          totalDurationMs: usage?.total_duration_ms ?? 0,
          lastUsedAt: usage?.last_used_at ?? null,
        };
      });

      totalSpend += catSpend;
      totalConnected += catConnected;
      totalProviders += entries.length;

      result[cat] = {
        category: cat,
        providers: withUsage,
        connectedCount: catConnected,
        totalCount: entries.length,
        totalSpend: catSpend,
      };
    }

    // Fire-and-forget background health refresh so subsequent loads of the
    // registry page reflect live adapter healthCheck() results persisted to
    // provider_settings.status. Does NOT block the response.
    runAllProviderHealthChecks(workspaceId).catch(() => {});

    return { byCategory: result, totalSpend, totalConnected, totalProviders, recentErrors };
  });

// ── Query: per-provider usage stats (requests, cost, error rate, avg latency) ──

export const getProviderUsageStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Record<string, ProviderUsageStat>> => {
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    // Primary source: 30-day window from the time-series log table.
    // Falls back to an empty array if the migration hasn't been applied yet.
    const logRows = await getProviderUsageLast30Days(workspaceId, 30);

    // Secondary source: all-time aggregates, used only for `lastUsedAt` metadata.
    const allTimeRows = await getProviderUsage(workspaceId);
    const lastUsedMap = new Map(allTimeRows.map(r => [
      `${r.provider_category}:${r.provider_name}`,
      r.last_used_at,
    ]));

    const result: Record<string, ProviderUsageStat> = {};

    // If the log table is populated, use 30-day data exclusively.
    // When the log table is empty (pre-migration or new workspace), fall back
    // to all-time totals so the UI is never blank for workspaces with data.
    const rows = logRows.length > 0 ? logRows : allTimeRows;

    for (const row of rows) {
      const key = `${row.provider_category}:${row.provider_name}`;
      const req = row.requests ?? 0;
      const err = row.errors ?? 0;
      result[key] = {
        requests:     req,
        errors:       err,
        errorRatePct: req > 0 ? (err / req) * 100 : 0,
        totalCostUsd: Number(row.total_cost_usd ?? 0),
        avgLatencyMs: req > 0 ? Math.round((row.total_duration_ms ?? 0) / req) : 0,
        lastUsedAt:   lastUsedMap.get(key) ?? null,
      };
    }

    return result;
  });

// ── Shared helper: enforce workspace owner/admin ───────────────────────────────

async function requireWorkspaceAdmin(
  supabase: any,
  userId: string,
  workspaceId: string,
): Promise<void> {
  const { data } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();

  const role: string | undefined = data?.role;
  if (role !== "owner" && role !== "admin") {
    throw new Error("Forbidden: only workspace owners and admins can change provider settings.");
  }
}

// ── Mutation: set a provider as Primary or Fallback (or clear) ─────────────────

const UpdatePriorityInput = z.object({
  category: z.string().min(1),
  providerName: z.string().min(1),
  role: z.enum(["primary", "fallback", "none"]),
});

export const updateProviderPriority = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: z.infer<typeof UpdatePriorityInput>) => UpdatePriorityInput.parse(i))
  .handler(async ({ data, context }) => {
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    await requireWorkspaceAdmin(context.supabase, context.userId, workspaceId);

    const { category, providerName, role } = data;
    const sb = context.supabase as any;

    // If setting a new primary, demote any existing primary in this category
    if (role === "primary") {
      try {
        await sb
          .from("provider_settings")
          .update({ is_default: false })
          .eq("workspace_id", workspaceId)
          .eq("provider_category", category)
          .eq("is_default", true);
      } catch {}
    }

    // If setting a new fallback, demote any existing fallback in this category
    if (role === "fallback") {
      try {
        await sb
          .from("provider_settings")
          .update({ is_fallback: false })
          .eq("workspace_id", workspaceId)
          .eq("provider_category", category)
          .eq("is_fallback", true);
      } catch {}
    }

    await upsertProviderSetting({
      workspaceId,
      category,
      providerName,
      isDefault: role === "primary",
      isFallback: role === "fallback",
      priority: role === "primary" ? 1 : role === "fallback" ? 2 : 99,
    });
  });

// ── Mutation: save provider credentials ───────────────────────────────────────

const SaveCredentialsInput = z.object({
  category:     z.string().min(1),
  providerName: z.string().min(1),
  credentials:  z.record(z.string()),
});

export const saveProviderCredentials = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: z.infer<typeof SaveCredentialsInput>) => SaveCredentialsInput.parse(i))
  .handler(async ({ data, context }) => {
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    await requireWorkspaceAdmin(context.supabase, context.userId, workspaceId);

    const sb = context.supabase as any;
    const { category, providerName, credentials } = data;

    // Determine connected status: at least one non-empty credential value
    const hasCredentials = Object.values(credentials).some(v => v && v.trim().length > 0);

    await upsertProviderSetting({
      workspaceId,
      category,
      providerName,
      status: hasCredentials ? "connected" : "disconnected",
      credentials,
    });

    // ── Bridge credentials to workspace_settings / legacy tables ─────────────
    // The runtime reads from workspace_settings columns (not provider_settings.credentials),
    // so we must mirror the key values there too whenever they are saved here.
    const wsUpdate: Record<string, string> = {};
    const key = `${category}:${providerName}`;

    if (key === "llm:openai" && credentials.apiKey)
      wsUpdate.openai_api_key = credentials.apiKey;

    if (key === "voice:openai" && credentials.apiKey)
      wsUpdate.openai_api_key = credentials.apiKey;

    if (key === "image:gpt_image" && credentials.apiKey)
      wsUpdate.openai_api_key = credentials.apiKey;

    if (key === "voice:retell" && credentials.apiKey)
      wsUpdate.retell_workspace_id = credentials.apiKey;

    if (key === "voice:elevenlabs" && credentials.apiKey)
      wsUpdate.elevenlabs_api_key = credentials.apiKey;

    if ((key === "telephony:twilio" || key === "whatsapp:twilio")) {
      if (credentials.accountSid) wsUpdate.twilio_account_sid = credentials.accountSid;
      if (credentials.authToken)  wsUpdate.twilio_auth_token  = credentials.authToken;
    }

    if (key === "email:resend" && credentials.apiKey)
      wsUpdate.resend_api_key = credentials.apiKey;

    if (key === "crm:hubspot" && credentials.apiKey)
      wsUpdate.hubspot_api_key = credentials.apiKey;

    if (key === "crm:gohighlevel" && credentials.apiKey)
      wsUpdate.ghl_api_key = credentials.apiKey;

    if (key === "calendar:calcom" && credentials.apiKey)
      wsUpdate.calcom_api_key = credentials.apiKey;

    if (Object.keys(wsUpdate).length > 0) {
      await sb.from("workspace_settings").upsert(
        { workspace_id: workspaceId, ...wsUpdate, updated_at: new Date().toISOString() },
        { onConflict: "workspace_id" },
      ).catch(() => {/* graceful — column may not exist yet */});
    }

    // ── WATI uses a dedicated table, not workspace_settings ───────────────────
    if (key === "whatsapp:wati" && credentials.apiKey && credentials.tenantId) {
      await sb.from("wati_connections").upsert(
        {
          workspace_id:   workspaceId,
          api_key:        credentials.apiKey,
          tenant_id:      credentials.tenantId,
          webhook_secret: credentials.webhookSecret ?? null,
          status:         "connected",
          updated_at:     new Date().toISOString(),
        },
        { onConflict: "workspace_id" },
      ).catch(() => {/* graceful — table may not exist yet */});
    }

    return { ok: true };
  });

// ── Query: test a provider connection live ────────────────────────────────────

const TestConnectionInput = z.object({
  category:     z.string().min(1),
  providerName: z.string().min(1),
});

export const testProviderConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: z.infer<typeof TestConnectionInput>) => TestConnectionInput.parse(i))
  .handler(async ({ data, context }): Promise<{ ok: boolean; latencyMs: number; error?: string }> => {
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    await requireWorkspaceAdmin(context.supabase, context.userId, workspaceId);

    const { category, providerName } = data;
    return runProviderHealthCheck(workspaceId, category, providerName);
  });

// ── Mutation: refresh all provider health statuses ────────────────────────────

export const refreshAllProviderHealth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ checked: number; passed: number; failed: number }> => {
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    await requireWorkspaceAdmin(context.supabase, context.userId, workspaceId);

    return runAllProviderHealthChecks(workspaceId);
  });

// ── Mutation: enable / disable a provider ─────────────────────────────────────

const ToggleEnabledInput = z.object({
  category: z.string().min(1),
  providerName: z.string().min(1),
  enabled: z.boolean(),
});

export const toggleProviderEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: z.infer<typeof ToggleEnabledInput>) => ToggleEnabledInput.parse(i))
  .handler(async ({ data, context }) => {
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    await requireWorkspaceAdmin(context.supabase, context.userId, workspaceId);

    await upsertProviderSetting({
      workspaceId,
      category: data.category,
      providerName: data.providerName,
      status: data.enabled ? "connected" : "disconnected",
    });
  });
