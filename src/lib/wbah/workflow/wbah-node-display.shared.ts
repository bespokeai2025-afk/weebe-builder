/**
 * n8n-style node display — full parameter panels (conditions, HTTP headers/body, mode, etc.).
 */
import type { WbahN8nNodeKind } from "./wbah-n8n-node-catalog.shared";
import { getNodeOutputLayout, type N8nOutputBranch } from "./wbah-n8n-node-branches.shared";
import {
  defaultN8nParamsForKind,
  mergeN8nNodeConfig,
  type N8nConditionRule,
  type WbahN8nNodeConfig,
} from "./wbah-n8n-node-presets.shared";
import { resolveNodeJavaScript } from "./wbah-n8n-code-snippets.shared";

export function automationTypeToCanvasKind(type: string): WbahN8nNodeKind {
  if (type === "core.webhook" || type === "core.start") return "trigger";
  if (type.includes("http")) return "http";
  if (type.includes("function")) return "code";
  if (type.includes("filter")) return "filter";
  if (type.includes("condition") || type.includes("switch")) return "if";
  if (type.includes("wait") || type.includes("delay")) return "wait";
  if (type.includes("merge")) return "merge";
  if (type.includes("end")) return "stop";
  if (type.startsWith("wbah.")) return "http";
  return "code";
}

/** n8n node type title shown in the card header (matches n8n UI labels). */
export const N8N_KIND_TYPE_LABEL: Record<WbahN8nNodeKind, string> = {
  trigger: "Webhook",
  filter: "Filter",
  if: "IF",
  merge: "Merge",
  code: "Code",
  http: "HTTP Request",
  wait: "Wait",
  stop: "Stop",
};

export type N8nNodeParameter = {
  label: string;
  value: string;
  variant?: "condition" | "url" | "code" | "text" | "header" | "body" | "mode";
};

export type N8nNodePresentation = {
  typeLabel: string;
  parameters: N8nNodeParameter[];
  dualOutput: boolean;
  outputBranches: N8nOutputBranch[];
};

function defaultSummaryForType(type: string, name: string): string {
  const n = name.trim();
  if (type === "core.webhook") return "Retell voice webhook ingress";
  if (type === "core.http.request") return "HTTP request";
  if (type === "core.function") return "Run JavaScript";
  if (type === "core.condition") return "Conditional branch";
  if (type === "core.end") return "End";
  if (n && !n.startsWith("node-") && !n.startsWith("custom-")) return n;
  return "";
}

