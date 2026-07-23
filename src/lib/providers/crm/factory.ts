import type { CrmAdapter, CrmContactInput, CrmCallActivityInput } from "@/lib/crm/crm-adapter.interface";
import { HubSpotAdapter } from "@/lib/crm/hubspot.adapter";
import { GoHighLevelAdapter } from "@/lib/crm/gohighlevel.adapter";
import { WeeBespokeAiAdapter } from "@/lib/crm/webespoke-ai.adapter";
import { SalesforceAdapter } from "./adapters/salesforce.adapter";
import { PipedriveAdapter } from "./adapters/pipedrive.adapter";
import { DynamicsAdapter, dynamicsConfigFromStored } from "./adapters/dynamics.adapter";
import { withProviderTracking } from "@/lib/providers/instrumentation";

export type CRMProviderName = "hubspot" | "gohighlevel" | "salesforce" | "pipedrive" | "dynamics" | "webespoke";

export type CRMConfig =
  | { provider: "hubspot"; apiKey: string }
  | { provider: "gohighlevel"; apiKey: string; locationId: string }
  | { provider: "salesforce"; instanceUrl: string; accessToken: string }
  | { provider: "pipedrive"; apiToken: string }
  | { provider: "dynamics"; tenantId: string; clientId: string; clientSecret: string; orgUrl: string }
  | { provider: "webespoke"; apiKey: string; apiUrl: string };

/**
 * Create a CrmAdapter. When `workspaceId` is included in `config`, every
 * method call is automatically tracked in provider_usage. Omit `workspaceId`
 * for call sites that do not have workspace context (e.g. migrations, seeds).
 */
export function createCRMProvider(config: CRMConfig & { workspaceId?: string }): CrmAdapter {
  let inner: CrmAdapter;
  switch (config.provider) {
    case "hubspot":
      inner = new HubSpotAdapter(config.apiKey);
      break;
    case "gohighlevel":
      inner = new GoHighLevelAdapter(config.apiKey, config.locationId);
      break;
    case "salesforce":
      inner = new SalesforceAdapter({ instanceUrl: config.instanceUrl, accessToken: config.accessToken });
      break;
    case "pipedrive":
      inner = new PipedriveAdapter(config.apiToken);
      break;
    case "webespoke":
      inner = new WeeBespokeAiAdapter(config.apiKey, config.apiUrl);
      break;
    case "dynamics":
      inner = new DynamicsAdapter({
        tenantId: config.tenantId,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        orgUrl: config.orgUrl,
      });
      break;
    default:
      throw new Error(`Unknown CRM provider: ${String((config as any).provider)}`);
  }

  if (!config.workspaceId) return inner;

  const { workspaceId, provider: providerName } = config;
  const track = <T>(fn: () => Promise<T>) =>
    withProviderTracking({ workspaceId, category: "crm", providerName, unitsConsumed: 1, unitType: "api_call" }, fn);

  return {
    name: inner.name,
    upsertContact:    (contact:  CrmContactInput)      => track(() => inner.upsertContact(contact)),
    logCallActivity:  (activity: CrmCallActivityInput) => track(() => inner.logCallActivity(activity)),
    healthCheck:      ()                               => inner.healthCheck(),
  };
}

/** @deprecated Use createCRMProvider({ ..., workspaceId }) instead. */
export const createInstrumentedCRMProvider = (
  config: CRMConfig & { workspaceId: string },
): CrmAdapter => createCRMProvider(config);
