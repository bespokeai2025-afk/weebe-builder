/**
 * One variable engine for every node mode.
 *
 * Static → resolve → TTS
 * Prompt → resolve → LLM → TTS
 * Hybrid prefix → resolve → TTS, then prompt → resolve → LLM → TTS
 *
 * Unresolved `{{name}}` is left in place for operators unless `stripUnresolved`
 * is set (speech / LLM paths must never speak the braces).
 *
 * Relative imports only — reachable from the voice gateway bundle.
 */

import type { VariableValue } from "./types";

const PLACEHOLDER = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_.]*)\s*\}\}/g;

export function referencedVariableNames(text: string): string[] {
  const names = new Set<string>();
  const re = new RegExp(PLACEHOLDER.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) names.add(match[1]!);
  return [...names];
}

export function lookupRuntimeValue(
  runtime: Record<string, VariableValue>,
  name: string,
): string | undefined {
  if (Object.prototype.hasOwnProperty.call(runtime, name)) {
    const value = runtime[name];
    if (value !== undefined && value !== null && value !== "") return String(value);
  }
  if (name === "caller_number") {
    const alias = runtime.user_number ?? runtime.from_number ?? runtime.customer_phone;
    if (alias !== undefined && alias !== null && alias !== "") return String(alias);
  }
  if (name.includes(".")) {
    const nested = lookupNested(runtime, name);
    if (nested !== undefined) return nested;
  }
  return systemVariable(name);
}

/** Flatten a tool JSON object into `{{tool.field}}` (and bare `{{field}}`) keys. */
export function flattenToolVariables(
  toolName: string,
  payload: unknown,
): Record<string, VariableValue> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  const ns = String(toolName || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const out: Record<string, VariableValue> = {};
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) continue;
    if (value === undefined || value === null || value === "") continue;
    if (typeof value === "object") continue;
    const scalar = String(value);
    if (!(key in out)) out[key] = scalar;
    if (ns) out[`${ns}.${key}`] = scalar;
  }
  return out;
}

export function parseToolOutputVariables(
  toolName: string,
  output: string,
): Record<string, VariableValue> {
  const trimmed = output.trim();
  if (!trimmed) return {};
  try {
    return flattenToolVariables(toolName, JSON.parse(trimmed));
  } catch {
    return {};
  }
}

/** Fill `{{placeholders}}` from call context. Shared by static TTS and LLM prompts. */
export function resolveVariables(
  text: string,
  runtime: Record<string, VariableValue>,
  opts: { stripUnresolved?: boolean; titleCaseNames?: boolean } = {},
): string {
  if (!text || !text.includes("{{")) return text;
  const re = new RegExp(PLACEHOLDER.source, "g");
  return text.replace(re, (match, name: string) => {
    const raw = lookupRuntimeValue(runtime, name);
    if (raw === undefined) return opts.stripUnresolved ? "" : match;
    if (
      opts.titleCaseNames &&
      (/(^|_)name$/i.test(name) || /^(first_name|last_name|First_name)$/.test(name))
    ) {
      return raw.replace(/\b\w/g, (c) => c.toUpperCase());
    }
    return raw;
  });
}

/**
 * LLMs copy prompt scaffolds like `[chosen date and time]`. Fill those from
 * runtime vars, or drop them so they are never spoken.
 */
export function fillBracketPlaceholders(
  text: string,
  runtime: Record<string, VariableValue>,
): string {
  if (!text || !text.includes("[")) return text;
  return text.replace(/\[([^\]]+)\]/g, (match, inner: string) => {
    const label = inner.trim();
    if (!label) return "";
    const filled = bracketAliasValue(label, runtime);
    if (filled) return filled;
    if (/^(chosen|selected|the |your |insert |email|date|time|name|phone|address)/i.test(label)) {
      return "";
    }
    return match;
  }).replace(/[ \t]{2,}/g, " ").replace(/\s+([,!.?])/g, "$1");
}

function firstValue(
  runtime: Record<string, VariableValue>,
  names: string[],
): string | undefined {
  for (const name of names) {
    const value = lookupRuntimeValue(runtime, name);
    if (value) return value;
  }
  return undefined;
}

function bracketAliasValue(
  label: string,
  runtime: Record<string, VariableValue>,
): string | undefined {
  const compact = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const direct = lookupRuntimeValue(runtime, compact) ?? lookupRuntimeValue(runtime, label);
  if (direct) return direct;
  if (/date/.test(compact) && /time/.test(compact)) {
    const date = firstValue(runtime, [
      "appointment_date",
      "available_date",
      "selected_date",
      "requested_day",
    ]);
    const time = firstValue(runtime, [
      "appointment_time",
      "available_time",
      "selected_time",
      "requested_time",
    ]);
    if (date && time) return `${date} at ${time}`;
    return (
      date ??
      time ??
      firstValue(runtime, ["matched_slot", "calendar.matched_slot", "start"])
    );
  }
  if (/email/.test(compact)) {
    return firstValue(runtime, ["email", "customer_email", "email_address"]);
  }
  if (/(^|_)name$/.test(compact) || compact === "full_name" || compact === "caller_name") {
    const full = firstValue(runtime, ["customer_name", "full_name", "name"]);
    if (full) return full;
    const first = firstValue(runtime, ["first_name"]);
    const last = firstValue(runtime, ["last_name"]);
    if (first && last) return `${first} ${last}`;
    return first ?? last;
  }
  if (/phone|mobile/.test(compact)) {
    return firstValue(runtime, ["mobile", "phone", "customer_phone", "user_number", "caller_number"]);
  }
  if (/date/.test(compact)) {
    return firstValue(runtime, ["appointment_date", "available_date", "current_date"]);
  }
  if (/time/.test(compact)) {
    return firstValue(runtime, ["appointment_time", "available_time", "matched_slot"]);
  }
  return undefined;
}

function lookupNested(runtime: Record<string, VariableValue>, path: string): string | undefined {
  const parts = path.split(".");
  let current: unknown = runtime;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  if (current === undefined || current === null || current === "") return undefined;
  if (typeof current === "string" || typeof current === "number" || typeof current === "boolean") {
    return String(current);
  }
  return undefined;
}

function systemVariable(name: string): string | undefined {
  const now = new Date();
  if (name === "current_date") {
    return now.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  }
  if (name === "current_time") {
    return now.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit" });
  }
  return undefined;
}
