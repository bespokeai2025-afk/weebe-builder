// ── SystemMind Dynamic Variable Engine — pure transformation library ──────────
// Every transformation is a PURE function: (value, config) → result. No IO, no
// DB, no Date.now() dependence beyond explicit config — so each rule is
// individually testable with sample data.
//
// Rule types (mirrors systemmind_transformation_rules.rule_type CHECK):
//   date_format | phone_e164 | currency_format | boolean_map | enum_map |
//   concat | name_split | null_fallback | conditional | custom_json

export type TransformRuleType =
  | "date_format" | "phone_e164" | "currency_format" | "boolean_map"
  | "enum_map" | "concat" | "name_split" | "null_fallback"
  | "conditional" | "custom_json";

export const TRANSFORM_RULE_TYPES: TransformRuleType[] = [
  "date_format", "phone_e164", "currency_format", "boolean_map", "enum_map",
  "concat", "name_split", "null_fallback", "conditional", "custom_json",
];

export type TransformResult = {
  ok: boolean;
  /** Transformed output value (undefined when ok=false). */
  value?: unknown;
  error?: string;
};

// ── date_format ────────────────────────────────────────────────────────────────
// config: { outputFormat: "iso" | "iso_date" | "dmy" | "mdy" | "ymd" | "time_hm" | "dmy_hm",
//           separator?: string }   (input: ISO string, epoch ms, or Date-parsable)
function transformDateFormat(value: unknown, config: Record<string, unknown>): TransformResult {
  if (value === null || value === undefined || value === "") return { ok: false, error: "No date value provided." };
  const raw = typeof value === "number" ? new Date(value) : new Date(String(value));
  if (Number.isNaN(raw.getTime())) return { ok: false, error: `Not a parsable date: "${String(value)}"` };
  const sep = typeof config.separator === "string" && config.separator ? config.separator : "/";
  const pad = (n: number) => String(n).padStart(2, "0");
  const d = pad(raw.getUTCDate()), m = pad(raw.getUTCMonth() + 1), y = String(raw.getUTCFullYear());
  const hm = `${pad(raw.getUTCHours())}:${pad(raw.getUTCMinutes())}`;
  switch (String(config.outputFormat ?? "iso")) {
    case "iso":      return { ok: true, value: raw.toISOString() };
    case "iso_date": return { ok: true, value: `${y}-${m}-${d}` };
    case "dmy":      return { ok: true, value: [d, m, y].join(sep) };
    case "mdy":      return { ok: true, value: [m, d, y].join(sep) };
    case "ymd":      return { ok: true, value: [y, m, d].join(sep) };
    case "time_hm":  return { ok: true, value: hm };
    case "dmy_hm":   return { ok: true, value: `${[d, m, y].join(sep)} ${hm}` };
    default:         return { ok: false, error: `Unknown outputFormat "${String(config.outputFormat)}"` };
  }
}

// ── phone_e164 ─────────────────────────────────────────────────────────────────
// config: { defaultCountryCode?: string }  e.g. "44" for UK. Deterministic
// normalisation: strips separators, handles 00-prefix and national 0-prefix.
function transformPhoneE164(value: unknown, config: Record<string, unknown>): TransformResult {
  if (value === null || value === undefined || value === "") return { ok: false, error: "No phone value provided." };
  let s = String(value).trim().replace(/[\s().-]/g, "");
  const cc = String(config.defaultCountryCode ?? "44").replace(/\D/g, "");
  if (s.startsWith("+")) s = "+" + s.slice(1).replace(/\D/g, "");
  else if (s.startsWith("00")) s = "+" + s.slice(2).replace(/\D/g, "");
  else {
    s = s.replace(/\D/g, "");
    if (s.startsWith("0")) s = `+${cc}${s.slice(1)}`;
    else if (cc && s.startsWith(cc)) s = `+${s}`;
    else s = `+${cc}${s}`;
  }
  if (!/^\+[1-9]\d{6,14}$/.test(s)) return { ok: false, error: `Could not normalise to E.164: "${String(value)}" → "${s}"` };
  return { ok: true, value: s };
}

// ── currency_format ────────────────────────────────────────────────────────────
// config: { currency?: string ("GBP"), style?: "symbol"|"code"|"number", decimals?: number }
const CURRENCY_SYMBOLS: Record<string, string> = { GBP: "£", USD: "$", EUR: "€" };
function transformCurrencyFormat(value: unknown, config: Record<string, unknown>): TransformResult {
  if (value === null || value === undefined || value === "") return { ok: false, error: "No amount provided." };
  const num = typeof value === "number" ? value : Number(String(value).replace(/[£$€,\s]/g, ""));
  if (!Number.isFinite(num)) return { ok: false, error: `Not a numeric amount: "${String(value)}"` };
  const decimals = Number.isInteger(config.decimals) ? Number(config.decimals) : 2;
  const fixed = num.toFixed(Math.min(Math.max(decimals, 0), 6));
  const currency = String(config.currency ?? "GBP").toUpperCase();
  switch (String(config.style ?? "symbol")) {
    case "number": return { ok: true, value: Number(fixed) };
    case "code":   return { ok: true, value: `${fixed} ${currency}` };
    case "symbol":
    default:       return { ok: true, value: `${CURRENCY_SYMBOLS[currency] ?? currency + " "}${fixed}` };
  }
}

