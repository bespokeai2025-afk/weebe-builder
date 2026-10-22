/**
 * Contact details the WBAH agents ask for on the call (name, email, phone) but
 * must never write back to Dynamics. The CRM copy, entered by the WBAH team,
 * stays the source of truth; what the caller says goes in the call summary and
 * the timeline note only.
 *
 * Enforced at the PATCH (patchWbahLead / patchWbahOpportunity), so every path —
 * Allen's Logic, agentic, clear-data, rebook, automation engine — is covered.
 */
export const WBAH_PROTECTED_LEAD_FIELDS: ReadonlySet<string> = new Set([
  "firstname",
  "lastname",
  "middlename",
  "fullname",
  "emailaddress1",
  "emailaddress2",
  "emailaddress3",
  "mobilephone",
  "telephone1",
  "telephone2",
  "telephone3",
  "cos_nozero",
]);

export const WBAH_PROTECTED_OPPORTUNITY_FIELDS: ReadonlySet<string> = new Set([
  "new_firstname",
  "new_lastname",
  "new_mobile",
  "emailaddress",
]);

/** Returns the payload without protected contact fields, and the names it removed. */
export function stripWbahProtectedContactFields<T>(
  kind: "lead" | "opportunity",
  fields: Record<string, T>,
): { fields: Record<string, T>; removed: string[] } {
  const protectedSet =
    kind === "lead" ? WBAH_PROTECTED_LEAD_FIELDS : WBAH_PROTECTED_OPPORTUNITY_FIELDS;
  const kept: Record<string, T> = {};
  const removed: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (protectedSet.has(key.toLowerCase())) removed.push(key);
    else kept[key] = value;
  }
  return { fields: kept, removed };
}
