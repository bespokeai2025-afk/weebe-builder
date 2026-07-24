/**
 * Executive recommendation follow-through — SERVER ONLY.
 *
 * Wires the executive reasoning layer (hivemind_recommendations) into the
 * HiveMind mode system and the hivemind_actions approval workflow:
 *
 *   • Every follow-through is a hivemind_actions row that goes through the
 *     existing approval pipeline (approveHiveMindAction: mode gate +
 *     entitlement check + CAS consume + post-consume re-validation).
 *   • What a recommendation MAY trigger is mode-gated here:
 *       observe   — nothing may be proposed (fail closed).
 *       recommend — only INTERNAL follow-through (create_task). A mapped
 *                   external/sensitive action is downgraded to create_task so
 *                   the workspace never accumulates unapprovable actions.
 *       assistant / operator — the full mapped follow-through is proposed;
 *                   sensitive actions are flagged sensitive and ALWAYS require
 *                   explicit human approval (never auto-executed).
 *   • High-risk mappings build their payloads server-side from live data —
 *     the client can never inject lead_ids or payload contents.
 */
import type { HiveMindModeConfig } from "./mode-gate.server";

type Sb = any;

const DAY = 86_400_000;

export interface FollowThroughDraft {
  action_type: string;
  title: string;
  description: string;
  action_payload: Record<string, unknown>;
}

export interface RecommendationRow {
  id: string;
  workspace_id: string;
  title: string;
  department: string;
  priority: string;
  business_issue: string;
  recommended_action: string;
  next_step: string | null;
  dedupe_key: string;
  correlation_key: string | null;
  status: string;
  confidence: number;
}

/** Strip the date suffix the reasoning engine appends to dedupe keys. */
export function ruleOfDedupeKey(dedupeKey: string): string {
  return String(dedupeKey ?? "").replace(/:\d{4}-\d{2}-\d{2}$/, "");
}

function taskDraftFor(rec: RecommendationRow): FollowThroughDraft {
  const rule = ruleOfDedupeKey(rec.dedupe_key);
  return {
    action_type: "create_task",
    title: `Task: ${rec.title}`.slice(0, 300),
    description: rec.recommended_action.slice(0, 2000),
    action_payload: {
      title: rec.title.slice(0, 300),
      description: [rec.recommended_action, rec.next_step ? `Next step: ${rec.next_step}` : null]
        .filter(Boolean).join("\n\n").slice(0, 2000),
      priority: ["critical", "high", "medium", "low"].includes(rec.priority) ? rec.priority : "medium",
      trigger_type: `exec_rec:${rule}`.slice(0, 200),
      entity_type: "hivemind_recommendation",
      entity_id: rec.id,
      entity_name: rec.title.slice(0, 300),
      source_recommendation_id: rec.id,
    },
  };
}

/**
 * Map a recommendation to its concrete follow-through action.
 * Deterministic per rule; defaults to an internal task. High-risk rules map
 * to SENSITIVE action types whose payloads are built from live data here.
 */
async function mapFollowThrough(
  sb: Sb,
  workspaceId: string,
  rec: RecommendationRow,
  isWbah: boolean,
): Promise<FollowThroughDraft> {
  const rule = ruleOfDedupeKey(rec.dedupe_key);

  // Stale-lead backlog → follow-up campaign enrolling the actual stale leads.
  // Sensitive (client_communication path) — always needs explicit approval.
  // WBAH: never query the oversized leads table — stay internal.
  if (rule === "stale_lead_backlog" && !isWbah) {
    try {
      const cutoff = new Date(Date.now() - 7 * DAY).toISOString();
      const { data: staleLeads, error } = await sb
        .from("leads")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("status", "need_to_call")
        .lt("updated_at", cutoff)
        .order("updated_at", { ascending: true })
        .limit(500);
      if (!error && (staleLeads?.length ?? 0) > 0) {
        const ids = (staleLeads as Array<{ id: string }>).map((l) => l.id);
        return {
          action_type: "create_followup_campaign",
          title: `Recovery campaign for ${ids.length} stale lead${ids.length === 1 ? "" : "s"}`,
          description:
            `Executive recommendation follow-through: create a recovery follow-up campaign and enroll the ${ids.length} leads that have waited 7+ days without a first call. Requires explicit approval before any client communication is set up.`,
          action_payload: {
            name: "Stale Lead Recovery",
            description: `Auto-proposed from executive recommendation "${rec.title.slice(0, 120)}"`,
            config: { auto_enroll: true },
            lead_ids: ids,
            source_recommendation_id: rec.id,
          },
        };
      }
    } catch { /* fall through to internal task */ }
  }

  return taskDraftFor(rec);
}

