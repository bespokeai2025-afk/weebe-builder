// ── GrowthMind autonomy mode (Observe / Recommend / Assistant / Operator) ─────
// Mirrors the HiveMind mode pattern: stored on workspace_settings, defaults to
// "recommend", operator requires explicit owner/admin enablement and is revoked
// when leaving operator mode.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type GrowthMindMode = "observe" | "recommend" | "assistant" | "operator";

export const GROWTHMIND_MODE_LABELS: Record<GrowthMindMode, { label: string; description: string }> = {
  observe:   { label: "Observe",   description: "GrowthMind only researches and reports. No recommendations are created." },
  recommend: { label: "Recommend", description: "GrowthMind creates recommendations and content briefs for you to act on." },
  assistant: { label: "Assistant", description: "GrowthMind creates Content Studio drafts, but can never publish." },
  operator:  { label: "Operator",  description: "GrowthMind can schedule or publish content within your configured rules. Requires owner/admin enablement." },
};

/** Operator-mode permission categories (all default OFF). */
export const GROWTHMIND_OPERATOR_CATEGORIES = [
  "auto_schedule_low_risk",
  "auto_publish_approved",
] as const;

export const getGrowthMindMode = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as any;
    try {
      const { data } = await sb.from("workspace_settings")
        .select("growthmind_mode, growthmind_operator_enabled, growthmind_operator_permissions")
        .eq("workspace_id", context.workspaceId)
        .maybeSingle();
      return {
        mode: (data?.growthmind_mode ?? "recommend") as GrowthMindMode,
        operatorEnabled: data?.growthmind_operator_enabled === true,
        operatorPermissions: (data?.growthmind_operator_permissions ?? {}) as Record<string, boolean>,
      };
    } catch {
      return { mode: "recommend" as GrowthMindMode, operatorEnabled: false, operatorPermissions: {} as Record<string, boolean> };
    }
  });

export const setGrowthMindMode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      mode: z.enum(["observe", "recommend", "assistant", "operator"]),
      operatorPermissions: z.record(z.boolean()).optional(),
    }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId!;
    const userId = (context as any).userId ?? null;
    const nowIso = new Date().toISOString();

    const update: Record<string, any> = { growthmind_mode: data.mode, updated_at: nowIso };

    if (data.mode === "operator") {
      // Operator mode is NEVER default and requires explicit owner/admin enablement.
      const { resolvePermissions, isOwnerOrAdmin } = await import("@/lib/permissions/permissions.server");
      const perms = await resolvePermissions(workspaceId, userId);
      if (!isOwnerOrAdmin(perms)) {
        throw new Error("Only a workspace owner or admin can enable Operator mode.");
      }
      const allowedKeys = new Set<string>(GROWTHMIND_OPERATOR_CATEGORIES);
      const cleaned: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(data.operatorPermissions ?? {})) {
        if (allowedKeys.has(k)) cleaned[k] = v === true;
      }
      update.growthmind_operator_enabled     = true;
      update.growthmind_operator_permissions = cleaned;
      update.growthmind_operator_enabled_by  = userId;
      update.growthmind_operator_enabled_at  = nowIso;
    } else {
      // Leaving operator mode revokes the enablement — must be re-granted next time.
      update.growthmind_operator_enabled = false;
    }

    // Upsert-safe: a plain .update() silently affects 0 rows when the
    // workspace_settings row does not exist yet, leaving the mode unenforced.
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

    const { logGrowthMindActivity } = await import("@/lib/growthmind/growthmind.activity.server");
    await logGrowthMindActivity({
      workspaceId,
      actor: "user",
      actorUserId: userId,
      category: "mode",
      action: "mode.changed",
      summary: `GrowthMind autonomy mode set to ${data.mode}`,
      detail: { mode: data.mode },
      modeAtTime: data.mode,
    });

    return { ok: true };
  });

// ── Activity log read (for UI) ────────────────────────────────────────────────
export const getGrowthMindActivityLog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      category: z.string().optional(),
      limit:    z.number().int().min(1).max(200).default(50),
    }).parse(input ?? {})
  )
  .handler(async ({ context, data }) => {
    const sb = context.supabase as any;
    let q = sb.from("growthmind_activity_log")
      .select("id, actor, category, action, entity_type, entity_id, summary, detail, mode_at_time, created_at")
      .eq("workspace_id", context.workspaceId)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.category) q = q.eq("category", data.category);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return { entries: rows ?? [] };
  });
