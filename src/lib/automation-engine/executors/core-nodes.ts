/**
 * Core node executors — Phase 2 real implementations.
 */
import type { NodeContext, NodeDefinition, NodeResult } from "../types/node.types";
import type { ExpressionContext } from "../types/expression.types";
import {
  evaluateConditionExpression,
  resolveConfigRecord,
  resolveExpressionValue,
} from "../expressions/resolve-expression";
import {
  evaluateN8nConditions,
  type N8nConditionRule,
} from "../expressions/n8n-conditions";
import { combineMergeOutputs } from "../runtime/merge-runtime";

function exprContext(ctx: NodeContext): ExpressionContext {
  return {
    nodeOutputs: ctx.nodeOutputs as ExpressionContext["nodeOutputs"],
    nodeIdByLabel: ctx.nodeIdByLabel,
    variables: ctx.variables,
    globalVariables: ctx.globalVariables,
    env: ctx.env,
    execution: { id: ctx.executionId, workflowId: ctx.workflowId },
  };
}

function success(json: Record<string, unknown>, branch?: string): NodeResult {
  return {
    status: "success",
    output: { json },
    ...(branch ? { branch } : {}),
  };
}

function passthrough(ctx: NodeContext): NodeResult {
  return success({ ...ctx.input.json });
}

export async function executeCoreStart(ctx: NodeContext): Promise<NodeResult> {
  const trigger = ctx.input.trigger ?? ctx.input.json;
  return success({ ...(trigger as Record<string, unknown>) });
}

export async function executeCoreWebhook(ctx: NodeContext): Promise<NodeResult> {
  const trigger = ctx.input.trigger ?? ctx.input.json;
  return success({ ...(trigger as Record<string, unknown>) });
}

export async function executeCoreEnd(ctx: NodeContext): Promise<NodeResult> {
  return success({ ...ctx.input.json, _ended: true });
}

