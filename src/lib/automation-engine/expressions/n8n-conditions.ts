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

function normalizeOperator(op: string | undefined): string {
  return String(op ?? "equals")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
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
    case "not_exists":
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
    case "not_equal":
    case "not equals":
      return String(left ?? "") !== String(right ?? "");
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
    case "wbah:calendly_slot_not_empty":
    case "calendly slot not empty":
      return wbahWebhookHasCalendlySlot(
        left && typeof left === "object" ? (left as Record<string, unknown>) : inputJson,
      );
    default:
      if (rule.field.includes(" equals ") || rule.field.includes(" exists")) {
        return evaluateConditionExpression(rule.field, ctx, inputJson);
      }
      return Boolean(left);
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
