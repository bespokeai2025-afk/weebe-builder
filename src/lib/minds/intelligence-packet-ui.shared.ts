/**
 * Intelligence-packet UI contract — pure, client-safe helpers shared by the
 * Tasks page, Action Approval Centre and the HiveMind orb.
 *
 * Maps readiness states to the ONE control a card may show (never a generic
 * "Approve" for an incomplete proposal), derives exact scoped approval labels
 * from the packet's approval scope + target domain, and builds the rich
 * approval-dialog metadata (effect, records, provider, risk, reversibility,
 * what is NOT authorised) for both packet-gated tasks and hivemind_actions.
 *
 * UI gating here is convenience only — the server validator / approve fns
 * remain the enforcement point.
 */
import {
  isApprovableReadiness,
  READINESS_LABELS,
  type MindTaskReadinessState,
  type UniversalMindIntelligencePacket,
} from "@/lib/minds/intelligence-packet.shared";

// ── Readiness-driven controls ────────────────────────────────────────────────
export type ReadinessControlKind = "fix" | "approve" | "info";

export interface ReadinessControl {
  kind: ReadinessControlKind;
  /** Button label, e.g. "Supply Missing Details" or "Approve Analysis". */
  label: string;
  /** One-line explanation of why this control (not Approve) is shown. */
  explanation: string;
}

const FIX_CONTROLS: Record<string, { label: string; explanation: string }> = {
  insufficient_context: {
    label: "Supply Missing Details",
    explanation: "The Mind does not yet have enough context to propose anything approvable.",
  },
  target_resolution_required: {
    label: "Select Target",
    explanation: "The exact record this work applies to has not been resolved yet.",
  },
  integration_required: {
    label: "Connect Provider",
    explanation: "A required provider integration is not connected.",
  },
  evidence_gathering: {
    label: "Refresh Data",
    explanation: "Supporting evidence has not been gathered yet.",
  },
  investigation_required: {
    label: "Run Investigation",
    explanation: "Evidence exists but no diagnosis has been produced yet.",
  },
  proposal_incomplete: {
    label: "Generate Draft",
    explanation: "The proposal is missing plan, deliverables, success criteria or cost honesty.",
  },
  blocked: {
    label: "View Blocker",
    explanation: "A hard blocker prevents this task from progressing.",
  },
};

/** Scoped approve labels per approvable readiness state (base form). */
const APPROVE_LABELS: Record<string, string> = {
  ready_for_review:               "Review Deliverable",
  ready_for_analysis_approval:    "Approve Analysis",
  ready_for_content_approval:     "Approve Content",
  ready_for_change_approval:      "Approve Changes",
  ready_for_publication_approval: "Approve Publication",
  ready_for_execution:            "Approve & Execute",
};

/**
 * Refine the base approve label with the packet's domain/entity so approvals
 * say exactly what is being authorised (Approve Email Copy, Approve Audience,
 * Approve Provider Changes, Approve and Launch, …).
 */
export function scopedApprovalLabel(
  readiness: string | null | undefined,
  packet?: UniversalMindIntelligencePacket | null,
): string {
  const base = APPROVE_LABELS[readiness ?? ""] ?? "Approve";
  const target = packet?.targets?.[0];
  const et = (target?.entity_type ?? "").toLowerCase();
  const domain = (target?.domain ?? "").toLowerCase();
  switch (readiness) {
    case "ready_for_content_approval":
      if (et.includes("email") || et.includes("hexmail")) return "Approve Email Copy";
      if (et.includes("whatsapp") || et.includes("broadcast")) return "Approve Message Copy";
      if (et.includes("script") || domain === "voice") return "Approve Call Script";
      return base;
    case "ready_for_change_approval":
      if (et.includes("segment") || et.includes("audience") || et.includes("lead")) return "Approve Audience";
      if (et.includes("gads") || et.includes("provider") || et.includes("agent") || domain === "systems") {
        return "Approve Provider Changes";
      }
      return base;
    case "ready_for_execution":
      if (et.includes("campaign")) return "Approve and Launch";
      if (et.includes("broadcast") || et.includes("email") || et.includes("whatsapp")) return "Approve and Send";
      return base;
    default:
      return base;
  }
}

