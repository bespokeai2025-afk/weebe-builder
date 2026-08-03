/**
 * Shared types for SystemMind workflow copilot (general + domain-specific).
 */
import { z } from "zod";
import { enrichCanvasNodeConfig } from "@/lib/wbah/workflow/wbah-node-display.shared";

export const WORKFLOW_TRIGGER_TYPES = [
  "call_completed",
  "lead_added",
  "lead_status_changed",
  "manual",
  "scheduled",
] as const;

export type WorkflowTriggerType = (typeof WORKFLOW_TRIGGER_TYPES)[number];

const emptyToUndefined = (v: unknown) =>
  v === "" || v === null || v === undefined ? undefined : v;

const TRIGGER_TYPE_ALIASES: Record<string, WorkflowTriggerType> = {
  webhook: "manual",
  http: "manual",
  api: "manual",
  ingress: "manual",
  instant: "manual",
  event: "lead_added",
  form: "lead_added",
  webform: "lead_added",
  lead: "lead_added",
  new_lead: "lead_added",
  status: "lead_status_changed",
  lead_status: "lead_status_changed",
  call: "call_completed",
  retell: "call_completed",
  post_call: "call_completed",
  postcall: "call_completed",
  voice: "call_completed",
  cron: "scheduled",
  schedule: "scheduled",
  timer: "scheduled",
};

export function normalizeTriggerType(
  raw: unknown,
  fallback: WorkflowTriggerType = "manual",
): WorkflowTriggerType {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return fallback;
  if ((WORKFLOW_TRIGGER_TYPES as readonly string[]).includes(s)) {
    return s as WorkflowTriggerType;
  }
  if (TRIGGER_TYPE_ALIASES[s]) return TRIGGER_TYPE_ALIASES[s];
  if (s.includes("call") || s.includes("retell") || s.includes("post-call")) {
    return "call_completed";
  }
  if (s.includes("lead") && s.includes("status")) return "lead_status_changed";
  if (s.includes("lead")) return "lead_added";
  if (s.includes("cron") || s.includes("schedul")) return "scheduled";
  if (s.includes("webhook") || s.includes("http")) return "manual";
  return fallback;
}

/** Map loose LLM node shapes → automation engine type string. */
export function inferAutomationNodeType(node: Record<string, unknown>): string | null {
  const explicit = String(
    node.type ?? node.nodeType ?? node.node_type ?? "",
  ).trim();
  if (explicit) return explicit;

  const kind = String(node.kind ?? node.node_kind ?? "").toLowerCase();
  const name = String(node.name ?? node.label ?? node.title ?? "").toLowerCase();

  if (kind === "webhook" || kind === "trigger" || name.includes("webhook")) return "core.webhook";
  if (kind === "http" || name.includes("http") || name.includes("api")) return "core.http.request";
  if (kind === "code" || kind === "function" || name.includes("function")) return "core.function";
  if (kind === "if" || kind === "condition" || name.includes("condition")) return "core.condition";
  if (kind === "wait" || kind === "delay") return "core.wait";
  if (kind === "merge") return "core.merge";
  if (kind === "end" || kind === "stop") return "core.end";
  if (name.includes("calendly")) return "wbah.calendly_link";

  return null;
}

function sanitizeCopilotNode(raw: unknown, index: number): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  const row = { ...(raw as Record<string, unknown>) };

  const type = inferAutomationNodeType(row);
  if (!type) return null;

  const id = String(row.id ?? row.nodeId ?? row.node_id ?? "").trim() || `node-${index + 1}`;
  const name = String(row.name ?? row.label ?? row.title ?? id).trim() || id;

  let config = row.config;
  if (!config || typeof config !== "object") {
    const { id: _i, type: _t, name: _n, label, kind, position, ...rest } = row;
    config = Object.keys(rest).length ? rest : {};
  }

  const out: Record<string, unknown> = {
    id,
    type,
    name,
    config: enrichCanvasNodeConfig(type, name, config as Record<string, unknown>),
  };

  const pos = row.position ?? row.pos;
  if (pos && typeof pos === "object") {
    const p = pos as Record<string, unknown>;
    const x = Number(p.x);
    const y = Number(p.y);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      out.position = { x, y };
    }
  }

  return out;
}

