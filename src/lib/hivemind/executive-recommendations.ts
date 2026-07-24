/**
 * Executive recommendations — server functions (approval & mode enforcement).
 *
 * Surfaces the executive reasoning layer's hivemind_recommendations and wires
 * their follow-through into the HiveMind mode system + hivemind_actions
 * approval workflow. Direct execution NEVER happens here — acting on a
 * recommendation only creates a pending hivemind_actions row that must go
 * through approveHiveMindAction (mode gate, entitlements, CAS, TOCTOU guard).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface ExecutiveRecommendation {
  id: string;
  workspace_id: string;
  title: string;
  department: string;
  priority: string;
  business_issue: string;
  evidence: Record<string, any>;
  commercial_impact: string | null;
  risk_of_inaction: string | null;
  recommended_action: string;
  next_step: string | null;
  due_date: string | null;
  approval_required: boolean;
  confidence: number;
  status: string;
  result: string | null;
  dedupe_key: string;
  correlation_key: string | null;
  created_at: string;
  updated_at: string;
}

const OPEN_STATES = ["new", "acknowledged", "under_review", "reopened"] as const;

// ── listExecutiveRecommendations ──────────────────────────────────────────────
/** Shared list core — consumed by web server fn + /api/v1/minds/summary. */
export async function listExecutiveRecommendationsCore(
  ctx: { sb: any; workspaceId: string },
) {
  {
    const sb = ctx.sb as any;
    const workspaceId = ctx.workspaceId;
    const { data, error } = await sb
      .from("hivemind_recommendations")
      .select("id, workspace_id, title, department, priority, business_issue, evidence, commercial_impact, risk_of_inaction, recommended_action, next_step, due_date, approval_required, confidence, status, result, dedupe_key, correlation_key, created_at, updated_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    const recs = (data ?? []) as ExecutiveRecommendation[];

    // Linked follow-through actions (for "already routed to approvals" state).
    const ids = recs.map((r) => r.id);
    let linkedByRec: Record<string, { id: string; status: string; action_type: string; sensitive: boolean }> = {};
    if (ids.length) {
      const { data: acts } = await sb
        .from("hivemind_actions")
        .select("id, status, action_type, sensitive, source_recommendation_id, created_at")
        .eq("workspace_id", workspaceId)
        .in("source_recommendation_id", ids)
        .order("created_at", { ascending: false })
        .limit(200);
      for (const a of (acts ?? []) as any[]) {
        const key = String(a.source_recommendation_id);
        if (!linkedByRec[key]) {
          linkedByRec[key] = { id: a.id, status: a.status, action_type: a.action_type, sensitive: a.sensitive === true };
        }
      }
    }

    const open = recs.filter((r) => (OPEN_STATES as readonly string[]).includes(r.status)).length;
    return { recommendations: recs, linkedActions: linkedByRec, openCount: open };
  }
}

export const listExecutiveRecommendations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) =>
    listExecutiveRecommendationsCore({
      sb: context.supabase as any,
      workspaceId: context.workspaceId!,
    })
  );

// ── updateExecutiveRecommendationStatus (lifecycle, no side-effects) ─────────
const USER_TRANSITIONS: Record<string, string[]> = {
  // from → allowed target states via direct user lifecycle updates.
  new:          ["acknowledged", "under_review", "dismissed"],
  acknowledged: ["under_review", "dismissed", "completed"],
  under_review: ["acknowledged", "dismissed", "completed"],
  reopened:     ["acknowledged", "under_review", "dismissed", "completed"],
  in_progress:  ["completed", "dismissed"],
  expired:      ["reopened"],
  dismissed:    ["reopened"],
};

export const updateExecutiveRecommendationStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      id: z.string().uuid(),
      status: z.enum(["acknowledged", "under_review", "dismissed", "completed", "reopened"]),
    }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId!;

    const { data: rec, error: fe } = await sb
      .from("hivemind_recommendations")
      .select("id, status")
      .eq("id", data.id)
      .eq("workspace_id", workspaceId)
      .single();
    if (fe) throw fe;

    const allowed = USER_TRANSITIONS[String(rec.status)] ?? [];
    if (!allowed.includes(data.status)) {
      throw new Error(`Cannot move a "${rec.status}" recommendation to "${data.status}".`);
    }

    const { error } = await sb
      .from("hivemind_recommendations")
      .update({ status: data.status, updated_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("workspace_id", workspaceId)
      .eq("status", rec.status); // CAS — a concurrent transition loses cleanly
    if (error) throw error;
    return { ok: true };
  });

// ── actOnExecutiveRecommendation (follow-through via approvals) ──────────────
export const actOnExecutiveRecommendation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid() }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId!;

    // Mode gate — observe mode blocks all engine/user-triggered proposals.
    const { assertProposalAllowed } = await import("@/lib/hivemind/mode-gate.server");
    const cfg = await assertProposalAllowed(sb, workspaceId);

    const { data: rec, error: fe } = await sb
      .from("hivemind_recommendations")
      .select("id, workspace_id, title, department, priority, business_issue, recommended_action, next_step, dedupe_key, correlation_key, status, confidence")
      .eq("id", data.id)
      .eq("workspace_id", workspaceId)
      .single();
    if (fe) throw fe;

    const { proposeFollowThroughForRecommendation } =
      await import("@/lib/hivemind/executive-followthrough.server");
    const { isWbahWorkspaceId } = await import("@/lib/wbah-exclusion.shared");

    const res = await proposeFollowThroughForRecommendation(sb, workspaceId, rec, cfg, {
      isWbah: isWbahWorkspaceId(workspaceId),
      proposedBy: "executive_reasoning",
    });

    if (res.skipped === "already_linked") {
      throw new Error("A follow-through action for this recommendation is already in the approval queue.");
    }
    if (res.skipped === "closed_recommendation") {
      throw new Error("This recommendation is closed and can no longer trigger actions.");
    }
    if (!res.ok) throw new Error(res.error ?? "Could not create the follow-through action.");

    // Mark the recommendation as approved-for-follow-through (awaiting the
    // action's own approval before anything executes).
    await sb
      .from("hivemind_recommendations")
      .update({ status: "approved", updated_at: new Date().toISOString() })
      .eq("id", rec.id)
      .eq("workspace_id", workspaceId)
      .in("status", ["new", "acknowledged", "under_review", "reopened"]);

    return {
      ok: true,
      actionId: res.actionId!,
      actionType: res.actionType!,
      sensitive: res.sensitive === true,
      downgraded: res.downgraded === true,
      mode: cfg.mode,
    };
  });
