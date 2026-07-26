/**
 * Universal Mind Intelligence Packet — SERVER quality gate.
 *
 * ONE choke point for every server path that creates Mind tasks:
 * `prepareMindTaskInsert()` classifies the row (Human Task / informational /
 * executable), validates its intelligence packet, computes the readiness
 * state and returns the enriched insert row. Shallow Mind output (title +
 * description + mind + priority only) is REJECTED unless it is an explicit
 * human-created manual reminder.
 *
 * Executable tasks additionally may never be approved/run unless their
 * readiness state is approvable (enforced in mind-execution-engine).
 */
import {
  INTELLIGENCE_PACKET_VERSION,
  type UniversalMindIntelligencePacket,
  type PacketTarget,
  type PacketEvidence,
  type MindTaskReadinessState,
  validateUniversalMindIntelligencePacket,
  isApprovableReadiness,
  isHumanTaskRow,
} from "./intelligence-packet.shared";

export class MindTaskQualityGateError extends Error {
  readonly readiness: MindTaskReadinessState | null;
  readonly missing: string[];
  constructor(message: string, readiness: MindTaskReadinessState | null = null, missing: string[] = []) {
    super(message);
    this.name = "MindTaskQualityGateError";
    this.readiness = readiness;
    this.missing = missing;
  }
}

// ── Packet builders ──────────────────────────────────────────────────────────
export interface PacketInput {
  mind: string;
  objective: string;
  intentSource: string;
  instruction?: string | null;
  targets?: PacketTarget[];
  evidence?: PacketEvidence[];
  diagnosis?: string | null;
  planSteps?: Array<{ title: string; detail?: string | null; action_kind?: string | null }>;
  proposedChanges?: Array<{ target: string; change: string; reversible: boolean }>;
  deliverables?: string[];
  successCriteria?: string[];
  limitations?: string[];
  cost?: UniversalMindIntelligencePacket["cost"];
  approvalScope?: UniversalMindIntelligencePacket["approval_scope"];
  monitoring?: UniversalMindIntelligencePacket["monitoring"];
  blockers?: UniversalMindIntelligencePacket["blockers"];
  missing?: string[];
  workspaceContext?: Record<string, unknown> | null;
}

export function buildIntelligencePacket(input: PacketInput): UniversalMindIntelligencePacket {
  return {
    version: INTELLIGENCE_PACKET_VERSION,
    mind: input.mind,
    objective: input.objective,
    intent: { source: input.intentSource, instruction: input.instruction ?? null },
    workspace_context: input.workspaceContext ?? null,
    targets: input.targets ?? [],
    evidence: input.evidence ?? [],
    diagnosis: input.diagnosis ?? null,
    plan_steps: (input.planSteps ?? []).map((s, i) => ({ order: i + 1, ...s })),
    proposed_changes: input.proposedChanges ?? [],
    deliverables: input.deliverables ?? [],
    success_criteria: input.successCriteria ?? [],
    limitations: input.limitations ?? [],
    // Honest default: cost is Unknown unless a caller measured it.
    cost: input.cost ?? { known: false, note: "Cost not measured for this proposal." },
    approval_scope: input.approvalScope ?? null,
    monitoring: input.monitoring ?? null,
    blockers: input.blockers ?? [],
    missing: input.missing ?? [],
    created_at: new Date().toISOString(),
  };
}

/**
 * Investigation-state packet for an instruction the Mind could NOT resolve
 * into a concrete, evidence-backed proposal. Lands the task in a clarification
 * readiness state — never a fake executable/approvable task.
 */
export function buildInvestigationPacket(input: {
  mind: string;
  objective: string;
  intentSource: string;
  instruction?: string | null;
  missing: string[];
  targets?: PacketTarget[];
  evidence?: PacketEvidence[];
}): UniversalMindIntelligencePacket {
  return buildIntelligencePacket({
    mind: input.mind,
    objective: input.objective,
    intentSource: input.intentSource,
    instruction: input.instruction,
    targets: input.targets ?? [],
    evidence: input.evidence ?? [],
    missing: input.missing,
    limitations: [
      "This instruction could not be resolved into a concrete, evidence-backed proposal yet.",
    ],
  });
}

// ── Quality gate ─────────────────────────────────────────────────────────────
export interface PrepareMindTaskOptions {
  /** Explicit human-created manual reminder (labelled Human Task). */
  humanTask?: boolean;
  /**
   * What to do when the packet is not approvable for an EXECUTABLE row:
   *  - "reject": throw MindTaskQualityGateError (default)
   *  - "investigate": downgrade to a non-executable investigation task
   */
  onIncomplete?: "reject" | "investigate";
}

/**
 * Validate + enrich a hivemind_tasks insert row. Returns the row with
 * intelligence_packet / readiness_state / packet_version / task_category set.
 * Throws MindTaskQualityGateError on shallow Mind output.
 */
