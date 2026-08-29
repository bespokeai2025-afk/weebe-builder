/**
 * Retell conversation-flow equations.
 *
 * Live agents store edges as:
 *   { type: "equation", operator: "||" | "&&", equations: [{ left, operator, right }] }
 * The builder used to keep only a prompt string, so import dropped every clause.
 */

export const EQUATION_OPERATORS = [
  { value: "==", label: "=", retell: ["==", "=", "eq", "equals"] },
  { value: "!=", label: "≠", retell: ["!=", "<>", "neq", "not_equals", "not_equal"] },
  { value: ">", label: ">", retell: [">", "gt"] },
  { value: ">=", label: "≥", retell: [">=", "gte"] },
  { value: "<", label: "<", retell: ["<", "lt"] },
  { value: "<=", label: "≤", retell: ["<=", "lte"] },
  { value: "contains", label: "contains", retell: ["contains", "include", "includes"] },
  {
    value: "not_contains",
    label: "does not contain",
    retell: ["not_contains", "not contains", "excludes"],
  },
  { value: "exists", label: "exists", retell: ["exists", "is_set", "truthy"] },
  {
    value: "not_exists",
    label: "does not exist",
    retell: ["not_exists", "is_empty", "empty", "falsy"],
  },
  { value: "matches", label: "matches", retell: ["matches", "regex", "match"] },
] as const;

export type EquationOperator = (typeof EQUATION_OPERATORS)[number]["value"];
export type EquationJoin = "||" | "&&";

export interface EquationClause {
  left: string;
  operator: EquationOperator;
  right?: string;
}

export interface EquationGroup {
  join: EquationJoin;
  equations: EquationClause[];
}

export type EquationValue = string | number | boolean | null;

const OP_ALIASES: Record<string, EquationOperator> = {};
for (const row of EQUATION_OPERATORS) {
  for (const alias of row.retell) OP_ALIASES[alias.toLowerCase()] = row.value;
}

export function normalizeEquationOperator(raw: unknown): EquationOperator {
  const key = String(raw ?? "").trim().toLowerCase();
  return OP_ALIASES[key] ?? "==";
}

export function normalizeEquationJoin(raw: unknown): EquationJoin {
  const key = String(raw ?? "").trim();
  if (key === "&&" || key === "AND" || /^all$/i.test(key)) return "&&";
  return "||";
}

export function operatorNeedsRight(op: EquationOperator): boolean {
  return op !== "exists" && op !== "not_exists";
}

function wrapVar(name: string): string {
  const t = name.trim();
  if (!t) return "";
  if (/^\{\{.+\}\}$/.test(t)) return t;
  return `{{${t.replace(/^\{\{|\}\}$/g, "")}}}`;
}

function unwrapVar(raw: string): string {
  const m = raw.trim().match(/^\{\{\s*([a-zA-Z0-9_]+)\s*\}\}$/);
  return m ? m[1]! : raw.trim();
}

function stripQuotes(raw: string): string {
  const t = raw.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

export function parseRhs(raw: string): EquationValue {
  const t = raw.trim();
  if (/^".*"$/.test(t) || /^'.*'$/.test(t)) return t.slice(1, -1);
  if (/^true$/i.test(t)) return true;
  if (/^false$/i.test(t)) return false;
  if (/^null$/i.test(t)) return null;
  const n = Number(t);
  if (!Number.isNaN(n) && t !== "") return n;
  return t;
}

function parseClause(raw: unknown): EquationClause | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const left = String(rec.left ?? rec.variable ?? rec.var ?? "").trim();
  if (!left) return null;
  const operator = normalizeEquationOperator(rec.operator ?? rec.op);
  const right = rec.right != null ? String(rec.right) : rec.value != null ? String(rec.value) : "";
  return { left: wrapVar(left), operator, right };
}

/** Read a Retell `transition_condition` (or our builder Transition) into a group. */
export function parseEquationGroup(input: {
  operator?: unknown;
  equations?: unknown;
  prompt?: unknown;
  condition?: unknown;
}): EquationGroup | null {
  if (Array.isArray(input.equations) && input.equations.length > 0) {
    const equations = input.equations
      .map(parseClause)
      .filter((c): c is EquationClause => Boolean(c));
    if (equations.length === 0) return null;
    return { join: normalizeEquationJoin(input.operator), equations };
  }
  const prompt = String(input.prompt ?? input.condition ?? "").trim();
  return promptToEquationGroup(prompt);
}

