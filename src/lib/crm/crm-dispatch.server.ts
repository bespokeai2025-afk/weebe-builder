import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { HubSpotAdapter } from "./hubspot.adapter";
import { GoHighLevelAdapter } from "./gohighlevel.adapter";
import type { CrmContactInput, CrmCallActivityInput } from "./crm-adapter.interface";

export async function dispatchCrmPostCall(
  workspaceId: string,
  contact: CrmContactInput,
  activity: CrmCallActivityInput,
): Promise<void> {
  const { data: settings } = await (supabaseAdmin as any)
    .from("workspace_settings")
    .select("hubspot_api_key, ghl_api_key, ghl_location_id")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (!settings) return;

  const adapters = [];

  if (settings.hubspot_api_key) {
    adapters.push(new HubSpotAdapter(settings.hubspot_api_key));
  }

  if (settings.ghl_api_key && settings.ghl_location_id) {
    adapters.push(new GoHighLevelAdapter(settings.ghl_api_key, settings.ghl_location_id));
  }

  if (adapters.length === 0) return;

  await Promise.allSettled(
    adapters.map(async (adapter) => {
      try {
        await adapter.upsertContact(contact);
      } catch (err) {
        console.error(`[CRM] ${adapter.name} upsertContact failed`, err);
      }
      try {
        await adapter.logCallActivity(activity);
      } catch (err) {
        console.error(`[CRM] ${adapter.name} logCallActivity failed`, err);
      }
    }),
  );
}
