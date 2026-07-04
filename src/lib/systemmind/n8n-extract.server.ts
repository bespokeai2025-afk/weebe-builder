/**
 * n8n workflow → structured metadata extraction (pure, read-only).
 *
 * Parses a raw n8n workflow definition into the metadata SystemMind stores and
 * feeds to the AI understanding engine. No network / DB access, no mutation.
 *
 * n8n data model reminders:
 *  - `nodes`: [{ id, name, type, parameters, credentials, retryOnFail, ... }]
 *  - `connections`: keyed by SOURCE NODE NAME → { main: [ [ { node, type, index } ] ] }
 */

import type { N8nWorkflowSummary } from "./n8n-client.server";

export interface N8nExtractedMetadata {
  triggerTypes: string[];
  nodeTypes: string[];
  integrations: string[];
  webhooks: Array<{ node: string; method: string; path: string }>;
  httpRequests: Array<{ node: string; method: string; url: string }>;
  credentials: Array<{ type: string; name: string }>;
  credentialTypes: string[];
  expressions: { count: number; samples: string[] };
  externalServices: string[];
  executionOrder: string[];
  retryErrorHandling: {
    nodesWithRetry: number;
    nodesWithContinueOnFail: number;
    hasErrorWorkflow: boolean;
    errorWorkflowId: string | null;
  };
  dependencies: Array<{ type: string; ref: string }>;
  inputs: string[];
  outputs: string[];
  nodeCount: number;
  connectionCount: number;
}

// ── Node-type → friendly integration name ────────────────────────────────────────

function prettifyNodeType(type: string): string {
  let t = type;
  t = t.replace(/^@n8n\/n8n-nodes-langchain\./, "LangChain: ");
  t = t.replace(/^n8n-nodes-base\./, "");
  t = t.replace(/^@?n8n-nodes-/, "");
  // Split camelCase → words, capitalise first letter.
  if (!t.startsWith("LangChain")) {
    t = t.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
    t = t.charAt(0).toUpperCase() + t.slice(1);
  }
  return t.trim();
}

// n8n "utility" node types that aren't external services.
const NON_SERVICE_TYPES = new Set([
  "set", "if", "switch", "merge", "code", "function", "functionitem",
  "noop", "wait", "sticky note", "stickynote", "splitinbatches", "split in batches",
  "itemlists", "item lists", "filter", "aggregate", "sort", "limit",
  "datetime", "date time", "renamekeys", "rename keys", "editimage", "edit image",
  "manual trigger", "start", "stopanderror", "stop and error", "respondtowebhook",
  "respond to webhook", "html", "xml", "markdown", "crypto", "compression",
]);

function isExternalService(friendly: string): boolean {
  return !NON_SERVICE_TYPES.has(friendly.toLowerCase());
}

// ── Expression scanning ──────────────────────────────────────────────────────────

function collectExpressions(value: any, out: string[], depth = 0): void {
  if (depth > 8 || out.length > 200) return;
  if (typeof value === "string") {
    if (value.includes("{{") || value.startsWith("=")) {
      out.push(value.length > 160 ? `${value.slice(0, 160)}…` : value);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectExpressions(v, out, depth + 1);
    return;
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) collectExpressions(v, out, depth + 1);
  }
}

// ── Graph helpers ────────────────────────────────────────────────────────────────

