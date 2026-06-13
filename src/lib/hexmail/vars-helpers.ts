// ── Variable definitions stored inline at the end of template content ─────────
// Format:  <body text>\n\n---TEMPLATE_VARS---\n<json>
//
// The sentinel is stripped before rendering / sending the document.

const SENTINEL = "\n\n---TEMPLATE_VARS---\n";

export type VarType = "text" | "number" | "currency" | "address" | "date" | "email" | "phone";

export interface VarDef {
  label:   string;
  type:    VarType;
  default: string;
}

export type VarMap = Record<string, VarDef>;

// ── Encode / decode ──────────────────────────────────────────────────────────

/** Split stored content into { body, vars } */
export function splitContent(raw: string): { body: string; vars: VarMap } {
  const idx = raw.indexOf(SENTINEL);
  if (idx === -1) return { body: raw, vars: {} };
  const body    = raw.slice(0, idx);
  const jsonStr = raw.slice(idx + SENTINEL.length);
  try {
    return { body, vars: JSON.parse(jsonStr) };
  } catch {
    return { body, vars: {} };
  }
}

/** Combine body text + var definitions into the value stored in the DB */
export function joinContent(body: string, vars: VarMap): string {
  if (Object.keys(vars).length === 0) return body;
  return body + SENTINEL + JSON.stringify(vars);
}

/** Scan body text for all {{variable_name}} tokens */
export function detectVars(body: string): string[] {
  const found = new Set<string>();
  const re = /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) found.add(m[1]);
  return [...found];
}

/** Merge newly detected var names into an existing VarMap, adding defaults for new ones */
export function mergeDetected(existing: VarMap, detected: string[]): VarMap {
  const next: VarMap = { ...existing };
  for (const key of detected) {
    if (!next[key]) {
      next[key] = {
        label:   keyToLabel(key),
        type:    inferType(key),
        default: "",
      };
    }
  }
  // Remove entries whose key is no longer present in detected
  for (const key of Object.keys(next)) {
    if (!detected.includes(key)) delete next[key];
  }
  return next;
}

// ── Apply variables for preview ──────────────────────────────────────────────

export function applyVars(body: string, fills: Record<string, string>): string {
  return body.replace(/\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g, (_, key) =>
    fills[key] !== undefined ? fills[key] : `{{${key}}}`,
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function keyToLabel(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function inferType(key: string): VarType {
  const lower = key.toLowerCase();
  if (/price|amount|cost|total|fee|rate|value|subtotal|tax|discount/.test(lower)) return "currency";
  if (/number|num|no|id|invoice|ref|order/.test(lower))                          return "number";
  if (/address|street|city|postcode|zip|state|country/.test(lower))              return "address";
  if (/date|day|month|year|due|expiry|issued/.test(lower))                       return "date";
  if (/email|mail/.test(lower))                                                  return "email";
  if (/phone|mobile|tel|fax/.test(lower))                                        return "phone";
  return "text";
}

export const VAR_TYPE_LABELS: Record<VarType, string> = {
  text:     "Text",
  number:   "Number",
  currency: "Currency",
  address:  "Address",
  date:     "Date",
  email:    "Email",
  phone:    "Phone",
};
