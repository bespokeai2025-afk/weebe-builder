/**
 * Website UX server functions — Microsoft Clarity connection status + the
 * Website Change Queue (evidence-backed UX recommendations executed
 * approval-first through the Marketing Action Engine).
 *
 * Honesty rules:
 *  - Clarity Data Export API limits are surfaced verbatim (1-3 day windows,
 *    10 requests/project/day, aggregate counts only — no recordings).
 *  - WEBEE has no website deployment integration: approved changes become
 *    handoff packages in "awaiting_website_deployment"; nothing is ever
 *    reported as applied/live until a human deploys and verification runs.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ── Connection status ─────────────────────────────────────────────────────────

export const getClarityStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { data: row } = await sb
      .from("provider_settings")
      .select("status, last_sync, credentials")
      .eq("workspace_id", workspaceId)
      .eq("provider_category", "analytics")
      .eq("provider_name", "microsoft_clarity")
      .maybeSingle();

    const hasToken = !!String((row?.credentials as any)?.apiToken ?? "").trim();
    const [{ count: metricRows }, { data: latest }] = await Promise.all([
      sb.from("clarity_metrics_daily").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
      sb.from("clarity_metrics_daily").select("metric_date").eq("workspace_id", workspaceId)
        .order("metric_date", { ascending: false }).limit(1),
    ]);

    const { CLARITY_LIMITS } = await import("@/lib/growthmind/clarity-sync-core");
    return {
      connected: hasToken && row?.status !== "disconnected" && row?.status !== "error",
      status: row?.status ?? null,
      lastSync: row?.last_sync ?? null,
      metricRows: metricRows ?? 0,
      latestMetricDate: latest?.[0]?.metric_date ?? null,
      limits: CLARITY_LIMITS,
    };
  });

export const syncClarityNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    const { runClaritySyncForWorkspace, refreshWebsiteChangeQueue } = await import("@/lib/growthmind/clarity-sync-core");
    const sync = await runClaritySyncForWorkspace(workspaceId);
    if (!sync.ok) return { ok: false as const, error: sync.error, rateLimited: sync.rateLimited ?? false };
    const refresh = await refreshWebsiteChangeQueue(workspaceId);
    return { ok: true as const, rows: sync.rows, refresh };
  });

// ── Website Change Queue ──────────────────────────────────────────────────────

export const listWebsiteChangeQueue = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    // Reconcile stuck "executing" rows against failed/rejected marketing
    // actions before listing, so failures reopen instead of hanging forever.
    try {
      const { reconcileWebsiteChanges } = await import("@/lib/growthmind/clarity-sync-core");
      await reconcileWebsiteChanges(workspaceId);
    } catch { /* non-fatal — list still renders */ }
    const { data, error } = await sb
      .from("website_change_queue")
      .select("*")
      .eq("workspace_id", workspaceId)
      .in("status", ["open", "executing", "handled"])
      .order("score", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return { changes: data ?? [] };
  });

export const refreshWebsiteChangeQueueNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    const { refreshWebsiteChangeQueue } = await import("@/lib/growthmind/clarity-sync-core");
    return await refreshWebsiteChangeQueue(workspaceId);
  });

export const executeWebsiteChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ changeId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    const { requireAction } = await import("@/lib/permissions/permissions.server");
    await requireAction(workspaceId, context.user?.id ?? null, "campaign_activation");

    // RLS read proves membership + visibility.
    const { data: change, error } = await sb
      .from("website_change_queue")
      .select("*")
      .eq("id", data.changeId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!change) throw new Error("Website change not found");
    if (change.status !== "open") return { ok: false, error: `Change is ${change.status} — only open items can be executed.` };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sbAdmin = supabaseAdmin as any;
    const { createMarketingAction, submitMarketingActionForExecution } = await import("@/lib/marketing/action-engine.server");
    const { WEBSITE_CHANGE_ACTION_TYPE } = await import("@/lib/marketing/executors/website.executor.server");

    // Atomic claim FIRST (open → executing). If we lose the CAS, someone else
    // is already executing this change — no action row is created.
    const { data: claimed, error: claimErr } = await sbAdmin.from("website_change_queue").update({
      status: "executing", status_changed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq("id", change.id).eq("workspace_id", workspaceId).eq("status", "open").select("id");
    if (claimErr) throw new Error(claimErr.message);
    if (!claimed || claimed.length === 0) {
      return { ok: false, error: "Change is already being executed." };
    }

    const action = await createMarketingAction(sbAdmin, workspaceId, {
      source: "website_change_queue",
      requested_by: context.user?.id ?? null,
      objective: change.title,
      platform: "website",
      action_type: WEBSITE_CHANGE_ACTION_TYPE,
      target: { change_id: change.id, page_url: change.page_url, change_type: change.change_type },
      proposed_value: { current: change.current_state, proposed: change.proposed_state, rollback: change.rollback_plan },
      expected_impact: change.expected_impact,
      confidence: Number(change.confidence) || null,
      risk_level: "medium",
      evidence: { score: change.score, why: change.why, ...((change.supporting_data as any) ?? {}) },
    });

    // Link the action to the already-claimed change — checked: an unlinked
    // executing row would strand the queue, so reopen and fail instead.
    const { error: linkErr, data: linked } = await sbAdmin.from("website_change_queue").update({
      marketing_action_id: action.id, updated_at: new Date().toISOString(),
    }).eq("id", change.id).eq("status", "executing").select("id");
    if (linkErr || !linked?.length) {
      await sbAdmin.from("website_change_queue").update({
        status: "open", status_changed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).eq("id", change.id).eq("status", "executing");
      return { ok: false, error: `Could not link the approval action to the change${linkErr ? `: ${linkErr.message}` : ""} — the change was reopened.` };
    }

    const routed = await submitMarketingActionForExecution(sbAdmin, workspaceId, action.id);
    if (routed.outcome === "not_allowed" || routed.outcome === "failed") {
      // Reopen so the user can retry after fixing autonomy settings etc.
      await sbAdmin.from("website_change_queue").update({
        status: "open", status_changed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).eq("id", change.id).eq("status", "executing");
    }
    return { ok: routed.outcome !== "not_allowed" && routed.outcome !== "failed", outcome: routed.outcome, detail: routed.detail, marketingActionId: action.id };
  });

export const dismissWebsiteChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ changeId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    const { data: change, error } = await sb
      .from("website_change_queue")
      .select("id, status")
      .eq("id", data.changeId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!change) throw new Error("Website change not found");
    if (change.status !== "open") return { ok: false, error: `Change is ${change.status}.` };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: upErr } = await (supabaseAdmin as any).from("website_change_queue").update({
      status: "dismissed", status_changed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq("id", data.changeId).eq("workspace_id", workspaceId).eq("status", "open");
    if (upErr) throw new Error(upErr.message);
    return { ok: true };
  });
