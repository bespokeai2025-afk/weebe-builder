/**
 * Universal Mind Intelligence Packet — shared (client-safe) contract.
 *
 * ONE authoritative shape for what an AI Mind must know before any task it
 * creates can become approvable. Shallow "title + description + mind +
 * priority" records are no longer acceptable Mind output — the server-side
 * quality gate (intelligence-packet.server.ts) rejects them unless the row is
 * explicitly a human-created manual reminder (Human Task).
 *
 * No secrets, no server imports — types + pure validator only.
 */

export const INTELLIGENCE_PACKET_VERSION = 1;

// ── Readiness states (spec §3) ───────────────────────────────────────────────
export const MIND_TASK_READINESS_STATES = [
  "insufficient_context",
  "target_resolution_required",
  "integration_required",
  "evidence_gathering",
  "investigation_required",
  "proposal_incomplete",
  "ready_for_review",
  "ready_for_analysis_approval",
  "ready_for_content_approval",
  "ready_for_change_approval",
  "ready_for_publication_approval",
  "ready_for_execution",
  "blocked",
] as const;
export type MindTaskReadinessState = (typeof MIND_TASK_READINESS_STATES)[number];

/** Human-readable labels (UI phase uses these; kept here so they stay in sync). */
export const READINESS_LABELS: Record<MindTaskReadinessState, string> = {
  insufficient_context:            "Insufficient Context",
  target_resolution_required:      "Target Resolution Required",
  integration_required:            "Integration Required",
  evidence_gathering:              "Evidence Gathering",
  investigation_required:          "Investigation Required",
  proposal_incomplete:             "Proposal Incomplete",
  ready_for_review:                "Ready for Review",
  ready_for_analysis_approval:     "Ready for Analysis Approval",
  ready_for_content_approval:      "Ready for Content Approval",
  ready_for_change_approval:       "Ready for Change Approval",
  ready_for_publication_approval:  "Ready for Publication Approval",
  ready_for_execution:             "Ready for Execution",
  blocked:                         "Blocked",
};

/** States in which an Approve control may be shown / an approval accepted. */
export const APPROVABLE_READINESS_STATES: ReadonlySet<MindTaskReadinessState> = new Set([
  "ready_for_analysis_approval",
  "ready_for_content_approval",
  "ready_for_change_approval",
  "ready_for_publication_approval",
  "ready_for_execution",
]);

export function isApprovableReadiness(state: string | null | undefined): boolean {
  return !!state && APPROVABLE_READINESS_STATES.has(state as MindTaskReadinessState);
}

// ── Packet parts ─────────────────────────────────────────────────────────────
export type TargetDomain =
  | "marketing" | "sales" | "comms" | "voice" | "systems" | "finance" | "content" | "general";

export interface PacketTarget {
  domain: TargetDomain;
  /** e.g. "gads_campaign", "lead_segment", "agent", "invoice_schedule". */
  entity_type: string;
  /** Real row/remote id when resolved; null when unresolved. */
  entity_id: string | null;
  entity_name: string | null;
  resolved: boolean;
  /** Why unresolved / candidates, for the resolution UI. */
  resolution_note?: string | null;
}

export interface PacketEvidence {
  /** Where this came from: table/API/engine name — never invented. */
  source: string;
  description: string;
  /** Small, non-secret structured payload. */
  data?: Record<string, unknown> | null;
  retrieved_at: string; // ISO
}

export interface PacketPlanStep {
  order: number;
  title: string;
  detail?: string | null;
  /** Registered capability that performs the step, when executable. */
  action_kind?: string | null;
}

export interface PacketProposedChange {
  target: string;
  change: string;
  reversible: boolean;
}

export interface PacketCost {
  /** Honest flag — when false, amount fields MUST be absent (never invented). */
  known: boolean;
  amount?: number;
  currency?: string;
  basis?: string;
  note?: string | null;
}

export type ApprovalScopeKind =
  | "review" | "analysis" | "content" | "change" | "publication" | "execution";

export interface PacketApprovalScope {
  kind: ApprovalScopeKind;
  /** Exactly what a human approves — no vague "Approve". */
  summary: string;
  sensitive: boolean;
}

export interface PacketMonitoring {
  metrics: string[];
  reassess_after_days?: number | null;
}

