import type { CrmAdapter, CrmContactInput, CrmCallActivityInput } from "@/lib/crm/crm-adapter.interface";

// TODO: implement — connect to Salesforce REST API
// Docs: https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest
export class SalesforceAdapter implements CrmAdapter {
  readonly name = "Salesforce";

  constructor(private readonly _config: { instanceUrl: string; accessToken: string }) {}

  async upsertContact(_contact: CrmContactInput): Promise<void> {
    throw new Error("Salesforce CRM adapter not yet implemented.");
  }

  async logCallActivity(_activity: CrmCallActivityInput): Promise<void> {
    throw new Error("Salesforce CRM adapter not yet implemented.");
  }

  async healthCheck(): Promise<boolean> {
    const { instanceUrl, accessToken } = this._config;
    if (!instanceUrl || !accessToken) return false;
    try {
      const resp = await fetch(`${instanceUrl}/services/data/v59.0`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      return resp.ok;
    } catch { return false; }
  }
}
