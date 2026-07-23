// SERVER ONLY — never import from a client component.
// Trend Engine server functions — core detection logic lives in
// trend-signals.server.ts (alias-free, safe for vite-config-loaded imports).

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { detectTrendSignals } from "./trend-signals.server";
import type { TrendClassification, TrendSignal } from "./trend-signals.server";

export { detectTrendSignals } from "./trend-signals.server";
export type { TrendClassification, TrendSignal } from "./trend-signals.server";

// ── Server functions ───────────────────────────────────────────────────────────

export const getTrendSignals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    try {
      const { data } = await sb
        .from("growthmind_trend_signals")
        .select("id, signal_type, label, classification, current_value, previous_value, change_percent, insight, action_hint, computed_at")
        .eq("workspace_id", workspaceId)
        .order("computed_at", { ascending: false })
        .limit(30);

      const signals: TrendSignal[] = (data ?? []).map((r: any) => ({
        id:             r.id,
        signalType:     r.signal_type,
        label:          r.label,
        classification: r.classification as TrendClassification,
        currentValue:   r.current_value,
        previousValue:  r.previous_value,
        changePercent:  r.change_percent,
        insight:        r.insight,
        actionHint:     r.action_hint,
        computedAt:     r.computed_at,
      }));
      return { signals };
    } catch {
      return { signals: [] };
    }
  });

export const runTrendEngine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const signals = await detectTrendSignals(sb, workspaceId);

    await Promise.resolve(sb.from("growthmind_trend_signals").delete().eq("workspace_id", workspaceId)).catch(() => {});

    const rows = signals.map(s => ({
      workspace_id:   workspaceId,
      signal_type:    s.signalType,
      label:          s.label,
      classification: s.classification,
      current_value:  s.currentValue,
      previous_value: s.previousValue,
      change_percent: s.changePercent,
      insight:        s.insight,
      action_hint:    s.actionHint,
      computed_at:    s.computedAt,
    }));

    await Promise.resolve(sb.from("growthmind_trend_signals").insert(rows)).catch(() => {});
    return { ok: true, count: signals.length, signals };
  });
