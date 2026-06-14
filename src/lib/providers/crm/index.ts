export type { CrmAdapter, CrmContactInput, CrmCallActivityInput } from "./interface";
export { createCRMProvider, type CRMProviderName, type CRMConfig } from "./factory";

// Re-export existing CRM adapters & dispatch — existing call sites unchanged
export { HubSpotAdapter, validateHubSpotKey } from "@/lib/crm/hubspot.adapter";
export { GoHighLevelAdapter, validateGhlKey } from "@/lib/crm/gohighlevel.adapter";
export { dispatchCrmPostCall } from "@/lib/crm/crm-dispatch.server";
