/**
 * Workspace Voice Engine API keys from provider_settings.
 *
 * Relative imports only — reachable from the voice gateway bundle.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export async function lookupWorkspaceVoiceApiKey(
  sb: SupabaseClient | null | undefined,
  workspaceId: string | null | undefined,
  providerName: "fish" | "deepgram",
): Promise<string | null> {
  if (!sb || !workspaceId) return null;
  try {
    const { data } = await sb
      .from("provider_settings")
      .select("credentials")
      .eq("workspace_id", workspaceId)
      .eq("provider_category", "voice")
      .eq("provider_name", providerName)
      .maybeSingle();
    const creds = (data?.credentials ?? {}) as Record<string, unknown>;
    const key = typeof creds.apiKey === "string" ? creds.apiKey.trim() : "";
    return key || null;
  } catch {
    return null;
  }
}