// ── boolean_map ────────────────────────────────────────────────────────────────
// config: { trueValues?: string[], falseValues?: string[], trueOutput?: unknown, falseOutput?: unknown }
function transformBooleanMap(value: unknown, config: Record<string, unknown>): TransformResult {
  const truthy = (Array.isArray(config.trueValues) ? config.trueValues : ["true", "yes", "y", "1"]).map((v) => String(v).toLowerCase());
  const falsy  = (Array.isArray(config.falseValues) ? config.falseValues : ["false", "no", "n", "0"]).map((v) => String(v).toLowerCase());
  const s = String(value ?? "").trim().toLowerCase();
  if (typeof value === "boolean") return { ok: true, value: value ? (config.trueOutput ?? true) : (config.falseOutput ?? false) };
  if (truthy.includes(s)) return { ok: true, value: config.trueOutput ?? true };
  if (falsy.includes(s))  return { ok: true, value: config.falseOutput ?? false };
  return { ok: false, error: `Value "${String(value)}" matched neither true nor false set.` };
}

// ── enum_map ───────────────────────────────────────────────────────────────────
// config: { map: Record<string,string>, caseInsensitive?: boolean, defaultOutput?: string }
function transformEnumMap(value: unknown, config: Record<string, unknown>): TransformResult {
  const map = config.map && typeof config.map === "object" ? (config.map as Record<string, unknown>) : {};
  const s = String(value ?? "");
  const ci = config.caseInsensitive !== false;
  const key = ci
    ? Object.keys(map).find((k) => k.toLowerCase() === s.toLowerCase())
    : (s in map ? s : undefined);
  if (key !== undefined) return { ok: true, value: map[key] };
  if (config.defaultOutput !== undefined) return { ok: true, value: config.defaultOutput };
  return { ok: false, error: `No mapping for "${s}" and no defaultOutput set.` };
}

// ── concat ─────────────────────────────────────────────────────────────────────
// Input is a Record of parts. config: { fields: string[], separator?: string, skipEmpty?: boolean }
function transformConcat(value: unknown, config: Record<string, unknown>): TransformResult {
  if (!value || typeof value !== "object") return { ok: false, error: "concat needs an object input, e.g. { first_name, last_name }." };
  const obj = value as Record<string, unknown>;
  const fields = Array.isArray(config.fields) ? config.fields.map(String) : Object.keys(obj);
  const sep = typeof config.separator === "string" ? config.separator : " ";
  const parts = fields.map((f) => String(obj[f] ?? "").trim());
  const kept = config.skipEmpty === false ? parts : parts.filter((p) => p.length > 0);
  return { ok: true, value: kept.join(sep) };
}

// ── name_split ─────────────────────────────────────────────────────────────────
// config: { part: "first" | "last" | "both" }
function transformNameSplit(value: unknown, config: Record<string, unknown>): TransformResult {
  const s = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!s) return { ok: false, error: "No name provided." };
  const bits = s.split(" ");
  const first = bits[0];
  const last = bits.length > 1 ? bits.slice(1).join(" ") : "";
  switch (String(config.part ?? "both")) {
    case "first": return { ok: true, value: first };
    case "last":  return { ok: true, value: last };
    case "both":
    default:      return { ok: true, value: { first_name: first, last_name: last } };
  }
}

// ── null_fallback ──────────────────────────────────────────────────────────────
// config: { fallback: unknown, treatEmptyStringAsNull?: boolean }
function transformNullFallback(value: unknown, config: Record<string, unknown>): TransformResult {
  const emptyIsNull = config.treatEmptyStringAsNull !== false;
  const isNullish = value === null || value === undefined || (emptyIsNull && String(value).trim() === "");
  return { ok: true, value: isNullish ? (config.fallback ?? "") : value };
}

