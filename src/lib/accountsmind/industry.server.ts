// ── AccountsMind industry — server-only logic ────────────────────────────────
// Workspace industry storage + deterministic industry-preset apply. Presets
// are code-owned (industry-presets.shared.ts) and may only reference
// NON-SENSITIVE metric keys from METRIC_REGISTRY — this module re-enforces
// that at apply time (defence-in-depth) so a preset can never expose a
// billing/cost metric to clients. Applying is strictly workspace-scoped:
// workspace_id comes only from the server auth context, and rows are written
// via the same versioned insert chain as approved SystemMind drafts.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { writeSystemMindAudit } from "@/lib/systemmind/systemmind-automation.server";
import {
  INDUSTRY_PRESETS,
  type IndustryPreset,
} from "./industry-presets.shared";

const sbA = () => supabaseAdmin as any;

export async function getWorkspaceIndustryServer(workspaceId: string): Promise<string | null> {
  const { data, error } = await sbA()
    .from("workspace_settings")
    .select("industry")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) {
    console.warn("[accountsmind] industry read failed:", error.message);
    return null;
  }
  const v = (data?.industry ?? "").trim();
  return v && INDUSTRY_PRESETS[v] ? v : v || null;
}

export async function setWorkspaceIndustryServer(
  workspaceId: string,
  industryKey: string,
): Promise<void> {
  if (!INDUSTRY_PRESETS[industryKey]) throw new Error("Unknown industry.");
  const sb = sbA();
  const { error } = await sb
    .from("workspace_settings")
    .upsert(
      { workspace_id: workspaceId, industry: industryKey, updated_at: new Date().toISOString() },
      { onConflict: "workspace_id" },
    );
  if (error) throw new Error(`Failed to save industry: ${error.message}`);

  // Best-effort write-through so GrowthMind's Business DNA stays consistent.
  try {
    const label = INDUSTRY_PRESETS[industryKey].label;
    const { data: dna } = await sb
      .from("growthmind_business_dna")
      .select("id, industry")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (dna && !(dna.industry ?? "").trim()) {
      await sb.from("growthmind_business_dna")
        .update({ industry: label })
        .eq("id", dna.id)
        .eq("workspace_id", workspaceId);
    }
  } catch { /* best-effort only */ }
}

/** Only stats/widgets whose metric is whitelisted AND non-sensitive survive. */
function filterPresetSafe(preset: IndustryPreset, registry: Record<string, { sensitive: boolean }>) {
  const ok = (k: string) => !!registry[k] && !registry[k].sensitive;
  return {
    stats:   preset.stats.filter((s) => ok(s.metric_key)),
    widgets: preset.widgets.filter((w) => ok(w.metric_key)),
  };
}

export async function applyIndustryPresetServer(args: {
  workspaceId: string;
  userId: string | null;
  industryKey: string;
}): Promise<{ statsCreated: number; widgetsCreated: number; industry: string }> {
  const { workspaceId, userId, industryKey } = args;
  if (!workspaceId) throw new Error("workspace_id missing — refusing to apply.");
  const preset = INDUSTRY_PRESETS[industryKey];
  if (!preset) throw new Error("Unknown industry.");

  const { METRIC_REGISTRY } = await import("@/lib/accountsmind/accountsmind-config.server");
  const { stats, widgets } = filterPresetSafe(preset, METRIC_REGISTRY);
  if (stats.length + widgets.length === 0) {
    throw new Error("Industry preset had no valid items after safety filtering.");
  }

  const sb = sbA();

  // Atomic apply: one Postgres RPC wraps archive + versioned insert in a single
  // transaction (migration 20260718000000). If anything fails midway, the
  // previous dashboard is left completely untouched — no half-applied state.
  // The RPC mirrors versionedInsertConfigRow's archive+version chain exactly
  // and is service_role-only; there is deliberately NO row-by-row fallback
  // here (a fallback would reintroduce the half-apply failure mode).
  const { data: rpcResult, error: rpcError } = await sb.rpc(
    "apply_accountsmind_industry_preset",
    {
      p_workspace_id: workspaceId,
      p_created_by:   userId,
      p_stats: stats.map((s) => ({
        stat_key:    s.stat_key,
        label:       s.label,
        metric_key:  s.metric_key,
        format:      s.format,
        description: s.description,
      })),
      p_widgets: widgets.map((w) => ({
        widget_key:  w.widget_key,
        title:       w.title,
        widget_type: w.widget_type,
        metric_key:  w.metric_key,
        format:      w.format,
        description: w.description,
      })),
    },
  );
  if (rpcError) {
    throw new Error(
      `Industry preset apply failed — your previous dashboard is unchanged. (${rpcError.message})`,
    );
  }

  const statsCreated   = Number(rpcResult?.stats_created ?? stats.length);
  const widgetsCreated = Number(rpcResult?.widgets_created ?? widgets.length);

  // Only record the industry choice once the dashboard swap actually succeeded,
  // so a failed apply leaves workspace state fully untouched.
  await setWorkspaceIndustryServer(workspaceId, industryKey);

  const trendKeys = widgets
    .filter((w) => w.widget_type === "trend" || w.widget_type === "progress")
    .map((w) => w.metric_key);

  // Backfill sparkline history for trend widgets (fire-and-forget).
  if (trendKeys.length > 0) {
    const { ensureMetricHistoryBackfillServer } = await import(
      "@/lib/accountsmind/accountsmind-config.server"
    );
    void ensureMetricHistoryBackfillServer(workspaceId, trendKeys).catch(() => {});
  }

  await writeSystemMindAudit({
    workspaceId, userId,
    instructedBy: "user",
    actionType: "apply_accountsmind_industry_preset",
    targetType: "accountsmind_config",
    targetId:   workspaceId,
    proposedAfterState: { industry: industryKey, stats: statsCreated, widgets: widgetsCreated },
    approvalStatus: "not_requested",
  });

  return { statsCreated, widgetsCreated, industry: industryKey };
}