/**
 * The single readiness-appropriate control for a gated task card.
 * Legacy rows (no readiness AND no packet) return null — caller keeps its
 * pre-gate behaviour for them.
 */
export function readinessControlFor(task: {
  readiness_state?: string | null;
  intelligence_packet?: unknown;
}): ReadinessControl | null {
  const readiness = task.readiness_state ?? null;
  if (readiness == null && task.intelligence_packet == null) return null;
  if (isApprovableReadiness(readiness)) {
    return {
      kind: "approve",
      label: scopedApprovalLabel(readiness, task.intelligence_packet as UniversalMindIntelligencePacket | null),
      explanation: (task.intelligence_packet as UniversalMindIntelligencePacket | null)?.approval_scope?.summary
        ?? "This proposal is complete and ready for your explicit approval.",
    };
  }
  if (readiness === "ready_for_review") {
    // Deliverable is complete but nothing consequential is pending approval —
    // the server will NOT accept an approve for this state, so surface a
    // review control instead of a generic Approve.
    return {
      kind: "info",
      label: "Review Deliverable",
      explanation: "The deliverable is ready to review. Nothing further is executed by reviewing it.",
    };
  }
  const fix = FIX_CONTROLS[readiness ?? "insufficient_context"] ?? FIX_CONTROLS.insufficient_context;
  return { kind: "fix", label: fix.label, explanation: fix.explanation };
}

export function readinessLabel(state: string | null | undefined): string {
  return READINESS_LABELS[state as MindTaskReadinessState] ?? "Pre-gate (legacy)";
}

// ── Data freshness ───────────────────────────────────────────────────────────
/** Newest evidence retrieved_at across the packet, or null. */
export function packetDataFreshness(packet: UniversalMindIntelligencePacket | null | undefined): string | null {
  const times = (packet?.evidence ?? [])
    .map((e) => Date.parse(e.retrieved_at))
    .filter((t) => Number.isFinite(t));
  if (!times.length) return null;
  return new Date(Math.max(...times)).toISOString();
}

/** Main blocker line: first hard blocker, else first missing item. */
export function packetMainBlocker(packet: UniversalMindIntelligencePacket | null | undefined): string | null {
  if (!packet) return null;
  if (packet.blockers?.length) return packet.blockers[0].detail;
  if (packet.missing?.length) return packet.missing[0];
  return null;
}

/** Optional confidence carried in workspace_context (0–1 or 0–100). */
export function packetConfidence(packet: UniversalMindIntelligencePacket | null | undefined): number | null {
  const raw = (packet?.workspace_context as Record<string, unknown> | null | undefined)?.confidence;
  const n = typeof raw === "number" ? raw : NaN;
  if (!Number.isFinite(n)) return null;
  return n <= 1 ? Math.round(n * 100) : Math.round(n);
}

// ── Approval dialog metadata ─────────────────────────────────────────────────
export interface ApprovalDialogMeta {
  /** Exact scoped approval button label. */
  approveLabel: string;
  /** What exactly happens when approved. */
  effect: string;
  /** Which records are affected (counts/names, never raw UUID walls). */
  recordsAffected: string;
  provider: string | null;
  currentState: string | null;
  proposedState: string | null;
  risk: string;
  reversible: boolean | null;
  version: string | null;
  whatHappensNext: string;
  notAuthorised: string;
  sensitive: boolean;
}

