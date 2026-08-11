/**
 * Load Pabau API credentials for a WEBEE workspace (SystemMind CRM connection).
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { decryptCredentials } from "@/lib/systemmind/client-api-connections.server";
import type { PabauClientConfig } from "@/lib/pabau/pabau-receptionist.server";

export async function getPabauClientConfigForWorkspace(
  workspaceId: string,
): Promise<PabauClientConfig | null> {
  const { data, error } = await supabaseAdmin
    .from("systemmind_crm_connections")
    .select("credentials_encrypted, status")
    .eq("workspace_id", workspaceId)
    .eq("provider", "pabau")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data?.credentials_encrypted) return null;

  const creds = decryptCredentials({ _enc: data.credentials_encrypted });
  const apiKey = (creds.apiKey ?? creds.api_key ?? "").trim();
  if (!apiKey) return null;

  return {
    apiKey,
    baseUrl: creds.baseUrl ?? creds.base_url ?? null,
  };
}

export async function resolveWorkspaceIdForRetellAgent(
  retellAgentId: string,
): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("agents")
    .select("workspace_id")
    .or(
      `retell_agent_id.eq.${retellAgentId},settings->>deployedRetellAgentId.eq.${retellAgentId}`,
    )
    .maybeSingle();
  return data?.workspace_id ?? null;
}
