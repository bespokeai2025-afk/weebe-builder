// ── AI task-classification router ─────────────────────────────────────────────
// Classifies each Mind AI request into an explicit routing class and maps it
// to a (model, reasoning effort) pair from the central model registry.
//
// Classification uses request CONTENT + tool needs + scope signals — never
// message length alone. The decision is returned to the caller so it can be
// recorded in the ai_usage_ledger `routing` column and shown in admin
// diagnostics. Normal users only ever see the friendly label.
//
// Classes:
//   lightweight     → gpt-5.6-luna  (background: classification, tagging, phrasing)
//   standard        → gpt-5.6-terra (normal conversational answers)
//   tool_execution  → gpt-5.6-terra (tool-calling loop rounds)
//   data_analysis   → gpt-5.6-sol   (cross-department / numeric deep analysis)
//   executive       → gpt-5.6-sol   (strategic, high-impact reasoning)
//   high_risk       → gpt-5.6-sol   (destructive/approval-adjacent, high reasoning)

import { resolveModelForRole } from "./model-registry.server";
import type { ModelRole, ReasoningEffort } from "./model-registry.shared";

export type AiTaskClass =
  | "lightweight"
  | "standard"
  | "executive"
  | "high_risk"
  | "tool_execution"
  | "data_analysis";

export type AiRoutingDecision = {
  taskClass: AiTaskClass;
  role: ModelRole;
  model: string;
  reasoningEffort: ReasoningEffort | null;
  friendlyLabel: string;
  reason: string;
  signals: string[];
};

export type ClassifyAiTaskInput = {
  /** Latest user request text (or a short description for background jobs). */
  query: string;
  /** Whether this call runs inside a function/tool-calling loop with tools attached. */
  toolsAvailable?: boolean;
  /** Force the background/lightweight class (schedulers, classifiers, taggers). */
  backgroundJob?: boolean;
  /** Caller-declared feature (chat, briefing, dna_discovery, exec_reasoning…). */
  feature?: string;
  /** Department the request belongs to (affects role lookup only). */
  department?: "hivemind" | "growthmind";
};

// Signal patterns — deliberately about INTENT and SCOPE, not length.
const EXEC_PATTERNS: Array<[RegExp, string]> = [
  [/\b(strateg(y|ic|ise|ize)|roadmap|long[- ]term|quarterly|annual plan)\b/i, "strategic language"],
  [/\b(should (we|i)|what would you (do|recommend)|trade[- ]?offs?|pros and cons|weigh up)\b/i, "decision request"],
  [/\b(deep|thorough|detailed|comprehensive|in[- ]depth|full) (analysis|review|assessment|breakdown|audit)\b/i, "explicit deep-analysis request"],
  [/\b(why (is|are|did|has|have)|root cause|diagnos(e|is)|underperform|declin(e|ing)|dropp(ed|ing))\b/i, "causal/diagnostic question"],
  [/\b(revenue|profit|pricing|budget|forecast|invest|hiring|restructur)\b/i, "high business impact"],
  [/\b(across (all|my|the) (departments?|teams?|channels?|campaigns?)|whole business|entire (pipeline|business|operation))\b/i, "cross-department scope"],
];

const DATA_PATTERNS: Array<[RegExp, string]> = [
  [/\b(compare|correlat|trend|regression|cohort|attribution|conversion funnel)\b/i, "comparative/statistical analysis"],
  [/\b(last \d+ (days?|weeks?|months?)|month[- ]over[- ]month|week[- ]over[- ]week|year[- ]over[- ]year)\b/i, "time-window analysis"],
  [/\b(break (it |this )?down|segment(ed)? by|group(ed)? by|per (channel|campaign|agent|source))\b/i, "segmentation request"],
];

