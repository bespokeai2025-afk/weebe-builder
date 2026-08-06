/**
 * Resolve Dynamics Opportunity identity from Retell dynamic variables (Rebook cohort).
 * Retell historically sends opportunityid in `lead_id` — never PATCH Lead for Rebook.
 */
export type WbahRebookEntityIds = {
  opportunityId: string;
  crmType: "opportunity";
  originatingLeadId: string | null;
  /** Local CRM row key for WeeBespoke dashboard POST (legacy column name lead_id). */
  dashboardRecordId: string;
};

export function resolveWbahRebookEntityIds(
  dynVars: Record<string, unknown>,
): WbahRebookEntityIds | null {
  const crmTypeRaw = String(dynVars.crm_type ?? dynVars.crmType ?? "").trim().toLowerCase();
  const explicitOpp = String(
    dynVars.opportunity_id ?? dynVars.opportunityid ?? dynVars.OpportunityId ?? "",
  ).trim();
  const legacyLeadId = String(dynVars.lead_id ?? dynVars.leadId ?? "").trim();

  const isOpportunity =
    crmTypeRaw === "opportunity" ||
    crmTypeRaw === "opportunities" ||
    Boolean(explicitOpp);

  if (!isOpportunity && crmTypeRaw && crmTypeRaw !== "lead") {
    return null;
  }

  const opportunityId =
    explicitOpp ||
    (isOpportunity && legacyLeadId ? legacyLeadId : "");
  if (!opportunityId) return null;

  const originatingLeadId = String(
    dynVars.originating_lead_id ??
      dynVars.originatingleadid ??
      dynVars.originatingLeadId ??
      "",
  ).trim();

  return {
    opportunityId,
    crmType: "opportunity",
    originatingLeadId: originatingLeadId || null,
    dashboardRecordId: opportunityId,
  };
}
