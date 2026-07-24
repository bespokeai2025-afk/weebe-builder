// ── HiveMind action safety — shared (client-safe) classification ─────────────
// Which action types are SENSITIVE (always need explicit human approval,
// regardless of mode), which category they fall into, and which entitlement
// ActionKey gates their approval. No secrets, no server imports.

import type { ActionKey } from "@/lib/permissions/permissions.shared";

export type SensitiveCategory =
  | "client_communication" // emails / broadcasts / outbound calls to clients
  | "campaign"             // campaign creation / activation / enrollment
  | "deployment"           // workflow / automation activation
  | "credentials"          // webhook / provider credential changes
  | "budget"               // spend / budget / pricing changes
  | "deletion"             // destructive operations
  | "billing";             // billing changes

/**
 * Sensitive action types — these ALWAYS require an explicit human approval
 * (never auto-executed by any mode, including operator).
 */
export const SENSITIVE_ACTIONS: Record<string, SensitiveCategory> = {
  create_followup_campaign:      "campaign",
  enroll_leads_in_campaign:      "client_communication",
  launch_broadcast:              "client_communication",
  growthmind_video_campaign:     "campaign",
  growthmind_growth_campaign:    "budget",
  register_resend_webhook:       "credentials",
  activate_lead_intake_workflow: "client_communication",
  activate_systemmind_automation:"deployment",
  review_client_pricing:         "billing",
};

export function isSensitiveActionType(actionType: string): boolean {
  return actionType in SENSITIVE_ACTIONS;
}

export function sensitiveCategoryOf(actionType: string): SensitiveCategory | null {
  return SENSITIVE_ACTIONS[actionType] ?? null;
}

/** Entitlement ActionKey required to approve a given sensitive category. */
export const CATEGORY_ENTITLEMENT: Record<SensitiveCategory, ActionKey> = {
  client_communication: "campaign_activation",
  campaign:             "campaign_activation",
  deployment:           "systemmind_approval",
  credentials:          "provider_keys",
  budget:               "campaign_activation",
  deletion:             "systemmind_approval",
  billing:              "billing",
};

/** Non-sensitive, internal-only action types (allowed to execute even in recommend mode). */
export const INTERNAL_ACTION_TYPES = new Set<string>(["create_task", "sync_ad_stats"]);

/** Operator category permission keys (workspace_settings.hivemind_operator_permissions). */
export const OPERATOR_CATEGORIES = [
  "tasks",           // create internal tasks
  "crm",             // pipeline moves, KB assignment
  "campaigns",       // campaign drafts (still sensitive-gated for launch)
  "content",         // content/video generation drafts
  "sync",            // data syncs
  "publishing",      // social publishing of rule-cleared, approved content
] as const;
export type OperatorCategory = (typeof OPERATOR_CATEGORIES)[number];

/** Which operator category an action type belongs to (for auto-exec gating). */
export const ACTION_OPERATOR_CATEGORY: Record<string, OperatorCategory> = {
  create_task:              "tasks",
  move_pipeline_stage:      "crm",
  assign_knowledge_base:    "crm",
  sync_ad_stats:            "sync",
  send_workflow_draft_to_builder: "content",
  // Content publishing: workspace approval rules decide sensitivity at
  // proposal time (rule-triggered publishes are inserted with sensitive=true
  // and always need a human). Only rule-cleared publishes may auto-execute,
  // and only when this operator category is explicitly enabled.
  growthmind_publish_content: "publishing",
};

export const HIVEMIND_MODES = ["observe", "recommend", "assistant", "operator"] as const;
export type HiveMindModeName = (typeof HIVEMIND_MODES)[number];

/** Spec default: recommend (never assistant/operator by default). */
export const DEFAULT_HIVEMIND_MODE: HiveMindModeName = "recommend";
