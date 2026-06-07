import type { Edge } from "@xyflow/react";
import type { FlowNode } from "./store";
import type { BuilderVariable } from "./types";
import { isE164, normalizeTransferNumber } from "./export-conversation-flow";

export interface ValidationIssue {
  level: "warn" | "error";
  message: string;
}

export function validateFlow(nodes: FlowNode[], edges: Edge[], variables: BuilderVariable[] = []): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const starts = nodes.filter((n) => n.data.isStart);
  if (starts.length === 0)
    issues.push({ level: "error", message: "No start node selected. Mark one node as Start." });
  if (starts.length > 1)
    issues.push({ level: "error", message: "More than one start node selected." });

  const ids = new Set(nodes.map((n) => n.id));
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target))
      issues.push({ level: "error", message: `Dangling edge ${e.id}.` });
  }

  for (const n of nodes) {
    if (n.data.kind === "conversation" && !n.data.dialogue.trim())
      issues.push({ level: "warn", message: `Conversation "${n.data.label}" has empty prompt.` });
    if (n.data.kind === "call_transfer") {
      const mode = n.data.transferMode ?? "static";
      if (mode === "dynamic") {
        const v = String(n.data.transferDynamicVariable ?? "").trim();
        if (!v) {
          issues.push({ level: "error", message: `Call Transfer "${n.data.label}" is set to Dynamic Routing but no variable name was provided.` });
        }
      } else {
        const num = normalizeTransferNumber(n.data.transferNumber ?? "");
        if (!num) {
          issues.push({ level: "error", message: `Call Transfer "${n.data.label}" has no transfer destination.` });
        } else {
          const isSip = /^sip:/i.test(num);
          const ignore = !!n.data.ignoreE164Validation;
          if (!isSip && !ignore && !isE164(num)) {
            issues.push({
              level: "error",
              message: `Call Transfer "${n.data.label}" has an invalid number "${num}". Use E.164 (e.g. +14155551234), a SIP URI, or enable raw format. UK numbers like 07412345678 are auto-normalized.`,
            });
          }
        }
      }
      const type = n.data.transferType === "warm_handoff" ? "agentic_warm_transfer" : (n.data.transferType ?? "cold_transfer");
      const ring = n.data.transferRingDurationSec ?? 30;
      if (ring < 5 || ring > 90) {
        issues.push({ level: "error", message: `Call Transfer "${n.data.label}" ring duration must be between 5 and 90 seconds.` });
      }
      if (n.data.transferExtensionNumber && !/^(\{\{[a-zA-Z_][a-zA-Z0-9_]*\}\}|[0-9*#]+)$/.test(String(n.data.transferExtensionNumber))) {
        issues.push({ level: "error", message: `Call Transfer "${n.data.label}" has an invalid extension. Use digits, * or #.` });
      }
      for (const key of Object.keys(n.data.customSipHeaders ?? {})) {
        if (key && !/^x-/i.test(key) && !/^user-to-user$/i.test(key)) {
          issues.push({ level: "error", message: `Call Transfer "${n.data.label}" has invalid SIP header "${key}". Use X-* or User-To-User.` });
        }
      }
      if (type === "agentic_warm_transfer" && !String(n.data.transferAgentId ?? "").trim()) {
        issues.push({ level: "error", message: `Call Transfer "${n.data.label}" uses Agentic Warm Transfer but has no transfer agent ID.` });
      }
    }
    if (n.data.kind === "note") continue;
    const connected =
      edges.some((e) => e.source === n.id) || edges.some((e) => e.target === n.id);
    if (!connected && nodes.length > 1)
      issues.push({ level: "warn", message: `Node "${n.data.label}" is not connected.` });
  }
  for (const v of variables) {
    if (!v.name.trim() || !v.description.trim())
      issues.push({ level: "warn", message: "Post-call data fields should have both a name and description." });
  }
  return issues;
}