export function promptToEquationGroup(prompt: string): EquationGroup | null {
  const p = prompt.trim();
  if (!p) return null;
  if (!/\{\{/.test(p)) return null;
  const join: EquationJoin = /\bOR\b/.test(p) || /\|\|/.test(p) ? "||" : "&&";
  const parts = splitTopLevel(p, join === "||" ? ["OR", "||"] : ["AND", "&&"]);
  const equations = parts.map(promptToClause).filter((c): c is EquationClause => Boolean(c));
  if (equations.length === 0) return null;
  return { join, equations };
}

function splitTopLevel(expr: string, seps: string[]): string[] {
  const parts: string[] = [];
  let buf = "";
  let inQuote: string | null = null;
  const tokens = expr.split(/(\s+)/);
  for (const tok of tokens) {
    const trimmed = tok.trim();
    if (!inQuote && seps.includes(trimmed)) {
      if (buf.trim()) parts.push(buf);
      buf = "";
      continue;
    }
    for (const ch of tok) {
      if ((ch === '"' || ch === "'") && inQuote === ch) inQuote = null;
      else if ((ch === '"' || ch === "'") && !inQuote) inQuote = ch;
    }
    buf += tok;
  }
  if (buf.trim()) parts.push(buf);
  return parts.length ? parts : [expr];
}

function promptToClause(part: string): EquationClause | null {
  const p = part.trim();
  const bare = p.match(/^\{\{\s*([a-zA-Z0-9_]+)\s*\}\}$/);
  if (bare) return { left: wrapVar(bare[1]!), operator: "exists", right: "" };

  const contains = p.match(/^\{\{\s*([a-zA-Z0-9_]+)\s*\}\}\s+(not\s+)?contains\s+(.+)$/i);
  if (contains) {
    return {
      left: wrapVar(contains[1]!),
      operator: contains[2] ? "not_contains" : "contains",
      right: stripQuotes(contains[3]!),
    };
  }

  const matches = p.match(/^\{\{\s*([a-zA-Z0-9_]+)\s*\}\}\s+matches\s+(.+)$/i);
  if (matches) {
    return { left: wrapVar(matches[1]!), operator: "matches", right: matches[2]!.trim() };
  }

  const cmp = p.match(
    /^\{\{\s*([a-zA-Z0-9_]+)\s*\}\}\s*(===|!==|==|!=|<=|>=|<|>|=)\s*(.+)$/i,
  );
  if (!cmp) return null;
  const op = normalizeEquationOperator(cmp[2]);
  return { left: wrapVar(cmp[1]!), operator: op, right: stripQuotes(cmp[3]!) };
}

export function serializeEquationPrompt(group: EquationGroup | null | undefined): string {
  if (!group?.equations.length) return "";
  const sep = group.join === "&&" ? " AND " : " OR ";
  return group.equations.map(serializeClausePrompt).join(sep);
}

function serializeClausePrompt(clause: EquationClause): string {
  const left = wrapVar(clause.left);
  if (clause.operator === "exists") return left;
  if (clause.operator === "not_exists") return `${left} == ""`;
  const right = formatRhsForPrompt(clause.right ?? "");
  if (clause.operator === "contains" || clause.operator === "not_contains") {
    return `${left} ${clause.operator === "contains" ? "contains" : "not contains"} ${right}`;
  }
  if (clause.operator === "matches") return `${left} matches ${clause.right ?? ""}`;
  return `${left} ${clause.operator} ${right}`;
}

function formatRhsForPrompt(raw: string): string {
  const t = raw.trim();
  if (!t) return '""';
  if (/^".*"$/.test(t) || /^'.*'$/.test(t)) return t;
  if (/^(true|false|null)$/i.test(t)) return t.toLowerCase();
  if (!Number.isNaN(Number(t)) && t !== "") return t;
  return JSON.stringify(t);
}

/** Retell JSON fragment for an equation transition. */
export function toRetellEquationCondition(group: EquationGroup | null | undefined): {
  type: "equation";
  operator: EquationJoin;
  equations: Array<{ left: string; operator: string; right: string }>;
  prompt: string;
} | null {
  if (!group?.equations.length) return null;
  return {
    type: "equation",
    operator: group.join,
    equations: group.equations.map((c) => ({
      left: wrapVar(c.left),
      operator: c.operator,
      right: c.right ?? "",
    })),
    prompt: serializeEquationPrompt(group),
  };
}

export function evaluateEquationClause(
  clause: EquationClause,
  variables: Record<string, EquationValue>,
): boolean {
  const name = unwrapVar(clause.left);
  const left = variables[name];
  const op = clause.operator;

  if (op === "exists") {
    return left !== null && left !== undefined && left !== "" && left !== false;
  }
  if (op === "not_exists") {
    return left === null || left === undefined || left === "" || left === false;
  }

  const right = parseRhs(clause.right ?? "");
  const leftStr = String(left ?? "");
  const rightStr = String(right ?? "");

  if (op === "contains") {
    return leftStr.toLowerCase().includes(rightStr.toLowerCase());
  }
  if (op === "not_contains") {
    return !leftStr.toLowerCase().includes(rightStr.toLowerCase());
  }
  if (op === "matches") {
    const raw = String(clause.right ?? "").trim();
    const slash = raw.match(/^\/(.+)\/([a-z]*)$/s);
    try {
      const re = slash ? new RegExp(slash[1]!, slash[2]) : new RegExp(rightStr);
      return re.test(leftStr);
    } catch {
      return false;
    }
  }

  const ln = typeof left === "number" ? left : Number(left);
  const rn = typeof right === "number" ? right : Number(right);
  const numeric =
    !Number.isNaN(ln) &&
    !Number.isNaN(rn) &&
    String(left ?? "").trim() !== "" &&
    String(right ?? "").trim() !== "";

  switch (op) {
    case "==":
      return numeric ? ln === rn : leftStr === rightStr;
    case "!=":
      return numeric ? ln !== rn : leftStr !== rightStr;
    case "<":
      return numeric ? ln < rn : false;
    case "<=":
      return numeric ? ln <= rn : false;
    case ">":
      return numeric ? ln > rn : false;
    case ">=":
      return numeric ? ln >= rn : false;
    default:
      return false;
  }
}

export function evaluateEquationGroup(
  group: EquationGroup | null | undefined,
  variables: Record<string, EquationValue>,
): boolean | null {
  if (!group?.equations.length) return null;
  const results = group.equations.map((c) => evaluateEquationClause(c, variables));
  return group.join === "&&" ? results.every(Boolean) : results.some(Boolean);
}

export function emptyEquationClause(): EquationClause {
  return { left: "", operator: "==", right: "" };
}

export function equationVars(group: EquationGroup | null | undefined): string[] {
  if (!group) return [];
  return group.equations.map((c) => unwrapVar(c.left)).filter(Boolean);
}
