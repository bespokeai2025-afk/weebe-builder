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

/**
 * Render a non-scalar variable value.
 *
 * `{{available_slots}}` holding an array of objects used to stringify to
 * "[object Object],[object Object]" — and on a static node that went straight
 * to TTS and was read aloud. Arrays and objects are legitimate variable values
 * (tool output, workflow results), so they need a defined rendering:
 *
 *   speech  — human-readable, for anything heading to TTS
 *   prompt  — compact JSON, so the LLM keeps the full structure it can reason
 *             over (an appointment list is far more useful to it as data)
 *
 * Both paths share one resolver; only the rendering differs.
 */
export type VariableFormat = "speech" | "prompt";

function renderScalar(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function renderForSpeech(value: unknown): string | undefined {
  const scalar = renderScalar(value);
  if (scalar !== undefined) return scalar;

  if (Array.isArray(value)) {
    const parts = value
      .map((item) => {
        const s = renderScalar(item);
        if (s !== undefined) return s;
        if (item && typeof item === "object") {
          // Speak the object's own scalar values, not its shape.
          const inner = Object.values(item as Record<string, unknown>)
            .map(renderScalar)
            .filter((v): v is string => v !== undefined);
          return inner.length ? inner.join(" ") : undefined;
        }
        return undefined;
      })
      .filter((v): v is string => v !== undefined && v !== "");
    if (parts.length === 0) return undefined;
    if (parts.length === 1) return parts[0];
    return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  }

  if (value && typeof value === "object") {
    const parts = Object.values(value as Record<string, unknown>)
      .map(renderScalar)
      .filter((v): v is string => v !== undefined && v !== "");
    return parts.length ? parts.join(" ") : undefined;
  }
  return undefined;
}

function renderForPrompt(value: unknown): string | undefined {
  const scalar = renderScalar(value);
  if (scalar !== undefined) return scalar;
  if (value && typeof value === "object") {
    try {
      const json = JSON.stringify(value);
      return json && json !== "{}" && json !== "[]" ? json : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function renderVariableValue(value: unknown, format: VariableFormat): string | undefined {
  return format === "prompt" ? renderForPrompt(value) : renderForSpeech(value);
}

export function lookupRuntimeValue(
  runtime: Record<string, VariableValue>,
  name: string,
  format: VariableFormat = "speech",
): string | undefined {
  if (Object.prototype.hasOwnProperty.call(runtime, name)) {
    const rendered = renderVariableValue(runtime[name], format);
    if (rendered !== undefined) return rendered;
  }
  if (name === "caller_number") {
    const alias = runtime.user_number ?? runtime.from_number ?? runtime.customer_phone;
    const rendered = renderVariableValue(alias, format);
    if (rendered !== undefined) return rendered;
  }
  if (name.includes(".")) {
    const nested = lookupNested(runtime, name, format);
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
  opts: {
    stripUnresolved?: boolean;
    titleCaseNames?: boolean;
    /** How non-scalar values render. Speech joins readably; prompt keeps JSON. */
    format?: VariableFormat;
  } = {},
): string {
  if (!text || !text.includes("{{")) return text;
  const re = new RegExp(PLACEHOLDER.source, "g");
  return text.replace(re, (match, name: string) => {
    const raw = lookupRuntimeValue(runtime, name, opts.format ?? "speech");
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

function lookupNested(
  runtime: Record<string, VariableValue>,
  path: string,
  format: VariableFormat = "speech",
): string | undefined {
  const parts = path.split(".");
  let current: unknown = runtime;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return renderVariableValue(current, format);
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