export async function executeCoreHttpRequest(ctx: NodeContext): Promise<NodeResult> {
  const exprCtx = exprContext(ctx);
  const resolved = resolveConfigRecord(ctx.config, exprCtx, ctx.input.json);
  const method = String(resolved.method ?? "GET").toUpperCase();
  const url = String(resolved.url ?? "").trim();

  let requestBody: unknown = resolved.body ?? resolved.jsonBody;

  if (ctx.config.wbahBodyBuilder === "dashboard_analyzed") {
    const { buildWbahDashboardAnalyzedPostBody } = await import(
      "@/lib/wbah/post-call/wbah-dashboard-post-body.shared"
    );
    const slotNodeId =
      exprCtx.nodeIdByLabel?.["build slot url"] ??
      exprCtx.nodeIdByLabel?.["build-slot-url"] ??
      "build-slot-url";
    const slotJson = (exprCtx.nodeOutputs[slotNodeId]?.[0] as { json?: Record<string, unknown> } | undefined)
      ?.json;
    requestBody = buildWbahDashboardAnalyzedPostBody(ctx.input.json, slotJson ?? {});
  }

  if (ctx.config.wbahBodyBuilder === "dashboard_raw") {
    const { buildWbahDashboardRawPostBody } = await import(
      "@/lib/wbah/post-call/wbah-dashboard-post-body.shared"
    );
    requestBody = buildWbahDashboardRawPostBody(ctx.input.json);
  }

  const batchIntervalMs = Number(ctx.config.batchIntervalMs ?? 0);
  if (batchIntervalMs > 0 && !ctx.config._dryRun) {
    await new Promise((r) => setTimeout(r, batchIntervalMs));
  }

  if (ctx.config._dryRun) {
    return success({
      ...ctx.input.json,
      _dryRunHttp: true,
      _url: url || "(missing url)",
      _method: method,
      _requestBody: requestBody,
    });
  }

  if (!url) {
    return {
      status: "error",
      error: { message: "HTTP Request node missing url", code: "CONFIG", retryable: false },
    };
  }

  const headers: Record<string, string> = {};
  if (resolved.headers && typeof resolved.headers === "object") {
    for (const [k, v] of Object.entries(resolved.headers as Record<string, unknown>)) {
      if (v != null) headers[k] = String(v);
    }
  }

  const timeoutMs = Number(ctx.config.timeoutMs ?? 30_000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const init: RequestInit = { method, headers, signal: controller.signal };
    if (method !== "GET" && method !== "HEAD" && requestBody != null) {
      init.body = typeof requestBody === "string" ? requestBody : JSON.stringify(requestBody);
      if (!headers["Content-Type"] && !headers["content-type"]) {
        headers["Content-Type"] = "application/json";
      }
    }

    const res = await fetch(url, init);
    const text = await res.text();
    let bodyJson: unknown = text;
    try {
      bodyJson = text ? JSON.parse(text) : null;
    } catch {
      /* keep text */
    }

    return success({
      statusCode: res.status,
      statusText: res.statusText,
      headers: Object.fromEntries(res.headers.entries()),
      body: bodyJson,
      ok: res.ok,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      status: "error",
      error: {
        message: `HTTP request failed: ${message}`,
        code: "HTTP_ERROR",
        retryable: message.includes("abort") || message.includes("timeout"),
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function executeCoreCondition(ctx: NodeContext): Promise<NodeResult> {
  const exprCtx = exprContext(ctx);

  const rules = ctx.config.conditions as N8nConditionRule[] | undefined;
  if (rules?.length) {
    const pass = evaluateN8nConditions(
      rules,
      String(ctx.config.combinator ?? "and"),
      exprCtx,
      ctx.input.json,
    );
    return {
      status: "success",
      output: { json: { ...ctx.input.json, _conditionResult: pass } },
      branch: pass ? "true" : "false",
    };
  }

  const conditionStr =
    String(ctx.config.expression ?? ctx.config.condition ?? "").trim() ||
    String(ctx.config.rules ?? "");

  let pass: boolean;
  if (conditionStr) {
    pass = evaluateConditionExpression(conditionStr, exprCtx, ctx.input.json);
  } else if (ctx.config.field != null) {
    const fieldVal = resolveExpressionValue(ctx.config.field, exprCtx, ctx.input.json).resolved;
    const want = resolveExpressionValue(ctx.config.value ?? true, exprCtx, ctx.input.json).resolved;
    pass = String(fieldVal) === String(want);
  } else {
    pass = true;
  }

  return {
    status: "success",
    output: { json: { ...ctx.input.json, _conditionResult: pass } },
    branch: pass ? "true" : "false",
  };
}

export async function executeCoreFunction(ctx: NodeContext): Promise<NodeResult> {
  const codeHint = ctx.config.codeHint ?? ctx.config.summary;
  if (codeHint && !ctx.config.code) {
    return success({
      ...ctx.input.json,
      _functionSkipped: true,
      _codeHint: String(codeHint),
    });
  }

  const code = String(ctx.config.code ?? "").trim();
  if (!code) return passthrough(ctx);

  try {
    const fn = new Function(
      "items",
      "$input",
      "$json",
      "$vars",
      `"use strict"; ${code}`,
    );
    const result = fn(
      [{ json: ctx.input.json }],
      ctx.input,
      ctx.input.json,
      ctx.variables,
    );
    if (result && typeof result === "object" && "json" in (result as object)) {
      return success((result as { json: Record<string, unknown> }).json);
    }
    if (Array.isArray(result) && result[0]?.json) {
      return success(result[0].json as Record<string, unknown>);
    }
    if (result && typeof result === "object") {
      return success(result as Record<string, unknown>);
    }
    return success({ ...ctx.input.json, _functionResult: result });
  } catch (e) {
    return {
      status: "error",
      error: {
        message: e instanceof Error ? e.message : String(e),
        code: "FUNCTION_ERROR",
        retryable: false,
      },
    };
  }
}

export async function executeCoreMerge(ctx: NodeContext): Promise<NodeResult> {
  const groups: Record<string, unknown>[][] = [];
  for (const [nodeId, outputs] of Object.entries(ctx.nodeOutputs)) {
    if (nodeId === ctx.nodeId) continue;
    const json = (outputs[0] as { json?: Record<string, unknown> } | undefined)?.json;
    if (json && Object.keys(json).length > 0) groups.push([{ ...json }]);
  }
  if (!groups.length) return passthrough(ctx);
  const combined = combineMergeOutputs(ctx.config, groups);
  return success(combined[0] ?? { ...ctx.input.json });
}

export async function executeCoreSwitch(ctx: NodeContext): Promise<NodeResult> {
  const exprCtx = exprContext(ctx);
  const rules = (ctx.config.rules ?? []) as Array<{ value?: unknown; output?: string }>;
  const field = resolveExpressionValue(ctx.config.field ?? ctx.config.expression, exprCtx, ctx.input.json)
    .resolved;

  for (const rule of rules) {
    if (String(rule.value) === String(field)) {
      return success({ ...ctx.input.json, _switchMatch: rule.value }, rule.output ?? "main");
    }
  }
  return success({ ...ctx.input.json, _switchMatch: null }, "default");
}

export async function executeCoreDelay(ctx: NodeContext): Promise<NodeResult> {
  const durationMs = Number(ctx.config.durationMs ?? 1000);
  const until = new Date(Date.now() + durationMs).toISOString();
  return {
    status: "waiting",
    output: { json: { ...ctx.input.json } },
    resume: {
      type: "delay",
      token: `${ctx.executionId}:${ctx.nodeId}`,
      until,
      metadata: { durationMs },
    },
  };
}

export async function executeCoreWait(ctx: NodeContext): Promise<NodeResult> {
  const mode = String(ctx.config.mode ?? "delay");
  if (mode === "delay") {
    return executeCoreDelay(ctx);
  }
  const token = String(ctx.config.token ?? `${ctx.executionId}:${ctx.nodeId}`);
  return {
    status: "waiting",
    output: { json: { ...ctx.input.json } },
    resume: {
      type: mode === "webhook" ? "webhook" : "event",
      token,
      metadata: { mode },
    },
  };
}

export async function executeCoreLoop(_ctx: NodeContext): Promise<NodeResult> {
  return {
    status: "error",
    error: {
      message: "Loop node not implemented yet (Phase 4+)",
      code: "NOT_IMPLEMENTED",
      retryable: false,
    },
  };
}

export const CORE_NODE_EXECUTORS: Record<string, NodeDefinition["execute"]> = {
  "core.start": executeCoreStart,
  "core.webhook": executeCoreWebhook,
  "core.end": executeCoreEnd,
  "core.http.request": executeCoreHttpRequest,
  "core.condition": executeCoreCondition,
  "core.function": executeCoreFunction,
  "core.merge": executeCoreMerge,
  "core.switch": executeCoreSwitch,
  "core.delay": executeCoreDelay,
  "core.wait": executeCoreWait,
  "core.loop": executeCoreLoop,
};
