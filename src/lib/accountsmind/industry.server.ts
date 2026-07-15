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

  await setWorkspaceIndustryServer(workspaceId, industryKey);

  const sb = sbA();
  const common = {
    created_by_user_id: userId,
    created_by_system:  "industry_preset",
    source_draft_id:    null,
  };

  // Same archive+version chain as SystemMind draft activation.
  const { versionedInsertConfigRow } = await import("@/lib/accountsmind/accountsmind-config.server");

  // Preset apply REPLACES the dashboard: archive live rows whose keys are not
  // part of the preset (matching keys are archived+re-versioned below).
  const presetStatKeys = stats.map((x) => x.stat_key);
  const presetWidgetKeys = widgets.map((x) => x.widget_key);
  for (const [table, keyCol, keep] of [
    ["accountsmind_stat_defs", "stat_key", presetStatKeys],
    ["accountsmind_widget_defs", "widget_key", presetWidgetKeys],
  ] as const) {
    const q = sb.from(table)
      .update({ status: "archived" })
      .eq("workspace_id", workspaceId)
      .in("status", ["active", "paused", "hidden"])
      .eq("is_deleted", false);
    const { error } = keep.length > 0
      ? await q.not(keyCol, "in", `(${keep.map((k: string) => `"${k}"`).join(",")})`)
      : await q;
    if (error) throw new Error(`Failed to archive previous ${table} rows: ${error.message}`);
  }

  let order = 0;
  let statsCreated = 0;
  for (const s of stats) {
    await versionedInsertConfigRow(sb, "accountsmind_stat_defs", workspaceId, "stat_key", s.stat_key, {
      ...common,
      stat_key:       s.stat_key,
      label:          s.label,
      metric_key:     s.metric_key,
      format:         s.format,
      description:    s.description,
      client_visible: true,
      risk_level:     "low",
      display_order:  order++,
    });
    statsCreated++;
  }

  order = 0;
  let widgetsCreated = 0;
  const trendKeys: string[] = [];
  for (const w of widgets) {
    await versionedInsertConfigRow(sb, "accountsmind_widget_defs", workspaceId, "widget_key", w.widget_key, {
      ...common,
      widget_key:     w.widget_key,
      title:          w.title,
      widget_type:    w.widget_type,
      metric_key:     w.metric_key,
      format:         w.format,
      description:    w.description,
      client_visible: true,
      risk_level:     "low",
      display_order:  order++,
    });
    widgetsCreated++;
    if (w.widget_type === "trend" || w.widget_type === "progress") trendKeys.push(w.metric_key);
  }

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