/** Dialog metadata for a packet-gated task approval. */
export function taskApprovalMeta(task: {
  title?: string | null;
  readiness_state?: string | null;
  intelligence_packet?: unknown;
  action_kind?: string | null;
}): ApprovalDialogMeta {
  const packet = (task.intelligence_packet ?? null) as UniversalMindIntelligencePacket | null;
  const scope = packet?.approval_scope ?? null;
  const targets = packet?.targets ?? [];
  const changes = packet?.proposed_changes ?? [];
  const reversible = changes.length ? changes.every((c) => c.reversible) : null;
  return {
    approveLabel: scopedApprovalLabel(task.readiness_state, packet),
    effect: scope?.summary
      ?? `Approve and run "${task.title ?? "this task"}" through its assigned Mind's execution engine.`,
    recordsAffected: targets.length
      ? targets.map((t) => `${t.entity_type}${t.entity_name ? ` "${t.entity_name}"` : ""}`).join(", ")
      : "No specific records targeted.",
    provider: targets.find((t) => t.domain === "marketing" || t.domain === "comms" || t.domain === "voice")
      ?.entity_type ?? null,
    currentState: packet?.diagnosis ?? null,
    proposedState: changes.length
      ? changes.map((c) => `${c.target}: ${c.change}`).join("; ")
      : (packet?.deliverables?.join("; ") || null),
    risk: packet?.limitations?.length
      ? packet.limitations.join(" ")
      : "No specific risks recorded for this proposal.",
    reversible,
    version: packet ? `packet v${packet.version}` : null,
    whatHappensNext:
      "A tracked execution starts through the shared engine. Consequential changes surface as separate approvals; progress, evidence and results appear on this task.",
    notAuthorised:
      "Nothing beyond the scope above. No spend changes, no external provider writes, and no other records are authorised by this approval.",
    sensitive: scope?.sensitive ?? false,
  };
}

/** Scoped labels + dialog metadata for the existing hivemind_actions types. */
const ACTION_APPROVAL_META: Record<string, {
  label: string; effect: string; risk: string; reversible: boolean;
  provider?: string; notAuthorised?: string;
}> = {
  create_task: {
    label: "Approve Task Creation",
    effect: "Creates one internal follow-up task in HiveMind Tasks.",
    risk: "Low — an internal record only.", reversible: true,
  },
  create_followup_campaign: {
    label: "Approve Campaign Draft",
    effect: "Creates a HexMail follow-up campaign in DRAFT and enrolls the listed leads.",
    risk: "Low-medium — no emails are sent until the campaign is activated.", reversible: true,
    provider: "HexMail (Resend)",
  },
  enroll_leads_in_campaign: {
    label: "Approve Audience",
    effect: "Enrolls the listed leads into the selected campaign as active recipients.",
    risk: "Medium — enrolled leads will receive the campaign's scheduled sends.", reversible: true,
    provider: "HexMail (Resend)",
  },
  move_pipeline_stage: {
    label: "Approve Pipeline Move",
    effect: "Updates the status/pipeline stage of the listed leads.",
    risk: "Low — lead statuses can be moved back.", reversible: true,
  },
  assign_knowledge_base: {
    label: "Approve Knowledge Base Assignment",
    effect: "Points the selected agent at the chosen knowledge base for future calls.",
    risk: "Medium — changes what the live agent says on calls.", reversible: true,
  },
  launch_broadcast: {
    label: "Approve and Send",
    effect: "Sends the broadcast to its audience.",
    risk: "High — messages cannot be recalled once sent.", reversible: false,
    notAuthorised: "No additional sends or audience changes beyond this broadcast.",
  },
  growthmind_video_campaign: {
    label: "Approve Video Generation",
    effect: "Queues an AI video generation job in Video Studio.",
    risk: "Low-medium — consumes generation credits; nothing is published.", reversible: true,
    provider: "Veo / Video Studio",
  },
  growthmind_growth_campaign: {
    label: "Approve Campaign Draft",
    effect: "Creates a growth campaign DRAFT in Campaign Factory.",
    risk: "Low — a draft only; launching it is a separate approval.", reversible: true,
  },
  register_resend_webhook: {
    label: "Approve Provider Changes",
    effect: "Registers the deliverability webhook with Resend for this workspace.",
    risk: "Low — improves bounce/complaint tracking.", reversible: true, provider: "Resend",
  },
  sync_ad_stats: {
    label: "Approve Data Sync",
    effect: "Pulls the latest ad statistics from connected ad accounts (read-only).",
    risk: "Low — read-only sync.", reversible: true, provider: "Connected ad platforms",
  },
  send_workflow_draft_to_builder: {
    label: "Approve Draft Handoff",
    effect: "Marks the workflow draft as sent to the Builder for manual wiring.",
    risk: "Low — a status change only.", reversible: true,
  },
  activate_lead_intake_workflow: {
    label: "Approve and Launch",
    effect: "Enables auto-calling of every new lead with the selected qualification agent and activates the intake workflow.",
    risk: "High — real outbound calls will be placed automatically (3/number/day cap).", reversible: true,
    provider: "WEBEE Voice",
    notAuthorised: "No calls to existing leads outside the intake flow; no agent or script changes.",
  },
  activate_systemmind_automation: {
    label: "Approve Automation Activation",
    effect: "Activates the SystemMind automation described in this action.",
    risk: "Medium — the automation will run on its trigger until paused.", reversible: true,
  },
  gads_create_change_requests: {
    label: "Approve Provider Changes",
    effect: "Converts the analysis recommendations into approved Google Ads change-request drafts (internal records).",
    risk: "Low — NO live Google Ads changes are made (external write is intentionally absent).", reversible: true,
    provider: "Google Ads (drafts only)",
    notAuthorised: "No live Google Ads writes — applying drafts to Google Ads requires a separate, currently absent integration.",
  },
  run_orchestration_playbook: {
    label: "Approve Playbook Run",
    effect: "Runs the coordinated cross-Mind playbook, creating proposal-only tasks.",
    risk: "Low — playbooks propose work; they do not execute external changes.", reversible: true,
  },
  seo_campaign_approval: {
    label: "Approve SEO Stage",
    effect: "Approves the pending SEO campaign stage so it can proceed.",
    risk: "Medium — content/publication follow-through is queued.", reversible: true,
  },
  content_publication_approval: {
    label: "Approve Publication",
    effect: "Publishes the approved content to the connected destination.",
    risk: "High — the content goes live publicly.", reversible: false,
    notAuthorised: "Only this content item, to its stated destination. No other publications.",
  },
  growthmind_publish_content: {
    label: "Approve Publication",
    effect: "Publishes (or schedules) the approved content project to the connected social account.",
    risk: "High — the post goes live on the connected account.", reversible: false,
    provider: "Meta",
    notAuthorised: "Only this project's approved media/caption. No other posts or account changes.",
  },
};