function buildExecutionOrder(nodes: any[], connections: Record<string, any>): string[] {
  const names = nodes.map((n) => String(n?.name ?? n?.id ?? "")).filter(Boolean);
  const nameSet = new Set(names);
  const outgoing = new Map<string, string[]>();
  const hasIncoming = new Set<string>();

  for (const [src, conn] of Object.entries(connections ?? {})) {
    const targets: string[] = [];
    const main = (conn as any)?.main;
    if (Array.isArray(main)) {
      for (const branch of main) {
        if (Array.isArray(branch)) {
          for (const link of branch) {
            const tgt = link?.node ? String(link.node) : "";
            if (tgt) {
              targets.push(tgt);
              hasIncoming.add(tgt);
            }
          }
        }
      }
    }
    if (targets.length) outgoing.set(String(src), targets);
  }

  // Roots: nodes with no incoming connection (triggers / entry points).
  const roots = names.filter((n) => !hasIncoming.has(n));
  const order: string[] = [];
  const seen = new Set<string>();
  const queue = [...(roots.length ? roots : names.slice(0, 1))];
  while (queue.length && order.length < 500) {
    const cur = queue.shift()!;
    if (seen.has(cur) || !nameSet.has(cur)) continue;
    seen.add(cur);
    order.push(cur);
    for (const next of outgoing.get(cur) ?? []) {
      if (!seen.has(next)) queue.push(next);
    }
  }
  // Append any nodes not reachable from roots (disconnected).
  for (const n of names) if (!seen.has(n)) order.push(n);
  return order;
}

function countConnections(connections: Record<string, any>): number {
  let count = 0;
  for (const conn of Object.values(connections ?? {})) {
    const main = (conn as any)?.main;
    if (Array.isArray(main)) {
      for (const branch of main) {
        if (Array.isArray(branch)) count += branch.length;
      }
    }
  }
  return count;
}

// ── Main extractor ───────────────────────────────────────────────────────────────