/** Strip empty strings / fix common LLM mistakes before zod parse. */
export function sanitizeWorkflowCopilotJson(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const o = { ...(raw as Record<string, unknown>) };

  const hasQuestions = Array.isArray(o.questions) && o.questions.length > 0;

  if (o.mode !== "clarify" && o.mode !== "build") {
    o.mode = hasQuestions ? "clarify" : "build";
  }

  const wf = o.workflow;
  if (wf && typeof wf === "object") {
    const w = { ...(wf as Record<string, unknown>) };
    if (w.trigger_type !== undefined && w.trigger_type !== null && w.trigger_type !== "") {
      w.trigger_type = normalizeTriggerType(w.trigger_type);
    } else {
      delete w.trigger_type;
    }
    if (w.name === "") delete w.name;
    if (w.purpose === "") delete w.purpose;

    if (Array.isArray(w.nodes)) {
      const cleaned = w.nodes
        .map((n, i) => sanitizeCopilotNode(n, i))
        .filter((n): n is Record<string, unknown> => n !== null);

      if (cleaned.length > 0) {
        w.nodes = cleaned;
      } else {
        delete w.nodes;
        delete w.connections;
      }
    }

    // Clarify turns should not carry half-built graphs
    if (o.mode === "clarify" || hasQuestions) {
      delete w.nodes;
      delete w.connections;
    }

    if (Object.keys(w).length === 0) {
      delete o.workflow;
    } else {
      o.workflow = w;
    }
  }

  if (o.mode === "build" && !(o.workflow as Record<string, unknown> | undefined)?.nodes) {
    o.mode = "clarify";
  }

  if (Array.isArray(o.questions)) {
    o.questions = (o.questions as unknown[]).map((q) => {
      if (!q || typeof q !== "object") return q;
      const row = { ...(q as Record<string, unknown>) };
      const kinds = ["text", "url", "env_var", "choice", "boolean"];
      if (!kinds.includes(String(row.kind ?? ""))) row.kind = "text";
      if (!row.id || row.id === "") row.id = `q-${Math.random().toString(36).slice(2, 8)}`;
      return row;
    });
  }

  return o;
}

export const CopilotQuestionSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  kind: z.preprocess(
    (v) => {
      const s = String(v ?? "text");
      return ["text", "url", "env_var", "choice", "boolean"].includes(s) ? s : "text";
    },
    z.enum(["text", "url", "env_var", "choice", "boolean"]),
  ),
  options: z.array(z.string()).optional(),
  required: z.boolean().optional(),
  placeholder: z.string().optional(),
});

export type CopilotQuestion = z.infer<typeof CopilotQuestionSchema>;

export const CopilotEnvVarSchema = z.object({
  name: z.string(),
  description: z.string(),
  example: z.string().optional(),
});

export const CopilotLinkRequirementSchema = z.object({
  label: z.string(),
  description: z.string(),
  example: z.string().optional(),
});

export const AutomationCopilotNodeSchema = z.object({
  id: z.preprocess(
    (v) => (String(v ?? "").trim() || undefined),
    z.string().min(1).max(120),
  ),
  type: z.preprocess(
    (v) => (String(v ?? "").trim() || undefined),
    z.string().min(1).max(120),
  ),
  name: z.string().optional(),
  config: z.record(z.unknown()).default({}),
  position: z.object({ x: z.number(), y: z.number() }).optional(),
});

export const AutomationCopilotConnectionSchema = z.object({
  from: z.object({ node: z.string(), port: z.string().default("main") }),
  to: z.object({ node: z.string(), port: z.string().default("main") }),
});

export const WorkflowCopilotResponseSchema = z.object({
  mode: z.enum(["clarify", "build"]),
  summary: z.string().min(1).max(4000),
  questions: z.array(CopilotQuestionSchema).optional(),
  required_credentials: z.array(z.string()).max(20).optional(),
  required_env_vars: z.array(CopilotEnvVarSchema).max(20).optional(),
  required_links: z.array(CopilotLinkRequirementSchema).max(20).optional(),
  workflow: z
    .object({
      name: z.string().max(200).optional(),
      purpose: z.string().max(2000).optional(),
      trigger_type: z.preprocess(
        (v) => {
          const cleaned = emptyToUndefined(v);
          if (cleaned === undefined) return undefined;
          return normalizeTriggerType(cleaned);
        },
        z.enum(WORKFLOW_TRIGGER_TYPES).optional(),
      ),
      nodes: z.array(AutomationCopilotNodeSchema).optional(),
      connections: z.array(AutomationCopilotConnectionSchema).optional(),
    })
    .optional(),
  remove_node_ids: z.array(z.string()).optional(),
});

export type WorkflowCopilotResponse = z.infer<typeof WorkflowCopilotResponseSchema>;

export type WorkflowCopilotResult = {
  mode: "clarify" | "build";
  versionId?: string;
  versionNumber?: number;
  assistantSummary: string;
  questions?: CopilotQuestion[];
  requiredEnvVars?: Array<{ name: string; description: string; example?: string }>;
  requiredLinks?: Array<{ label: string; description: string; example?: string }>;
  requiredCredentials?: string[];
};
