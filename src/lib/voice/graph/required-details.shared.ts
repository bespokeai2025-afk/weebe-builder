/**
 * "Don't move on until the details are in" — the Retell pattern, made to hold on WEBEE Native.
 *
 * Retell has no required-fields setting. A flow gates a step with variables instead:
 *
 *   [ask step] ──caller answered──► [extract variables] ──{{email}} exists AND {{postcode}} exists──► next
 *                                                       └─else──► ask for what is missing
 *
 * The variables those equation exits test are the step's required details. This module names them
 * and says which are still empty, so the engine can (a) wait for this turn's extraction before an
 * ask step checks such exits, and (b) send the caller back to ask for what is missing when an
 * extract step's gate fails and the author drew no else exit.
 *
 * Relative imports only — this module is reachable from vite.config.ts.
 */
import { equationVars, parseEquationGroup } from "./equations.shared";
import type { FlowEdge, VariableValue } from "./types";

/** Times an extract step sends the caller back for missing details before the call moves on without them. */
export const MAX_DETAIL_REASKS = 3;

/** True when an edge is an equation condition (structured clauses, or `type: "equation"`). */
function isEquationEdge(edge: FlowEdge): boolean {
  const tc = edge.transition_condition;
  return !!tc && (tc.type === "equation" || (Array.isArray(tc.equations) && tc.equations.length > 0));
}

/**
 * An exit drawn as the step's "else": a prompt condition that is empty or reads "else"/"otherwise".
 * The builder exports an extract step's exits as plain edges (only logic splits get a real
 * `else_edge`), so this is how an author's else exit is recognised — the same rule the export uses
 * for logic splits.
 */
export function isElseEdge(edge: FlowEdge): boolean {
  if (!edge?.destination_node_id || isEquationEdge(edge)) return false;
  const prompt = String(edge.transition_condition?.prompt ?? "").trim();
  return !prompt || /^(else|otherwise)$/i.test(prompt);
}

/** The step's else exit (explicit `else_edge`, or one drawn as an else) and its other exits. */
export function splitElseEdge(
  edges: FlowEdge[] | undefined,
  explicitElse?: FlowEdge,
): { main: FlowEdge[]; elseEdge: FlowEdge | undefined } {
  const all = edges ?? [];
  if (explicitElse?.destination_node_id) return { main: all, elseEdge: explicitElse };
  const idx = all.findIndex(isElseEdge);
  if (idx < 0) return { main: all, elseEdge: undefined };
  return { main: all.filter((_, i) => i !== idx), elseEdge: all[idx] };
}

/** Variables that equation exits on these edges test — the details a step is gated on. */
export function edgeGateVars(edges: FlowEdge[] | undefined): string[] {
  const out = new Set<string>();
  for (const edge of edges ?? []) {
    if (!edge?.destination_node_id || !isEquationEdge(edge)) continue;
    for (const name of equationVars(parseEquationGroup(edge.transition_condition))) out.add(name);
  }
  return [...out];
}

function isEmpty(value: VariableValue | undefined): boolean {
  return value === undefined || value === null || String(value).trim() === "";
}

/** Gate variables that still have no value. */
export function missingGateVars(
  edges: FlowEdge[] | undefined,
  variables: Record<string, VariableValue>,
): string[] {
  return edgeGateVars(edges).filter((name) => isEmpty(variables[name]));
}