function formatJsonBody(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatHeaderList(headers: WbahN8nNodeConfig["headers"]): string {
  if (!headers?.length) return "";
  return headers.map((h) => `${h.name}: ${h.value}`).join("\n");
}

function formatQueryList(params: WbahN8nNodeConfig["queryParameters"]): string {
  if (!params?.length) return "";
  return params.map((p) => `${p.name}=${p.value}`).join("\n");
}

function formatConditionRule(rule: N8nConditionRule, index: number): string {
  const field = rule.field?.trim() ?? "";
  const op = rule.operator?.trim() ?? "";
  const val = rule.value?.trim() ?? "";
  if (op && val) return `${index + 1}. ${field} ${op} ${val}`;
  if (op) return `${index + 1}. ${field} ${op}`;
  return `${index + 1}. ${field}`;
}

function parseLegacyCondition(condition: string): { combinator: "and" | "or"; rules: N8nConditionRule[] } {
  const trimmed = condition.trim();
  if (!trimmed) return { combinator: "and", rules: [] };

  const orParts = trimmed.split(/\s+OR\s+/i);
  if (orParts.length > 1) {
    return {
      combinator: "or",
      rules: orParts.map((part) => {
        const p = part.trim();
        const eq = p.match(/^(.+?)\s+equals\s+(.+)$/i);
        if (eq) return { field: eq[1]!.trim(), operator: "equals", value: eq[2]!.trim() };
        const exists = p.match(/^(.+?)\s+exists$/i);
        if (exists) return { field: exists[1]!.trim(), operator: "exists" };
        const empty = p.match(/^(.+?)\s+is not empty$/i);
        if (empty) return { field: empty[1]!.trim(), operator: "is not empty" };
        return { field: p };
      }),
    };
  }

  const eq = trimmed.match(/^(.+?)\s+equals\s+(.+)$/i);
  if (eq) {
    return {
      combinator: "and",
      rules: [{ field: eq[1]!.trim(), operator: "equals", value: eq[2]!.trim() }],
    };
  }
  const exists = trimmed.match(/^(.+?)\s+exists$/i);
  if (exists) {
    return { combinator: "and", rules: [{ field: exists[1]!.trim(), operator: "exists" }] };
  }
  const empty = trimmed.match(/^(.+?)\s+is not empty$/i);
  if (empty) {
    return { combinator: "and", rules: [{ field: empty[1]!.trim(), operator: "is not empty" }] };
  }

  return { combinator: "and", rules: [{ field: trimmed }] };
}

function pushConditionParams(cfg: WbahN8nNodeConfig, parameters: N8nNodeParameter[]) {
  let rules = cfg.conditions ?? [];
  let combinator = cfg.combinator ?? "and";

  if (!rules.length && cfg.condition) {
    const parsed = parseLegacyCondition(cfg.condition);
    rules = parsed.rules;
    combinator = parsed.combinator;
  } else if (!rules.length && cfg.expression) {
    rules = [{ field: cfg.expression }];
  }

  if (!rules.length) return;

  parameters.push({
    label: "Combinator",
    value: combinator.toUpperCase(),
    variant: "mode",
  });

  const rulesText = rules.map((r, i) => formatConditionRule(r, i)).join("\n");
  parameters.push({
    label: "Conditions",
    value: rulesText,
    variant: "condition",
  });
}

function pushHttpParams(cfg: WbahN8nNodeConfig, parameters: N8nNodeParameter[]) {
  const method = String(cfg.method ?? "GET").trim();
  const url = String(cfg.url ?? cfg.path ?? "").trim();

  parameters.push({ label: "Method", value: method, variant: "text" });
  if (url) parameters.push({ label: "URL", value: url, variant: "url" });

  if (cfg.authentication) {
    parameters.push({ label: "Authentication", value: cfg.authentication, variant: "text" });
  }

  if (cfg.sendQueryParameters && cfg.queryParameters?.length) {
    parameters.push({ label: "Send Query Parameters", value: "Yes", variant: "mode" });
    parameters.push({
      label: "Query Parameters",
      value: formatQueryList(cfg.queryParameters),
      variant: "text",
    });
  }

  const headerText = formatHeaderList(cfg.headers);
  if (cfg.sendHeaders !== false && headerText) {
    parameters.push({ label: "Send Headers", value: "Yes", variant: "mode" });
    parameters.push({ label: "Headers", value: headerText, variant: "header" });
  }

  const bodyRaw = cfg.jsonBody ?? cfg.body;
  if (cfg.sendBody !== false && bodyRaw != null && String(bodyRaw).trim()) {
    parameters.push({ label: "Send Body", value: "Yes", variant: "mode" });
    if (cfg.bodyContentType) {
      parameters.push({ label: "Body Content Type", value: cfg.bodyContentType, variant: "mode" });
    }
    parameters.push({
      label: cfg.bodyContentType === "JSON" ? "JSON" : "Body",
      value: formatJsonBody(bodyRaw),
      variant: "body",
    });
  }
}

function pushCodeParams(
  cfg: WbahN8nNodeConfig,
  parameters: N8nNodeParameter[],
  nodeId?: string,
  rawConfig?: Record<string, unknown>,
) {
  if (cfg.mode) parameters.push({ label: "Mode", value: cfg.mode, variant: "mode" });
  if (cfg.language) parameters.push({ label: "Language", value: cfg.language, variant: "text" });

  const run = nodeId
    ? resolveNodeJavaScript(nodeId, { ...cfg, ...(rawConfig ?? {}) })
    : String(cfg.code ?? cfg.codeHint ?? "").trim();

  if (run) {
    parameters.push({
      label: "JavaScript",
      value: run,
      variant: "code",
    });
  }
}

/** Fill display fields; merges production presets by node id when provided. */
export function enrichCanvasNodeConfig(
  automationType: string,
  name: string,
  config: Record<string, unknown> = {},
  nodeId?: string,
  kind?: WbahN8nNodeKind,
): Record<string, unknown> {
  const resolvedKind = kind ?? (automationType ? automationTypeToCanvasKind(automationType) : "code");
  const merged = nodeId
    ? mergeN8nNodeConfig(nodeId, resolvedKind, config)
    : ({ ...defaultN8nParamsForKind(resolvedKind), ...config } as WbahN8nNodeConfig);

  const out: Record<string, unknown> = { ...merged };

  if (
    out.automationType == null &&
    automationType &&
    !/^(filter|if|http|code|merge|wait|stop|trigger)$/.test(automationType)
  ) {
    out.automationType = automationType;
  }

  const hasPrimary =
    out.conditions ||
    out.condition ||
    out.url ||
    out.path ||
    out.headers ||
    out.body ||
    out.jsonBody ||
    out.codeHint ||
    out.code;

  const summary = String(out.summary ?? out.description ?? "").trim();
  if (!summary && !hasPrimary) {
    const fallback = defaultSummaryForType(automationType, name);
    if (fallback) out.summary = fallback;
  }

  return out;
}

/** Build n8n-style labeled parameters for inside the node card. */
export function buildN8nNodePresentation(
  kind: WbahN8nNodeKind | string,
  config: Record<string, unknown>,
  nodeId?: string,
): N8nNodePresentation {
  const k = kind as WbahN8nNodeKind;
  const typeLabel = N8N_KIND_TYPE_LABEL[k] ?? String(kind);
  const cfg = nodeId
    ? mergeN8nNodeConfig(nodeId, k, config)
    : ({ ...defaultN8nParamsForKind(k), ...config } as WbahN8nNodeConfig);

  const parameters: N8nNodeParameter[] = [];
  const summary = String(cfg.summary ?? cfg.description ?? "").trim();

  if (k === "filter" || k === "if") {
    pushConditionParams(cfg, parameters);
  }

  if (k === "http") {
    pushHttpParams(cfg, parameters);
    if (summary) parameters.push({ label: "Notes", value: summary, variant: "text" });
  }

  if (k === "code") {
    pushCodeParams(cfg, parameters, nodeId, config);
    if (summary && !cfg.code && !cfg.codeHint) {
      parameters.push({ label: "Notes", value: summary, variant: "text" });
    }
  }

  if (k === "merge") {
    parameters.push({
      label: "Mode",
      value: cfg.mergeMode ?? summary ?? "Append",
      variant: "mode",
    });
  }

  if (k === "wait") {
    if (cfg.resume) parameters.push({ label: "Resume", value: cfg.resume, variant: "mode" });
    const amount = cfg.amount ?? cfg.duration;
    const unit = cfg.unit ?? (cfg.durationMs != null ? "ms" : "");
    if (amount != null) {
      parameters.push({
        label: "Wait Amount",
        value: unit ? `${amount} ${unit}` : String(amount),
        variant: "text",
      });
    } else if (cfg.durationMs != null) {
      parameters.push({ label: "Wait Amount", value: `${cfg.durationMs}ms`, variant: "text" });
    } else if (summary) {
      parameters.push({ label: "Wait", value: summary, variant: "text" });
    }
  }

  if (k === "trigger") {
    const method = String(cfg.httpMethod ?? cfg.method ?? "POST");
    const path = String(cfg.path ?? cfg.url ?? "").trim();
    parameters.push({ label: "HTTP Method", value: method, variant: "text" });
    if (path) parameters.push({ label: "Path", value: path, variant: "url" });
    if (cfg.authentication) {
      parameters.push({ label: "Authentication", value: cfg.authentication, variant: "text" });
    }
    if (cfg.responseMode) {
      parameters.push({ label: "Response Mode", value: cfg.responseMode, variant: "mode" });
    }
    if (summary) parameters.push({ label: "Notes", value: summary, variant: "text" });
  }

  if (k === "stop" && summary) {
    parameters.push({ label: "Notes", value: summary, variant: "text" });
  }

  if (parameters.length === 0 && summary) {
    parameters.push({ label: "Details", value: summary, variant: "text" });
  }

  const outputLayout = getNodeOutputLayout(k, cfg);
  const dualOutput = outputLayout.branches.length > 1;

  return {
    typeLabel,
    parameters,
    dualOutput,
    outputBranches: outputLayout.branches,
  };
}

/** @deprecated use buildN8nNodePresentation */
export function nodeDisplayLines(
  kind: WbahN8nNodeKind | string,
  config: Record<string, unknown>,
): { primary?: string; secondary?: string; typeLabel?: string } {
  const p = buildN8nNodePresentation(kind, config);
  const first = p.parameters[0];
  const second = p.parameters[1];
  return {
    primary: first?.value,
    secondary: second?.value,
    typeLabel: p.typeLabel,
  };
}