export function actionApprovalMeta(action: {
  action_type: string;
  title?: string | null;
  description?: string | null;
  action_payload?: Record<string, unknown> | null;
  sensitive?: boolean | null;
}): ApprovalDialogMeta {
  const p = (action.action_payload ?? {}) as Record<string, any>;
  const packet = (p.intelligence_packet ?? null) as UniversalMindIntelligencePacket | null;
  const m = ACTION_APPROVAL_META[action.action_type];
  const leadCount = Array.isArray(p.lead_ids) ? p.lead_ids.length : 0;
  const records: string[] = [];
  if (leadCount) records.push(`${leadCount} lead${leadCount === 1 ? "" : "s"}`);
  if (p.campaign_id) records.push("1 campaign");
  if (p.agent_id) records.push("1 agent");
  if (p.project_id) records.push("1 content project");
  if (p.draft_id) records.push("1 workflow draft");
  if (Array.isArray(p.recommendation_ids)) records.push(`${p.recommendation_ids.length} recommendation(s)`);
  return {
    approveLabel: m?.label ?? "Approve Action",
    effect: m?.effect ?? action.description ?? `Executes "${action.title ?? action.action_type}".`,
    recordsAffected: records.length ? records.join(", ") : "See action payload (Developer Details).",
    provider: m?.provider ?? null,
    currentState: packet?.diagnosis ?? (p.new_status ? "Current lead status/stage as shown on each lead." : null),
    proposedState: p.new_status
      ? `Status → ${p.new_status}${p.new_stage ? `, stage → ${p.new_stage}` : ""}`
      : packet?.proposed_changes?.map((c) => `${c.target}: ${c.change}`).join("; ") ?? null,
    risk: m?.risk ?? "Review the payload before approving.",
    reversible: m?.reversible ?? null,
    version: packet ? `packet v${packet.version}` : null,
    whatHappensNext:
      "Approval is consumed once (single-use) and re-validated server-side before the action executes through the guarded tool registry. Results and errors appear on this card.",
    notAuthorised: m?.notAuthorised
      ?? "Nothing beyond the effect above — no other records, providers or spend are authorised.",
    sensitive: action.sensitive === true || (packet?.approval_scope?.sensitive ?? false),
  };
}