export function prepareMindTaskInsert(
  row: Record<string, any>,
  packet: UniversalMindIntelligencePacket | null,
  opts: PrepareMindTaskOptions = {},
): Record<string, any> {
  // 1. Human Task: explicit manual reminders bypass packet requirements but
  //    are permanently labelled and can never be executable.
  if (opts.humanTask === true || isHumanTaskRow(row)) {
    return {
      ...row,
      task_category: row.task_category ?? "informational",
      metadata: { ...(row.metadata ?? {}), human_task: true, task_class: "human_task" },
      intelligence_packet: packet ?? null,
      readiness_state: null,
      packet_version: packet ? INTELLIGENCE_PACKET_VERSION : null,
      action_kind: null,
      execution_status: null,
    };
  }

  // 2. Every Mind-generated task needs a packet — shallow output is rejected.
  if (!packet) {
    throw new MindTaskQualityGateError(
      "Mind task rejected: no intelligence packet. Shallow title+description tasks are not " +
      "acceptable Mind output — build a packet (objective, targets, evidence, diagnosis, plan) " +
      "or create it as an explicit Human Task.",
      "insufficient_context",
      ["intelligence_packet"],
    );
  }

  const v = validateUniversalMindIntelligencePacket(packet);
  const isExecutable = row.task_category === "executable" || !!row.action_kind;

  if (isExecutable && !v.approvable) {
    if (opts.onIncomplete === "investigate") {
      // Downgrade: honest investigation/clarification task, no approve/run.
      return {
        ...row,
        task_category: "informational",
        action_kind: null,
        execution_status: null,
        input_spec: null,
        intelligence_packet: { ...packet, missing: [...(packet.missing ?? []), ...v.missing] },
        readiness_state: v.readiness,
        packet_version: INTELLIGENCE_PACKET_VERSION,
        metadata: { ...(row.metadata ?? {}), task_class: "informational", downgraded_from_executable: true },
      };
    }
    throw new MindTaskQualityGateError(
      `Executable Mind task rejected: readiness is "${v.readiness}" (missing: ${v.missing.join(", ") || "n/a"}). ` +
      "Incomplete proposals can never reach an approvable state.",
      v.readiness,
      v.missing,
    );
  }

  return {
    ...row,
    task_category: row.task_category ?? "informational",
    intelligence_packet: packet,
    readiness_state: v.readiness,
    packet_version: INTELLIGENCE_PACKET_VERSION,
    metadata: {
      ...(row.metadata ?? {}),
      task_class: isExecutable ? "executable" : "informational",
    },
  };
}

/** Enforcement for approve/run paths: refuse non-approvable readiness. */
export function assertTaskApprovable(task: {
  readiness_state?: string | null;
  intelligence_packet?: unknown;
}): void {
  // Legacy rows (created before the packet gate) have NULL readiness — the
  // legacy migration phase upgrades them; blocking them here would strand
  // pre-existing approved work, so only gated rows are enforced.
  if (task.readiness_state == null && task.intelligence_packet == null) return;
  if (!isApprovableReadiness(task.readiness_state)) {
    throw new MindTaskQualityGateError(
      `This task is not approvable yet — its readiness state is "${task.readiness_state ?? "unknown"}". ` +
      "Complete the missing details before approving.",
      (task.readiness_state as MindTaskReadinessState) ?? null,
    );
  }
}

// ── Untrusted packet ingestion ───────────────────────────────────────────────
/**
 * Strictly validate a proposer/payload-supplied packet (untrusted input, e.g.
 * hivemind_actions.action_payload.intelligence_packet). Returns a normalised
 * packet ONLY when the shape matches the current contract; anything malformed
 * returns null so the caller falls back to a trusted server-built packet.
 */
export function sanitizeIncomingPacket(raw: unknown): UniversalMindIntelligencePacket | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const p = raw as Record<string, any>;
  if (p.version !== INTELLIGENCE_PACKET_VERSION) return null;
  if (typeof p.mind !== "string" || !p.mind.trim()) return null;
  if (typeof p.objective !== "string" || !p.objective.trim()) return null;
  if (!p.intent || typeof p.intent !== "object" || typeof p.intent.source !== "string" || !p.intent.source.trim()) return null;
  const arrays = ["targets", "evidence", "plan_steps", "proposed_changes", "deliverables", "success_criteria", "limitations", "blockers", "missing"] as const;
  for (const key of arrays) {
    if (p[key] != null && !Array.isArray(p[key])) return null;
  }
  for (const t of p.targets ?? []) {
    if (!t || typeof t !== "object" || typeof t.entity_type !== "string" || typeof t.resolved !== "boolean") return null;
  }
  for (const e of p.evidence ?? []) {
    if (!e || typeof e !== "object" || typeof e.source !== "string" || typeof e.description !== "string") return null;
  }
  if (p.cost != null && (typeof p.cost !== "object" || typeof p.cost.known !== "boolean")) return null;
  // Honest cost rule holds even for supplied packets.
  if (p.cost && p.cost.known === false && p.cost.amount != null) return null;
  if (p.approval_scope != null && (typeof p.approval_scope !== "object" || typeof p.approval_scope.kind !== "string")) return null;
  return buildIntelligencePacket({
    mind: p.mind,
    objective: p.objective,
    intentSource: p.intent.source,
    instruction: typeof p.intent.instruction === "string" ? p.intent.instruction : null,
    targets: p.targets ?? [],
    evidence: p.evidence ?? [],
    diagnosis: typeof p.diagnosis === "string" ? p.diagnosis : null,
    planSteps: (p.plan_steps ?? []).map((s: any) => ({
      title: String(s?.title ?? ""), detail: s?.detail ?? null, action_kind: s?.action_kind ?? null,
    })),
    proposedChanges: p.proposed_changes ?? [],
    deliverables: (p.deliverables ?? []).map(String),
    successCriteria: (p.success_criteria ?? []).map(String),
    limitations: (p.limitations ?? []).map(String),
    cost: p.cost ?? undefined,
    approvalScope: p.approval_scope ?? null,
    monitoring: p.monitoring && typeof p.monitoring === "object" ? p.monitoring : null,
    blockers: p.blockers ?? [],
    missing: (p.missing ?? []).map(String),
    workspaceContext: p.workspace_context && typeof p.workspace_context === "object" ? p.workspace_context : null,
  });
}

// ── Evidence helper ──────────────────────────────────────────────────────────
export function evidenceItem(
  source: string,
  description: string,
  data?: Record<string, unknown> | null,
): PacketEvidence {
  return { source, description, data: data ?? null, retrieved_at: new Date().toISOString() };
}
