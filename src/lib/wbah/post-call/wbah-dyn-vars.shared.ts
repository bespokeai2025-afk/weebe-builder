/**
 * Retell call variables for the WBAH post-call pipeline — one implementation for
 * the core pipeline, the rebook pipeline and the automation engine.
 */

export type RetellCallVars = {
  retell_llm_dynamic_variables?: Record<string, unknown>;
  collected_dynamic_variables?: Record<string, unknown>;
};

/**
 * Variable names sometimes arrive wrapped in their own reference syntax —
 * `{{contact_same_as_property}}` instead of `contact_same_as_property` —
 * because the braces were typed into the name field of an Extract Variable
 * node rather than only where the variable is referenced. Retell stores that
 * key verbatim, so the value is present and correct but invisible to every
 * lookup by the bare name.
 *
 * Normalising here means the mistake costs nothing: both spellings resolve,
 * and the bare name wins if somehow both exist.
 */
function unwrapVariableKeys(vars: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...vars };
  for (const [key, value] of Object.entries(vars)) {
    const bare = key.trim().replace(/^\{\{\s*/, "").replace(/\s*\}\}$/, "");
    // Only alias; never shadow a real bare key that already carries a value.
    if (bare && bare !== key && !(bare in vars)) out[bare] = value;
  }
  return out;
}

export function extractDynVars(call: RetellCallVars, payload: Record<string, unknown>): Record<string, unknown> {
  const fromCall =
    call.retell_llm_dynamic_variables ??
    ((payload.call as RetellCallVars | undefined)?.retell_llm_dynamic_variables as
      | Record<string, unknown>
      | undefined) ??
    ((call as Record<string, unknown>).retell_llm_dynamic_variables as
      | Record<string, unknown>
      | undefined) ??
    {};
  const nested =
    (payload.call as Record<string, unknown> | undefined)?.retell_llm_dynamic_variables ??
    {};
  // Retell keeps the initial call-setup variables (lead_id, property_address,
  // etc.) under retell_llm_dynamic_variables, but anything captured LIVE by
  // an Extract Variable node mid-call — e.g. contact_same_as_property — lands
  // in a completely separate field, collected_dynamic_variables. Missing
  // this merge is why a variable that visibly fired in the Retell dashboard
  // (tool call + response both showing "true") never reached this pipeline:
  // it was never absent, just read from the wrong key. Collected values win
  // on overlap since they reflect the latest in-call state.
  const collected =
    call.collected_dynamic_variables ??
    ((payload.call as RetellCallVars | undefined)?.collected_dynamic_variables as
      | Record<string, unknown>
      | undefined) ??
    {};
  return unwrapVariableKeys({
    ...(typeof nested === "object" ? nested : {}),
    ...fromCall,
    ...(typeof collected === "object" ? collected : {}),
  });
}
