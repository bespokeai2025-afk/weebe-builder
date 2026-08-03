/**
 * Expression resolver — minimal n8n-style (Phase 2).
 * Supports {{ $json.field }}, ={{ expr }}, $node["id"].json, $('Node Name').item.json, $vars, $env.
 */
import type { ExpressionContext, ResolvedExpression } from "../types/expression.types";

const TEMPLATE_RE = /\{\{\s*([\s\S]+?)\s*\}\}/g;
const EXPR_PREFIX_RE = /^\s*=\{\{\s*([\s\S]+?)\s*\}\}\s*$/;
const N8N_NODE_REF_RE = /^\$\(\s*['"]([^'"]+)['"]\s*\)(.*)$/;

export function buildNodeIdByLabelMap(
  nodes: Iterable<{ id: string; name?: string }>,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const node of nodes) {
    map[node.id.toLowerCase()] = node.id;
    if (node.name) {
      map[node.name.trim().toLowerCase()] = node.id;
    }
  }
  return map;
}

function resolveNodeId(ref: string, ctx: ExpressionContext): string | null {
  const trimmed = ref.trim();
  if (ctx.nodeOutputs[trimmed]) return trimmed;
  const byLabel = ctx.nodeIdByLabel?.[trimmed.toLowerCase()];
  if (byLabel) return byLabel;
  return null;
}

function firstNodeJson(nodeId: string, ctx: ExpressionContext): Record<string, unknown> | undefined {
  const outputs = ctx.nodeOutputs[nodeId];
  const first = outputs?.[0] as { json?: Record<string, unknown> } | undefined;
  return first?.json;
}

function resolveN8nNodeRef(expr: string, ctx: ExpressionContext): unknown {
  const m = expr.match(N8N_NODE_REF_RE);
  if (!m) return undefined;
  const nodeId = resolveNodeId(m[1]!, ctx);
  if (!nodeId) return undefined;

  let rest = (m[2] ?? "").trim();
  if (!rest || rest === ".item" || rest === ".first()") {
    return { json: firstNodeJson(nodeId, ctx) ?? {}, item: { json: firstNodeJson(nodeId, ctx) ?? {} } };
  }
  if (rest.startsWith(".item.")) rest = rest.slice(".item.".length);
  else if (rest.startsWith(".item")) rest = rest.slice(".item".length).replace(/^\./, "");
  else if (rest.startsWith(".first().")) rest = rest.slice(".first().".length);
  else if (rest.startsWith(".first()")) rest = rest.slice(".first()".length).replace(/^\./, "");

  if (rest === "json" || rest.startsWith("json.")) {
    const json = firstNodeJson(nodeId, ctx);
    if (!json) return undefined;
    if (rest === "json") return json;
    return getPath(json, rest.slice("json.".length));
  }

  const json = firstNodeJson(nodeId, ctx);
  return json ? getPath(json, rest.replace(/^\./, "")) : undefined;
}

function getPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  const parts = path.split(".").filter(Boolean);
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function resolveIdentifier(expr: string, ctx: ExpressionContext, inputJson: Record<string, unknown>): unknown {
  const trimmed = expr.trim();

  if (N8N_NODE_REF_RE.test(trimmed)) {
    return resolveN8nNodeRef(trimmed, ctx);
  }

  if (trimmed.startsWith("$json")) {
    return getPath(inputJson, trimmed.slice("$json".length).replace(/^\./, ""));
  }
  if (trimmed.startsWith("$input")) {
    const path = trimmed.slice("$input".length).replace(/^\./, "");
    if (!path || path === "json") return inputJson;
    if (path.startsWith("json.")) return getPath(inputJson, path.slice("json.".length));
    return getPath({ json: inputJson }, path);
  }
  if (trimmed.startsWith("$vars.")) {
    return getPath(ctx.variables, trimmed.slice("$vars.".length));
  }
  if (trimmed.startsWith("$env.")) {
    return ctx.env[trimmed.slice("$env.".length)];
  }

  const nodeMatch = trimmed.match(/^\$node\[\s*["']([^"']+)["']\s*\](?:\.(.+))?$/);
  if (nodeMatch) {
    const nodeId = nodeMatch[1]!;
    const rest = nodeMatch[2] ?? "json";
    const outputs = ctx.nodeOutputs[nodeId];
    const first = outputs?.[0] as { json?: Record<string, unknown> } | undefined;
    if (!first) return undefined;
    if (rest === "json") return first.json;
    if (rest.startsWith("json.")) return getPath(first.json, rest.slice("json.".length));
    return getPath(first, rest);
  }

  if (/^(true|false|null)$/i.test(trimmed)) {
    if (trimmed.toLowerCase() === "true") return true;
    if (trimmed.toLowerCase() === "false") return false;
    return null;
  }
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

export function evaluateExpression(
  expr: string,
  ctx: ExpressionContext,
  inputJson: Record<string, unknown>,
): unknown {
  return resolveIdentifier(expr, ctx, inputJson);
}

export function resolveExpressionValue(
  raw: unknown,
  ctx: ExpressionContext,
  inputJson: Record<string, unknown>,
): ResolvedExpression {
  if (typeof raw !== "string") {
    return { raw: String(raw), resolved: raw, isExpression: false };
  }

  const exprMatch = raw.match(EXPR_PREFIX_RE);
  if (exprMatch) {
    const resolved = evaluateExpression(exprMatch[1]!, ctx, inputJson);
    return { raw, resolved, isExpression: true };
  }

  if (raw.includes("{{")) {
    const resolved = resolveTemplate(raw, ctx, inputJson);
    return { raw, resolved, isExpression: true };
  }

  return { raw, resolved: raw, isExpression: false };
}

export function resolveTemplate(
  template: string,
  ctx: ExpressionContext,
  inputJson: Record<string, unknown>,
): string {
  return template.replace(TEMPLATE_RE, (_full, inner: string) => {
    const val = evaluateExpression(inner, ctx, inputJson);
    if (val == null) return "";
    if (typeof val === "object") return JSON.stringify(val);
    return String(val);
  });
}

export function resolveConfigRecord(
  config: Record<string, unknown>,
  ctx: ExpressionContext,
  inputJson: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(config)) {
    if (val != null && typeof val === "object" && !Array.isArray(val)) {
      out[key] = resolveConfigRecord(val as Record<string, unknown>, ctx, inputJson);
    } else {
      out[key] = resolveExpressionValue(val, ctx, inputJson).resolved;
    }
  }
  return out;
}

const CONDITION_OPS: Array<{
  re: RegExp;
  eval: (left: unknown, right?: string) => boolean;
}> = [
  {
    re: /^([\s\S]+?)\s+not_equals\s+([\s\S]+)$/i,
    eval: (l, r) => String(l ?? "") !== String(r ?? "").trim(),
  },
  {
    re: /^([\s\S]+?)\s+equals\s+([\s\S]+)$/i,
    eval: (l, r) => String(l ?? "") === String(r ?? "").trim(),
  },
  {
    re: /^([\s\S]+?)\s+contains\s+([\s\S]+)$/i,
    eval: (l, r) => String(l ?? "").includes(String(r ?? "").trim()),
  },
  {
    re: /^([\s\S]+?)\s+exists\s*$/i,
    eval: (l) => l != null && l !== "",
  },
  {
    re: /^([\s\S]+?)\s+not_exists\s*$/i,
    eval: (l) => l == null || l === "",
  },
];

function resolveConditionSide(side: string, ctx: ExpressionContext, inputJson: Record<string, unknown>): unknown {
  const trimmed = side.trim();
  if (trimmed.includes("{{")) {
    const resolved = resolveTemplate(trimmed, ctx, inputJson);
    if (resolved !== trimmed) return resolved;
  }
  if (trimmed.startsWith("$") || trimmed.startsWith("=")) {
    return evaluateExpression(trimmed.replace(/^=\{\{|\}\}$/g, "").trim(), ctx, inputJson);
  }
  return trimmed.replace(/^["']|["']$/g, "");
}

/** Evaluate WBAH/n8n-style condition strings, e.g. "{{ $json.body.event }} equals call_analyzed". */
export function evaluateConditionExpression(
  condition: string,
  ctx: ExpressionContext,
  inputJson: Record<string, unknown>,
): boolean {
  const raw = condition.trim();
  if (!raw) return true;

  for (const op of CONDITION_OPS) {
    const m = raw.match(op.re);
    if (!m) continue;
    const left = resolveConditionSide(m[1]!, ctx, inputJson);
    const right = m[2] != null ? resolveConditionSide(m[2], ctx, inputJson) : undefined;
    return op.eval(left, right != null ? String(right) : undefined);
  }

  const resolved = resolveConditionSide(raw, ctx, inputJson);
  if (typeof resolved === "boolean") return resolved;
  if (resolved == null || resolved === "" || resolved === "false" || resolved === "0") return false;
  return true;
}
