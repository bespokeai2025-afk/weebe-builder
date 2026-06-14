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
}