const HIGH_RISK_PATTERNS: Array<[RegExp, string]> = [
  [/\b(delete|remove|cancel|shut ?down|deactivate|wipe|purge) (all|every|my|the)\b/i, "destructive scope"],
  [/\b(send (to|all)|blast|mass (email|message|campaign)|contact (all|every))\b/i, "mass outbound action"],
  [/\b(spend|charge|pay|transfer) .{0,24}(£|\$|€|\d)/i, "financial commitment"],
];

const LIGHTWEIGHT_FEATURES = new Set([
  "dna_discovery", "classification", "sentiment", "lead_categorisation",
  "intent", "notification_summary", "tagging", "exec_reasoning_phrasing",
]);

/**
 * Classify a request and resolve the model + reasoning effort to use.
 * Deterministic — no AI call is made to route.
 */
export function classifyAiTask(input: ClassifyAiTaskInput): AiRoutingDecision {
  const department = input.department ?? "hivemind";
  const q = input.query ?? "";
  const signals: string[] = [];

  const decide = (taskClass: AiTaskClass, reason: string): AiRoutingDecision => {
    const role: ModelRole =
      taskClass === "lightweight"
        ? "hivemind_background"
        : taskClass === "executive" || taskClass === "high_risk" || taskClass === "data_analysis"
          ? "hivemind_executive"
          : department === "growthmind"
            ? "growthmind_chat"
            : "hivemind_chat";
    const a = resolveModelForRole(role);
    // High reasoning ONLY for genuinely high-risk requests — never default.
    const reasoningEffort: ReasoningEffort | null =
      taskClass === "high_risk" ? "high" : a.reasoningEffort;
    return {
      taskClass, role, model: a.model, reasoningEffort,
      friendlyLabel: a.friendlyLabel, reason, signals,
    };
  };

  // 1. Background jobs are always lightweight — cheapest capable model.
  if (input.backgroundJob || (input.feature && LIGHTWEIGHT_FEATURES.has(input.feature))) {
    signals.push("background job");
    return decide("lightweight", "Background/classification job — routed to the fast background model.");
  }

  // 2. High-risk intent beats everything else (also escalates reasoning).
  for (const [re, label] of HIGH_RISK_PATTERNS) {
    if (re.test(q)) {
      signals.push(label);
      return decide("high_risk", `High-risk request (${label}) — escalated to the executive model with high reasoning.`);
    }
  }

  // 3. Executive / strategic signals.
  let execHits = 0;
  for (const [re, label] of EXEC_PATTERNS) {
    if (re.test(q)) { execHits++; signals.push(label); }
  }
  if (execHits >= 1) {
    return decide("executive", `Executive-level request (${signals.join(", ")}) — escalated to the advanced reasoning model.`);
  }

  // 4. Data-analysis signals (needs at least 2 to justify the bigger model).
  let dataHits = 0;
  for (const [re, label] of DATA_PATTERNS) {
    if (re.test(q)) { dataHits++; signals.push(label); }
  }
  if (dataHits >= 2) {
    return decide("data_analysis", `Multi-signal data analysis (${signals.join(", ")}) — escalated to the advanced reasoning model.`);
  }

  // 5. Tool-calling rounds — standard model, tools attached.
  if (input.toolsAvailable) {
    signals.push("tools attached");
    return decide("tool_execution", "Tool-calling round — standard model with function calling.");
  }

  return decide("standard", "Standard conversational request.");
}

/** Compact routing metadata for the ai_usage_ledger `routing` column. */
export function routingLedgerMeta(d: AiRoutingDecision): Record<string, unknown> {
  return {
    taskClass: d.taskClass,
    role: d.role,
    model: d.model,
    reasoningEffort: d.reasoningEffort,
    reason: d.reason,
    signals: d.signals.slice(0, 8),
  };
}

/**
 * Feature flag — temporary rollback to the legacy gpt-4o chat-completions
 * path. Set AI_LEGACY_CHAT_COMPLETIONS=1 to restore old behavior.
 */
export function useLegacyAiPath(): boolean {
  return process.env.AI_LEGACY_CHAT_COMPLETIONS === "1";
}
