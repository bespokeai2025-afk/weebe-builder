/**
 * n8n IF/Filter condition rules — combinator + operator panel.
 */
import type { ExpressionContext } from "../types/expression.types";
import { evaluateConditionExpression, resolveExpressionValue } from "./resolve-expression";
import { wbahWebhookHasCalendlySlot } from "@/lib/wbah/post-call/wbah-format-data.shared";

export type N8nConditionRule = {
  field: string;
  operator?: string;
  value?: string;
};

/** "not_equals", "Not Equals" and "not  equals" are the same operator. */
function normalizeOperator(op: string | undefined): string {
  return String(op ?? "equals")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, " ");
}

function compareNumbers(left: unknown, right: unknown, test: (l: number, r: number) => boolean): boolean {
  const l = Number(left);
  const r = Number(right);
  if (left == null || right == null || String(left).trim() === "" || !Number.isFinite(l) || !Number.isFinite(r)) {
    return false;
  }
  return test(l, r);
}

function resolveFieldValue(
  field: string,
  ctx: ExpressionContext,
  inputJson: Record<string, unknown>,
): unknown {
  const trimmed = field.trim();
  if (trimmed.includes("{{")) {
    return resolveExpressionValue(trimmed, ctx, inputJson).resolved;
  }
  if (trimmed.startsWith("$")) {
    return resolveExpressionValue(trimmed, ctx, inputJson).resolved;
  }
  if (trimmed.includes(".")) {
    const parts = trimmed.split(".");
    let cur: unknown = inputJson;
    for (const part of parts) {
      if (cur == null || typeof cur !== "object") return undefined;
      cur = (cur as Record<string, unknown>)[part];
    }
    return cur;
  }
  return inputJson[trimmed];
}

export function evaluateN8nConditionRule(
  rule: N8nConditionRule,
  ctx: ExpressionContext,
  inputJson: Record<string, unknown>,
): boolean {
  const op = normalizeOperator(rule.operator);
  const left = resolveFieldValue(rule.field, ctx, inputJson);
  const right =
    rule.value != null
      ? resolveExpressionValue(rule.value, ctx, inputJson).resolved
      : undefined;

  switch (op) {
    case "exists":
      return left != null && left !== "";
    case "not exists":
      return left == null || left === "";
    case "is not empty":
    case "not empty":
      return left != null && String(left).trim() !== "";
    case "is empty":
    case "empty":
      return left == null || String(left).trim() === "";
    case "equals":
    case "equal":
      return String(left ?? "") === String(right ?? "");
    case "not equals":
    case "not equal":
      return String(left ?? "") !== String(right ?? "");
    case "greater than":
    case "gt":
      return compareNumbers(left, right, (l, r) => l > r);
    case "greater than or equal":
    case "gte":
      return compareNumbers(left, right, (l, r) => l >= r);
    case "less than":
    case "lt":
      return compareNumbers(left, right, (l, r) => l < r);
    case "less than or equal":
    case "lte":
      return compareNumbers(left, right, (l, r) => l <= r);
    case "contains":
      return String(left ?? "").includes(String(right ?? ""));
    case "not contains":
      return !String(left ?? "").includes(String(right ?? ""));
    case "is true":
    case "true":
      return left === true || String(left).toLowerCase() === "true";
    case "is false":
    case "false":
      return left === false || String(left).toLowerCase() === "false";
    case "is valid":
      return left != null && String(left).trim() !== "" && String(left).toLowerCase() !== "invalid";
    case "wbah:calendly slot not empty":
    case "calendly slot not empty":
      return wbahWebhookHasCalendlySlot(
        left && typeof left === "object" ? (left as Record<string, unknown>) : inputJson,
      );
    default:
      if (rule.field.includes(" equals ") || rule.field.includes(" exists")) {
        return evaluateConditionExpression(rule.field, ctx, inputJson);
      }
      // An operator this engine does not know. Treating it as "the field has a value" let a
      // typo or an unsupported n8n operator pass the condition; failing closed sends the item
      // down the false branch and says why.
      console.warn(`[automation] unknown condition operator "${rule.operator}" — treated as false`);
      return false;
  }
}

export function evaluateN8nConditions(
  rules: N8nConditionRule[],
  combinator: "and" | "or" | string | undefined,
  ctx: ExpressionContext,
  inputJson: Record<string, unknown>,
): boolean {
  if (!rules.length) return true;
  const results = rules.map((r) => evaluateN8nConditionRule(r, ctx, inputJson));
  return String(combinator ?? "and").toLowerCase() === "or"
    ? results.some(Boolean)
    : results.every(Boolean);
}
