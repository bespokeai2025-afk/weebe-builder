// Marketing Action Engine — server functions (autonomy settings, audit list, undo).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  MARKETING_AUTONOMY_LEVELS,
  DEFAULT_MARKETING_GUARDRAILS,
  normalizeGuardrails,
  type MarketingAutonomyLevel,
  type MarketingGuardrails,
  type MarketingActionRecord,
} from "./action-engine.shared";

// ── getMarketingAutonomy ─────────────────────────────────────────────────────
export const getMarketingAutonomy = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as any;
    const fallback = {
      level: "recommend" as MarketingAutonomyLevel,
      guardrails: DEFAULT_MARKETING_GUARDRAILS as MarketingGuardrails,
      canManage: false,
      setBy: null as string | null,
      setAt: null as string | null,
    };
    try {
      const { data } = await sb.from("workspace_settings")
        .select("marketing_autonomy_level, marketing_guardrails, marketing_autonomy_set_by, marketing_autonomy_set_at")
        .eq("workspace_id", context.workspaceId)
        .maybeSingle();

      let canManage = false;
      try {
        const { resolvePermissions, isOwnerOrAdmin } = await import("@/lib/permissions/permissions.server");
        const perms = await resolvePermissions(context.workspaceId!, (context as any).userId ?? null);
        canManage = isOwnerOrAdmin(perms);
      } catch { /* fail closed */ }

      let setBy: string | null = null;
      if (data?.marketing_autonomy_set_by) {
        try {
          const { data: prof } = await sb.from("profiles")
            .select("email, full_name")
            .eq("user_id", data.marketing_autonomy_set_by)
            .maybeSingle();
          setBy = prof?.full_name || prof?.email || null;
        } catch { /* display-only */ }
      }

      const raw = String(data?.marketing_autonomy_level ?? "recommend");
      const level = (MARKETING_AUTONOMY_LEVELS as readonly string[]).includes(raw)
        ? (raw as MarketingAutonomyLevel) : "recommend";
      return {
        level,
        guardrails: normalizeGuardrails(data?.marketing_guardrails),
        canManage,
        setBy,
        setAt: (data?.marketing_autonomy_set_at ?? null) as string | null,
      };
    } catch {
      return fallback;
    }
  });

// ── setMarketingAutonomy ─────────────────────────────────────────────────────
export const setMarketingAutonomy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({
      level: z.enum(["observe", "recommend", "approval", "autopilot"]),
      guardrails: z.object({
        max_daily_ad_spend: z.number().positive().max(1_000_000).nullable().optional(),
        max_auto_budget_increase_pct: z.number().min(0).max(100).optional(),
        max_auto_budget_decrease_pct: z.number().min(0).max(100).optional(),
        max_auto_actions_per_day: z.number().min(0).max(500).optional(),
        protected_campaigns: z.array(z.string().min(1).max(200)).max(200).optional(),
        protected_keywords: z.array(z.string().min(1).max(200)).max(200).optional(),
        protected_pages: z.array(z.string().min(1).max(500)).max(200).optional(),
      }).optional(),
    }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId!;

    // Owner/admin only — autonomy governs real external spend.
    const { resolvePermissions, isOwnerOrAdmin } = await import("@/lib/permissions/permissions.server");
    const perms = await resolvePermissions(workspaceId, (context as any).userId ?? null);
    if (!isOwnerOrAdmin(perms)) {
      throw new Error("Only a workspace owner or admin can change marketing autonomy.");
    }

    const nowIso = new Date().toISOString();
    const update: Record<string, any> = {
      marketing_autonomy_level: data.level,
      marketing_guardrails: normalizeGuardrails({ ...DEFAULT_MARKETING_GUARDRAILS, ...(data.guardrails ?? {}) }),
      marketing_autonomy_set_by: (context as any).userId ?? null,
      marketing_autonomy_set_at: nowIso,
      updated_at: nowIso,
    };

    const { data: updated, error } = await sb.from("workspace_settings")
      .update(update)
      .eq("workspace_id", workspaceId)
      .select("workspace_id");
    if (error) throw error;
    if (!updated?.length) {
      const { error: insErr } = await sb.from("workspace_settings")
        .insert({ workspace_id: workspaceId, ...update });
      if (insErr) throw insErr;
    }
    return { ok: true };
  });

// ── listMarketingActions ─────────────────────────────────────────────────────
export const listMarketingActions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as any; // RLS: member read
    const { data, error } = await sb.from("marketing_actions")
      .select("*")
      .eq("workspace_id", context.workspaceId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    return { actions: (data ?? []) as MarketingActionRecord[] };
  });

// ── requestMarketingUndo ─────────────────────────────────────────────────────
export const requestMarketingUndo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ actionId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const workspaceId = context.workspaceId!;
    // Owner/admin only — undo creates a new external change.
    const { resolvePermissions, isOwnerOrAdmin } = await import("@/lib/permissions/permissions.server");
    const perms = await resolvePermissions(workspaceId, (context as any).userId ?? null);
    if (!isOwnerOrAdmin(perms)) {
      throw new Error("Only a workspace owner or admin can undo marketing changes.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { requestMarketingActionUndo } = await import("@/lib/marketing/action-engine.server");
    const result = await requestMarketingActionUndo(
      supabaseAdmin as any, workspaceId, data.actionId, (context as any).userId ?? null,
    );
    return result;
  });