export function extractWorkflowMetadata(wf: N8nWorkflowSummary): N8nExtractedMetadata {
  const nodes: any[] = Array.isArray(wf?.nodes) ? wf.nodes : [];
  const connections: Record<string, any> = (wf?.connections as any) ?? {};

  const triggerTypes = new Set<string>();
  const nodeTypesSet = new Set<string>();
  const integrationsSet = new Set<string>();
  const externalSet = new Set<string>();
  const credentials: Array<{ type: string; name: string }> = [];
  const credTypeSet = new Set<string>();
  const webhooks: Array<{ node: string; method: string; path: string }> = [];
  const httpRequests: Array<{ node: string; method: string; url: string }> = [];
  const dependencies: Array<{ type: string; ref: string }> = [];
  const expressionSamples: string[] = [];
  let exprCount = 0;

  for (const node of nodes) {
    const rawType = String(node?.type ?? "");
    const lower = rawType.toLowerCase();
    const friendly = prettifyNodeType(rawType);
    const params = node?.parameters ?? {};
    const nodeName = String(node?.name ?? node?.id ?? "node");

    if (friendly) nodeTypesSet.add(friendly);

    // Trigger detection
    if (
      lower.includes("trigger") ||
      lower.endsWith(".webhook") ||
      lower.includes("cron") ||
      lower.includes("schedule") ||
      lower.includes("manualtrigger")
    ) {
      triggerTypes.add(friendly);
    }

    // Integrations / external services
    if (friendly && isExternalService(friendly)) {
      integrationsSet.add(friendly);
      externalSet.add(friendly);
    }

    // Webhooks
    if (lower.endsWith(".webhook") || lower.includes("webhook")) {
      const method = String(params?.httpMethod ?? params?.method ?? "GET").toUpperCase();
      const path = String(params?.path ?? params?.webhookPath ?? "");
      webhooks.push({ node: nodeName, method, path });
    }

    // HTTP requests
    if (lower.endsWith(".httprequest") || lower.includes("httprequest")) {
      const method = String(params?.method ?? params?.requestMethod ?? "GET").toUpperCase();
      const url = String(params?.url ?? params?.uri ?? "");
      httpRequests.push({ node: nodeName, method, url: url.slice(0, 300) });
    }

    // Sub-workflow / dependencies
    if (lower.includes("executeworkflow")) {
      const wid = params?.workflowId;
      const ref =
        typeof wid === "object" && wid !== null
          ? String((wid as any).value ?? (wid as any).cachedResultName ?? "unknown")
          : String(wid ?? "unknown");
      dependencies.push({ type: "sub-workflow", ref });
    }

    // Credentials (labels + types only — never secrets)
    const creds = node?.credentials ?? {};
    if (creds && typeof creds === "object") {
      for (const [credType, val] of Object.entries(creds)) {
        credTypeSet.add(credType);
        const name = (val as any)?.name ? String((val as any).name) : credType;
        credentials.push({ type: credType, name });
      }
    }

    // Expressions
    collectExpressions(params, expressionSamples);
  }
  exprCount = expressionSamples.length;

  // Retry / error handling
  let nodesWithRetry = 0;
  let nodesWithContinueOnFail = 0;
  for (const node of nodes) {
    if (node?.retryOnFail) nodesWithRetry += 1;
    if (node?.continueOnFail || node?.onError === "continueRegularOutput" || node?.onError === "continueErrorOutput") {
      nodesWithContinueOnFail += 1;
    }
  }
  const errorWorkflowId = wf?.settings?.errorWorkflow ? String(wf.settings.errorWorkflow) : null;

  // Inputs — inferred from triggers
  const inputs: string[] = [];
  for (const t of triggerTypes) {
    const tl = t.toLowerCase();
    if (tl.includes("webhook")) inputs.push("HTTP webhook payload");
    else if (tl.includes("cron") || tl.includes("schedule")) inputs.push("Scheduled / time-based trigger");
    else if (tl.includes("manual")) inputs.push("Manual execution");
    else inputs.push(`${t} event`);
  }
  if (inputs.length === 0) inputs.push("Unknown / manual");

  // Outputs — terminal nodes (no outgoing connection) plus response nodes
  const hasOutgoing = new Set(Object.keys(connections ?? {}));
  const outputs: string[] = [];
  for (const node of nodes) {
    const nodeName = String(node?.name ?? node?.id ?? "");
    const lower = String(node?.type ?? "").toLowerCase();
    const isTerminal = !hasOutgoing.has(nodeName);
    if (lower.includes("respondtowebhook")) outputs.push(`HTTP response (${nodeName})`);
    else if (isTerminal && isExternalService(prettifyNodeType(String(node?.type ?? "")))) {
      outputs.push(`${prettifyNodeType(String(node?.type ?? ""))} (${nodeName})`);
    }
  }
  if (outputs.length === 0) outputs.push("No explicit terminal output detected");

  return {
    triggerTypes: [...triggerTypes],
    nodeTypes: [...nodeTypesSet],
    integrations: [...integrationsSet],
    webhooks,
    httpRequests,
    credentials: dedupeCreds(credentials),
    credentialTypes: [...credTypeSet],
    expressions: { count: exprCount, samples: expressionSamples.slice(0, 12) },
    externalServices: [...externalSet],
    executionOrder: buildExecutionOrder(nodes, connections),
    retryErrorHandling: {
      nodesWithRetry,
      nodesWithContinueOnFail,
      hasErrorWorkflow: !!errorWorkflowId,
      errorWorkflowId,
    },
    dependencies,
    inputs: [...new Set(inputs)],
    outputs: [...new Set(outputs)].slice(0, 20),
    nodeCount: nodes.length,
    connectionCount: countConnections(connections),
  };
}

function dedupeCreds(creds: Array<{ type: string; name: string }>): Array<{ type: string; name: string }> {
  const seen = new Set<string>();
  const out: Array<{ type: string; name: string }> = [];
  for (const c of creds) {
    const key = `${c.type}::${c.name}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(c);
    }
  }
  return out;
}

// ── Tag / folder helpers ─────────────────────────────────────────────────────────

export function extractTags(wf: N8nWorkflowSummary): string[] {
  const tags = wf?.tags;
  if (!Array.isArray(tags)) return [];
  return tags
    .map((t) => (typeof t === "string" ? t : String((t as any)?.name ?? "")))
    .filter(Boolean);
}

export function extractFolder(wf: N8nWorkflowSummary): string | null {
  const proj = wf?.homeProject;
  if (proj?.name) return String(proj.name);
  return null;
}