/** Internal action types allowed to be the follow-through in recommend mode. */
function isInternalDraft(draft: FollowThroughDraft): boolean {
  return draft.action_type === "create_task" || draft.action_type === "sync_ad_stats";
}

export interface ProposeFollowThroughResult {
  ok: boolean;
  actionId?: string;
  actionType?: string;
  sensitive?: boolean;
  downgraded?: boolean;
  skipped?: "observe_mode" | "already_linked" | "closed_recommendation";
  error?: string;
}

/**
 * Propose the follow-through hivemind_action for a recommendation.
 * Mode-gated, deduped against existing open linked actions, and the created
 * action ALWAYS lands "pending" — execution only ever happens through the
 * approval pipeline.
 */
export async function proposeFollowThroughForRecommendation(
  sb: Sb,
  workspaceId: string,
  rec: RecommendationRow,
  cfg: HiveMindModeConfig,
  opts: { isWbah: boolean; proposedBy: string },
): Promise<ProposeFollowThroughResult> {
  try {
    // Mode gate — observe: nothing may be proposed.
    if (cfg.mode === "observe") return { ok: false, skipped: "observe_mode" };

    // Terminal recommendations never trigger anything.
    if (["completed", "failed", "dismissed", "expired", "rejected"].includes(rec.status)) {
      return { ok: false, skipped: "closed_recommendation" };
    }

    // Dedup: one live follow-through per recommendation.
    const { data: linked } = await sb
      .from("hivemind_actions")
      .select("id, status")
      .eq("workspace_id", workspaceId)
      .eq("source_recommendation_id", rec.id)
      .in("status", ["pending", "approved", "executed"])
      .limit(1);
    if ((linked?.length ?? 0) > 0) return { ok: false, skipped: "already_linked" };

    let draft = await mapFollowThrough(sb, workspaceId, rec, opts.isWbah);
    let downgraded = false;

    // Recommend mode: only internal follow-through may be created — downgrade
    // external/sensitive drafts to a task so nothing unapprovable piles up.
    if (cfg.mode === "recommend" && !isInternalDraft(draft)) {
      draft = taskDraftFor(rec);
      downgraded = true;
    }

    const { isSensitiveActionType, sensitiveCategoryOf } = await import("./action-safety.shared");
    const sensitive = isSensitiveActionType(draft.action_type);

    const { data: row, error } = await sb
      .from("hivemind_actions")
      .insert({
        workspace_id: workspaceId,
        title: draft.title,
        description: draft.description,
        action_type: draft.action_type,
        action_payload: draft.action_payload,
        status: "pending",
        proposed_by: opts.proposedBy,
        sensitive,
        sensitive_category: sensitiveCategoryOf(draft.action_type),
        source_recommendation_id: rec.id,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    return {
      ok: true,
      actionId: row.id as string,
      actionType: draft.action_type,
      sensitive,
      downgraded,
    };
  } catch (err: any) {
    return { ok: false, error: String(err?.message ?? err).slice(0, 300) };
  }
}

/**
 * Reflect a linked action's outcome back onto its source recommendation.
 * Never throws — reflection is best-effort bookkeeping.
 */
export async function reflectActionOutcomeOnRecommendation(
  sb: Sb,
  workspaceId: string,
  sourceRecommendationId: string | null | undefined,
  outcome: "approved" | "executed" | "failed" | "rejected",
): Promise<void> {
  if (!sourceRecommendationId) return;
  try {
    const nextStatus =
      outcome === "executed" ? "completed"
      : outcome === "failed" ? "failed"
      : outcome === "rejected" ? "under_review"
      : "in_progress";
    const note =
      outcome === "executed" ? "Follow-through action executed via HiveMind approvals."
      : outcome === "failed" ? "Follow-through action failed during execution."
      : outcome === "rejected" ? "Follow-through action was rejected — recommendation reopened for review."
      : "Follow-through action approved and in progress.";
    await sb
      .from("hivemind_recommendations")
      .update({ status: nextStatus, result: note, updated_at: new Date().toISOString() })
      .eq("id", sourceRecommendationId)
      .eq("workspace_id", workspaceId)
      // Never resurrect terminal recommendations.
      .not("status", "in", "(completed,dismissed,expired)");
  } catch { /* best-effort */ }
}