// ── The packet ───────────────────────────────────────────────────────────────
export interface UniversalMindIntelligencePacket {
  version: number;
  mind: string; // hivemind | growthmind | systemmind | accountsmind
  /** What outcome this work is for — plain language, specific. */
  objective: string;
  /** Instruction/trigger that produced this (chat, scan rule, recommendation…). */
  intent: {
    source: string;               // e.g. "chat_tool:create_growthmind_task"
    instruction?: string | null;  // raw user/system instruction if any
  };
  workspace_context?: Record<string, unknown> | null;
  targets: PacketTarget[];
  evidence: PacketEvidence[];
  diagnosis: string | null;
  plan_steps: PacketPlanStep[];
  proposed_changes: PacketProposedChange[];
  deliverables: string[];
  success_criteria: string[];
  limitations: string[];
  cost: PacketCost;
  approval_scope: PacketApprovalScope | null;
  monitoring: PacketMonitoring | null;
  /** Hard blockers (missing integration, provider down…). */
  blockers?: Array<{ kind: "integration_missing" | "provider_error" | "other"; detail: string }>;
  /** What is still missing — drives the readiness UI controls. */
  missing?: string[];
  created_at: string; // ISO
}

export interface PacketValidationResult {
  readiness: MindTaskReadinessState;
  approvable: boolean;
  missing: string[];
}

// ── Validator (pure) ─────────────────────────────────────────────────────────
/**
 * Compute the readiness state of a packet. Deterministic pipeline order:
 * context → targets → integration → evidence → diagnosis → proposal
 * completeness → ready-for-{scope}. Never returns an approvable state for an
 * incomplete proposal.
 */
export function validateUniversalMindIntelligencePacket(
  packet: UniversalMindIntelligencePacket | null | undefined,
): PacketValidationResult {
  const missing: string[] = [];
  const state = (readiness: MindTaskReadinessState): PacketValidationResult =>
    ({ readiness, approvable: isApprovableReadiness(readiness), missing });

  if (!packet || typeof packet !== "object") {
    missing.push("intelligence_packet");
    return state("insufficient_context");
  }
  if (!packet.objective || packet.objective.trim().length < 10) missing.push("objective");
  if (!packet.mind) missing.push("mind");
  if (!packet.intent?.source) missing.push("intent.source");
  if (missing.length) return state("insufficient_context");

  // Hard blockers first.
  const blockers = packet.blockers ?? [];
  if (blockers.some((b) => b.kind === "integration_missing")) {
    missing.push(...blockers.filter((b) => b.kind === "integration_missing").map((b) => b.detail));
    return state("integration_required");
  }
  if (blockers.length) {
    missing.push(...blockers.map((b) => b.detail));
    return state("blocked");
  }

  // Target resolution.
  if (!Array.isArray(packet.targets) || packet.targets.length === 0) {
    missing.push("targets");
    return state("target_resolution_required");
  }
  if (packet.targets.some((t) => !t.resolved)) {
    missing.push(...packet.targets.filter((t) => !t.resolved)
      .map((t) => `unresolved target: ${t.entity_type}${t.entity_name ? ` "${t.entity_name}"` : ""}`));
    return state("target_resolution_required");
  }

  // Evidence.
  if (!Array.isArray(packet.evidence) || packet.evidence.length === 0) {
    missing.push("evidence");
    return state("evidence_gathering");
  }

  // Diagnosis.
  if (!packet.diagnosis || packet.diagnosis.trim().length < 10) {
    missing.push("diagnosis");
    return state("investigation_required");
  }

  // Proposal completeness.
  if (!packet.plan_steps?.length)       missing.push("plan_steps");
  if (!packet.deliverables?.length)     missing.push("deliverables");
  if (!packet.success_criteria?.length) missing.push("success_criteria");
  if (!packet.approval_scope?.summary)  missing.push("approval_scope");
  if (!packet.cost || typeof packet.cost.known !== "boolean") missing.push("cost");
  // Honest cost: unknown cost must not carry an invented amount.
  if (packet.cost && packet.cost.known === false && packet.cost.amount != null) {
    missing.push("cost.amount present while cost.known=false");
  }
  if (missing.length) return state("proposal_incomplete");

  switch (packet.approval_scope!.kind) {
    case "analysis":    return state("ready_for_analysis_approval");
    case "content":     return state("ready_for_content_approval");
    case "change":      return state("ready_for_change_approval");
    case "publication": return state("ready_for_publication_approval");
    case "execution":   return state("ready_for_execution");
    case "review":
    default:            return state("ready_for_review");
  }
}

// ── Task classification (shared so UI can mirror the server rule) ────────────
export type MindTaskClass = "human_task" | "informational" | "executable";

/** True when a task row is an explicit human-created manual reminder. */
export function isHumanTaskRow(row: {
  source?: string | null;
  metadata?: Record<string, unknown> | null;
}): boolean {
  return row?.source === "manual" || (row?.metadata as any)?.human_task === true;
}
