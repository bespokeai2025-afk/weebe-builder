import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildScopedView } from "./registry";
import { getProviderUsage, upsertProviderSetting } from "./usage.server";
import type { RegistryEntry } from "./registry";

export type ProviderHealthSummary = {
  category: string;
  providers: Array<RegistryEntry & {
    requests: number;
    errors: number;
    totalCostUsd: number;
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

    const derivedConnected: Record<string, boolean> = {
      "llm:openai":        !!(ws?.openai_api_key || process.env.OPENAI_API_KEY),
      "llm:gemini":        !!(process.env.GEMINI_API_KEY),
      "llm:claude":        !!(process.env.ANTHROPIC_API_KEY),
      "voice:retell":      !!(ws?.retell_workspace_id || process.env.RETELL_API_KEY),
      "voice:openai":      !!(ws?.openai_api_key || process.env.OPENAI_API_KEY),
      "voice:elevenlabs":  !!(ws?.elevenlabs_api_key || process.env.ELEVENLABS_API_KEY),
      "telephony:twilio":  !!(ws?.twilio_account_sid && ws?.twilio_auth_token),
      "whatsapp:wati":     !!(watiConn?.status === "active"),
      "email:resend":      !!(ws?.resend_api_key || process.env.RESEND_API_KEY),
      "crm:hubspot":       !!(ws?.hubspot_api_key),
      "crm:gohighlevel":   !!(ws?.ghl_api_key),
      "calendar:calcom":   !!(ws?.calcom_api_key),
      "knowledge:retell_kb": !!(ws?.retell_workspace_id || process.env.RETELL_API_KEY),
      "image:gpt_image":   !!(ws?.openai_api_key || process.env.OPENAI_API_KEY),
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

    return { byCategory: result, totalSpend, totalConnected, totalProviders, recentErrors };
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
