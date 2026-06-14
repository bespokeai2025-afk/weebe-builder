import type { CrmAdapter, CrmContactInput, CrmCallActivityInput } from "@/lib/crm/crm-adapter.interface";

// TODO: implement — connect to Pipedrive REST API
// Docs: https://developers.pipedrive.com/docs/api/v1
export class PipedriveAdapter implements CrmAdapter {
  readonly name = "Pipedrive";

  constructor(private readonly _apiToken: string) {}

  async upsertContact(_contact: CrmContactInput): Promise<void> {
    throw new Error("Pipedrive CRM adapter not yet implemented.");
  }

  async logCallActivity(_activity: CrmCallActivityInput): Promise<void> {
    throw new Error("Pipedrive CRM adapter not yet implemented.");
  }

  async healthCheck(): Promise<boolean> {
    if (!this._apiToken) return false;
    try {
      const resp = await fetch(`https://api.pipedrive.com/v1/users/me?api_token=${this._apiToken}`);
      return resp.ok;
    } catch { return false; }
  }
}
