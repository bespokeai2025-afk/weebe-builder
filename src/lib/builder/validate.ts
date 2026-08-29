import type { Edge } from "@xyflow/react";
import type { BuilderVariable, FlowNode } from "./types";
import { isE164, normalizeTransferNumber } from "./export-conversation-flow";
import { unknownTemplateVars } from "./flow-variables";
import { isEquationCondition } from "../voice/graph/transition-engine.shared";
import type { GraphSlice } from "./graph-ops";

export interface ValidationIssue {
  level: "warn" | "error";
  message: string;
  nodeId?: string;
}

function startNodes(nodes: FlowNode[]): FlowNode[] {
  const marked = nodes.filter((n) => n.data.isStart || n.data.kind === "begin");
  if (marked.length) return marked;
  return nodes.filter((n) => n.data.kind === "wa_start");
}

function reachableIds(startId: string, edges: Edge[]): Set<string> {
  const outgoing = new Map<string, string[]>();
  for (const e of edges) {
    if (!e.source || !e.target) continue;
    const list = outgoing.get(e.source) ?? [];
    list.push(e.target);
    outgoing.set(e.source, list);
  }
  const seen = new Set<string>([startId]);
  const queue = [startId];
  while (queue.length) {
    const id = queue.shift()!;
    for (const next of outgoing.get(id) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

function hasOutgoing(nodeId: string, edges: Edge[], node: FlowNode): boolean {
  if (edges.some((e) => e.source === nodeId)) return true;
  return (node.data.transitions ?? []).some((t) => Boolean(t.target));
}

function cyclePaths(startId: string, edges: Edge[]): string[][] {
  const outgoing = new Map<string, string[]>();
  for (const e of edges) {
    if (!e.source || !e.target) continue;
    const list = outgoing.get(e.source) ?? [];
    list.push(e.target);
    outgoing.set(e.source, list);
  }
  const cycles: string[][] = [];
  const stack: string[] = [];
  const onStack = new Set<string>();
  const seen = new Set<string>();

  function visit(id: string) {
    if (onStack.has(id)) {
      const start = stack.indexOf(id);
      if (start >= 0) cycles.push(stack.slice(start).concat(id));
      return;
    }
    if (seen.has(id)) return;
    seen.add(id);
    stack.push(id);
    onStack.add(id);
    for (const next of outgoing.get(id) ?? []) visit(next);
    stack.pop();
    onStack.delete(id);
  }

  visit(startId);
  return cycles;
}

function isUnconditional(condition: string): boolean {
  const t = condition.trim().toLowerCase();
  return t === "" || t === "else" || t === "timeout" || t === "default" || t === "fallback";
}

function invalidEquationMessage(
  condition: string,
  equations?: { left: string; operator: string; right?: string }[],
): string | null {
  if (equations && equations.length > 0) {
    for (const clause of equations) {
      const left = String(clause.left ?? "").trim();
      if (!left) return "Equation is missing a variable on the left side.";
      if (!/\{\{[a-zA-Z_][a-zA-Z0-9_]*\}\}/.test(left) && !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(left)) {
        return `Equation left side "${left}" must be a {{variable}}.`;
      }
      const op = String(clause.operator ?? "");
      if (op !== "exists" && op !== "not_exists" && !String(clause.right ?? "").trim()) {
        return `Equation "${left} ${op}" is missing a right-hand value.`;
      }
    }
    return null;
  }
  const t = condition.trim();
  if (!t) return "Equation condition is empty.";
  if (!/\{\{[a-zA-Z_][a-zA-Z0-9_]*\}\}/.test(t)) {
    return `Equation "${t}" must reference a {{variable}}.`;
  }
  if (!isEquationCondition(t)) {
    return `Equation "${t}" is not a valid comparison (use =, ≠, contains, does not contain, exists).`;
  }
  if (/(?:==|!=|<=|>=|<|>|=|contains|matches|not_contains)\s*$/i.test(t)) {
    return `Equation "${t}" is missing a right-hand value.`;
  }
  return null;
}

export function validateFlow(
  nodes: FlowNode[],
  edges: Edge[],
  variables: BuilderVariable[] = [],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const ids = new Set(nodes.map((n) => n.id));
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target))
      issues.push({ level: "error", message: `Dangling edge ${e.id}.` });
  }

  const starts = startNodes(nodes);
  if (nodes.length > 0 && starts.length === 0) {
    issues.push({
      level: "error",
      message: "Flow has no start node. Mark a node as Start so the agent has an entry path.",
    });
  }
  if (starts.length > 1) {
    issues.push({
      level: "warn",
      message: `Multiple start nodes (${starts.length}). Only one entry path should be marked.`,
    });
  }

  const reachable = starts.length
    ? reachableIds(starts[0]!.id, edges.filter((e) => ids.has(e.source) && ids.has(e.target)))
    : new Set<string>();

  for (const n of nodes) {
    if (n.data.kind === "conversation" && !n.data.dialogue.trim())
      issues.push({
        level: "warn",
        message: `Conversation "${n.data.label}" has empty prompt.`,
        nodeId: n.id,
      });
    if (n.data.kind === "ending" && !String(n.data.endingPrompt ?? n.data.dialogue ?? "").trim())
      issues.push({
        level: "warn",
        message: `Ending "${n.data.label}" has no goodbye / end prompt.`,
        nodeId: n.id,
      });
    if (n.data.kind === "http_request" && !String(n.data.httpUrl ?? "").trim())
      issues.push({
        level: "error",
        message: `HTTP Request "${n.data.label}" has no URL.`,
        nodeId: n.id,
      });
    if (n.data.kind === "mcp" && !String(n.data.mcpServerUrl ?? "").trim())
      issues.push({
        level: "error",
        message: `MCP "${n.data.label}" has no server URL.`,
        nodeId: n.id,
      });
    if (n.data.kind === "mcp" && !String(n.data.mcpToolName ?? "").trim())
      issues.push({
        level: "warn",
        message: `MCP "${n.data.label}" has no tool name selected.`,
        nodeId: n.id,
      });
    if (n.data.kind === "subagent" && !n.data.dialogue.trim())
      issues.push({
        level: "warn",
        message: `Subagent "${n.data.label}" has empty prompt.`,
        nodeId: n.id,
      });
    if (n.data.kind === "wait" && (n.data.waitTimeoutMs ?? 8000) < 500)
      issues.push({
        level: "warn",
        message: `Wait "${n.data.label}" timeout is very short.`,
        nodeId: n.id,
      });
    if (
      n.data.kind === "function" &&
      !String(n.data.toolId ?? "").trim() &&
      !String(n.data.toolName ?? "").trim()
    ) {
      issues.push({
        level: "warn",
        message: `Function "${n.data.label}" has no tool selected.`,
        nodeId: n.id,
      });
    }
    if (n.data.kind === "code" && !String(n.data.codeSource ?? "").trim())
      issues.push({
        level: "warn",
        message: `Code "${n.data.label}" has no source. Code nodes do not run until a sandbox is configured.`,
        nodeId: n.id,
      });
    if (n.data.kind === "extract_variable") {
      const list = n.data.extractVariables ?? [];
      const legacy = String(n.data.variableName ?? "").trim();
      if (list.length === 0 && !legacy) {
        issues.push({
          level: "warn",
          message: `Extract Variable "${n.data.label}" has no variables configured.`,
          nodeId: n.id,
        });
      }
    }
    if (n.data.kind === "call_transfer") {
      const mode = n.data.transferMode ?? "static";
      if (mode === "dynamic") {
        const v = String(n.data.transferDynamicVariable ?? "").trim();
        if (!v) {
          issues.push({
            level: "error",
            message: `Call Transfer "${n.data.label}" is set to Dynamic Routing but no variable name was provided.`,
            nodeId: n.id,
          });
        }
      } else {
        const num = normalizeTransferNumber(n.data.transferNumber ?? "");
        if (!num) {
          issues.push({
            level: "error",
            message: `Call Transfer "${n.data.label}" has no transfer destination.`,
            nodeId: n.id,
          });
        } else {
          const isSip = /^sip:/i.test(num);
          const ignore = !!n.data.ignoreE164Validation;
          if (!isSip && !ignore && !isE164(num)) {
            issues.push({
              level: "error",
              message: `Call Transfer "${n.data.label}" has an invalid number "${num}". Use E.164 (e.g. +14155551234), a SIP URI, or enable raw format. UK numbers like 07412345678 are auto-normalized.`,
              nodeId: n.id,
            });
          }
        }
      }
      const type =
        n.data.transferType === "warm_handoff"
          ? "agentic_warm_transfer"
          : (n.data.transferType ?? "cold_transfer");
      const ring = n.data.transferRingDurationSec ?? 30;
      if (ring < 5 || ring > 90) {
        issues.push({
          level: "error",
          message: `Call Transfer "${n.data.label}" ring duration must be between 5 and 90 seconds.`,
          nodeId: n.id,
        });
      }
      if (
        n.data.transferExtensionNumber &&
        !/^(\{\{[a-zA-Z_][a-zA-Z0-9_]*\}\}|[0-9*#]+)$/.test(String(n.data.transferExtensionNumber))
      ) {
        issues.push({
          level: "error",
          message: `Call Transfer "${n.data.label}" has an invalid extension. Use digits, * or #.`,
          nodeId: n.id,
        });
      }
      for (const key of Object.keys(n.data.customSipHeaders ?? {})) {
        if (key && !/^x-/i.test(key) && !/^user-to-user$/i.test(key)) {
          issues.push({
            level: "error",
            message: `Call Transfer "${n.data.label}" has invalid SIP header "${key}". Use X-* or User-To-User.`,
            nodeId: n.id,
          });
        }
      }
      if (type === "agentic_warm_transfer" && !String(n.data.transferAgentId ?? "").trim()) {
        issues.push({
          level: "error",
          message: `Call Transfer "${n.data.label}" uses Agentic Warm Transfer but has no transfer agent ID.`,
          nodeId: n.id,
        });
      }
    }
    const transitions = n.data.transitions ?? [];
    const targeted = transitions.filter((t) => Boolean(t.target));
    if (n.data.kind === "logic_split" && targeted.length === 0 && edges.some((e) => e.source === n.id)) {
      issues.push({
        level: "warn",
        message: `Logic Split "${n.data.label}" has no named branch conditions.`,
        nodeId: n.id,
      });
    }
    const labels = new Map<string, number>();
    for (const t of targeted) {
      const cond = String(t.condition ?? "").trim();
      const type =
        t.conditionType ??
        (t.equations?.length || isEquationCondition(cond) ? "equation" : "prompt");
      if (!isUnconditional(cond) && type === "equation") {
        const bad = invalidEquationMessage(cond, t.equations);
        if (bad) {
          issues.push({ level: "error", message: `Node "${n.data.label}": ${bad}`, nodeId: n.id });
        }
      }
      if (type === "prompt" && !isUnconditional(cond) && cond.length < 3) {
        issues.push({
          level: "warn",
          message: `Node "${n.data.label}" has a very short transition condition "${cond}".`,
          nodeId: n.id,
        });
      }
      const key = cond.toLowerCase();
      if (key && !isUnconditional(key)) {
        labels.set(key, (labels.get(key) ?? 0) + 1);
      }
    }
    for (const [label, count] of labels) {
      if (count > 1) {
        issues.push({
          level: "warn",
          message: `Node "${n.data.label}" has ${count} transitions with the same condition "${label}".`,
          nodeId: n.id,
        });
      }
    }
    if (n.data.kind === "note") continue;
    const connected = edges.some((e) => e.source === n.id) || edges.some((e) => e.target === n.id);
    if (!connected && nodes.length > 1)
      issues.push({
        level: "warn",
        message: `Node "${n.data.label}" is not connected.`,
        nodeId: n.id,
      });
    if (starts.length && !reachable.has(n.id) && connected) {
      issues.push({
        level: "warn",
        message: `Node "${n.data.label}" is unreachable from the start node.`,
        nodeId: n.id,
      });
    }
    if (
      n.data.kind !== "ending" &&
      n.data.kind !== "call_transfer" &&
      n.data.kind !== "agent_transfer" &&
      edges.length > 0 &&
      starts.length &&
      reachable.has(n.id) &&
      !hasOutgoing(n.id, edges, n)
    ) {
      issues.push({
        level: "warn",
        message: `Node "${n.data.label}" has no outgoing transition (dead end).`,
        nodeId: n.id,
      });
    }
  }
  const incompleteFields = variables.filter((v) => !v.name.trim() || !v.description.trim());
  if (incompleteFields.length === 1) {
    issues.push({
      level: "warn",
      message: "Post-call data fields should have both a name and description.",
    });
  } else if (incompleteFields.length > 1) {
    issues.push({
      level: "warn",
      message: `${incompleteFields.length} post-call data fields are missing a name or description.`,
    });
  }
  const unknownByNode = new Map<string, { label: string; names: string[] }>();
  for (const hit of unknownTemplateVars(nodes, variables)) {
    const cur = unknownByNode.get(hit.nodeId) ?? { label: hit.nodeLabel, names: [] };
    if (!cur.names.includes(hit.name)) cur.names.push(hit.name);
    unknownByNode.set(hit.nodeId, cur);
  }
  if (starts.length) {
    const cycles = cyclePaths(starts[0]!.id, edges.filter((e) => ids.has(e.source) && ids.has(e.target)));
    const seenCycle = new Set<string>();
    for (const path of cycles) {
      const key = path.slice().sort().join(">");
      if (seenCycle.has(key)) continue;
      seenCycle.add(key);
      const labels = path
        .slice(0, -1)
        .map((id) => nodes.find((n) => n.id === id)?.data.label || id)
        .join(" → ");
      issues.push({
        level: "warn",
        message: `Circular path: ${labels}.`,
        nodeId: path[0],
      });
    }
  }
  for (const [nodeId, { label, names }] of unknownByNode) {
    const listed = names.map((n) => `{{${n}}}`).join(", ");
    issues.push({
      level: "warn",
      message:
        names.length === 1
          ? `Node "${label}" references ${listed} which is not defined on the flow.`
          : `Node "${label}" references undefined variables: ${listed}.`,
      nodeId,
    });
  }
  return dedupeValidationIssues(issues);
}

export function dedupeValidationIssues(issues: ValidationIssue[]): ValidationIssue[] {
  const seen = new Set<string>();
  const out: ValidationIssue[] = [];
  for (const issue of issues) {
    const key = `${issue.level}|${issue.nodeId ?? ""}|${issue.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(issue);
  }
  return out;
}

export function validateComponentSlice(slice: GraphSlice): ValidationIssue[] {
  if (!slice.nodes.length) {
    return [{ level: "error", message: "Component is empty." }];
  }
  const raw = validateFlow(slice.nodes, slice.edges, []);
  return raw.filter(
    (i) =>
      !i.message.includes("no start node") &&
      !i.message.includes("Multiple start nodes") &&
      !i.message.includes("Post-call data"),
  );
}

export function validateFlowErrors(
  nodes: FlowNode[],
  edges: Edge[],
  variables: BuilderVariable[] = [],
): ValidationIssue[] {
  return validateFlow(nodes, edges, variables).filter((i) => i.level === "error");
}