// ── conditional ────────────────────────────────────────────────────────────────
// config: { conditions: [{ op: "equals"|"not_equals"|"contains"|"gt"|"lt"|"empty"|"not_empty",
//                          compareTo?: unknown, output: unknown }], defaultOutput?: unknown }
function transformConditional(value: unknown, config: Record<string, unknown>): TransformResult {
  const conditions = Array.isArray(config.conditions) ? config.conditions : [];
  const s = String(value ?? "");
  for (const c of conditions as Array<Record<string, unknown>>) {
    const cmp = String(c.compareTo ?? "");
    const num = Number(value), cmpNum = Number(c.compareTo);
    const hit =
      c.op === "equals"     ? s.toLowerCase() === cmp.toLowerCase() :
      c.op === "not_equals" ? s.toLowerCase() !== cmp.toLowerCase() :
      c.op === "contains"   ? s.toLowerCase().includes(cmp.toLowerCase()) :
      c.op === "gt"         ? Number.isFinite(num) && Number.isFinite(cmpNum) && num > cmpNum :
      c.op === "lt"         ? Number.isFinite(num) && Number.isFinite(cmpNum) && num < cmpNum :
      c.op === "empty"      ? s.trim() === "" :
      c.op === "not_empty"  ? s.trim() !== "" :
      false;
    if (hit) return { ok: true, value: c.output };
  }
  if (config.defaultOutput !== undefined) return { ok: true, value: config.defaultOutput };
  return { ok: false, error: "No condition matched and no defaultOutput set." };
}

// ── custom_json ────────────────────────────────────────────────────────────────
// config: { template: object } — every string leaf supports "{{value}}" and,
// when the input is an object, "{{value.path}}" substitution.
function substituteTemplate(node: unknown, value: unknown): unknown {
  if (typeof node === "string") {
    return node.replace(/\{\{\s*value(?:\.([a-zA-Z0-9_.]+))?\s*\}\}/g, (_all, path?: string) => {
      if (!path) return typeof value === "object" && value !== null ? JSON.stringify(value) : String(value ?? "");
      let cur: unknown = value;
      for (const key of path.split(".")) {
        if (cur && typeof cur === "object" && key in (cur as Record<string, unknown>)) cur = (cur as Record<string, unknown>)[key];
        else return "";
      }
      return typeof cur === "object" && cur !== null ? JSON.stringify(cur) : String(cur ?? "");
    });
  }
  if (Array.isArray(node)) return node.map((n) => substituteTemplate(n, value));
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) out[k] = substituteTemplate(v, value);
    return out;
  }
  return node;
}
function transformCustomJson(value: unknown, config: Record<string, unknown>): TransformResult {
  if (!config.template || typeof config.template !== "object") return { ok: false, error: "custom_json needs a config.template object." };
  try {
    return { ok: true, value: substituteTemplate(config.template, value) };
  } catch (err: any) {
    return { ok: false, error: `Template substitution failed: ${err?.message}` };
  }
}

// ── Dispatcher ─────────────────────────────────────────────────────────────────
export function applyTransformation(
  ruleType: TransformRuleType | string,
  value: unknown,
  config: Record<string, unknown> = {},
): TransformResult {
  switch (ruleType) {
    case "date_format":     return transformDateFormat(value, config);
    case "phone_e164":      return transformPhoneE164(value, config);
    case "currency_format": return transformCurrencyFormat(value, config);
    case "boolean_map":     return transformBooleanMap(value, config);
    case "enum_map":        return transformEnumMap(value, config);
    case "concat":          return transformConcat(value, config);
    case "name_split":      return transformNameSplit(value, config);
    case "null_fallback":   return transformNullFallback(value, config);
    case "conditional":     return transformConditional(value, config);
    case "custom_json":     return transformCustomJson(value, config);
    default:                return { ok: false, error: `Unknown transformation rule type "${String(ruleType)}"` };
  }
}

// ── Validation (post-transform, by variable data type) ────────────────────────
export type ValidationResult = { valid: boolean; error?: string };

export function validateByDataType(dataType: string, value: unknown): ValidationResult {
  if (value === null || value === undefined || value === "") return { valid: true }; // required-ness is checked separately
  const s = typeof value === "object" ? "" : String(value);
  switch (dataType) {
    case "email":    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? { valid: true } : { valid: false, error: `"${s}" is not a valid email address.` };
    case "phone":    return /^\+[1-9]\d{6,14}$/.test(s) ? { valid: true } : { valid: false, error: `"${s}" is not E.164 format (e.g. +447700900123).` };
    case "url":      { try { new URL(s); return { valid: true }; } catch { return { valid: false, error: `"${s}" is not a valid URL.` }; } }
    case "number":
    case "currency": return Number.isFinite(Number(String(s).replace(/[£$€,\s]/g, ""))) ? { valid: true } : { valid: false, error: `"${s}" is not numeric.` };
    case "boolean":  return typeof value === "boolean" || /^(true|false|yes|no|0|1)$/i.test(s) ? { valid: true } : { valid: false, error: `"${s}" is not a boolean.` };
    case "date":
    case "datetime": return !Number.isNaN(new Date(typeof value === "number" ? value : s).getTime()) ? { valid: true } : { valid: false, error: `"${s}" is not a parsable date.` };
    case "json":     {
      if (typeof value === "object") return { valid: true };
      try { JSON.parse(s); return { valid: true }; } catch { return { valid: false, error: `"${s.slice(0, 80)}" is not valid JSON.` }; }
    }
    default:         return { valid: true };
  }
}
