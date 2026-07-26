/**
 * Capability manifest — SERVER ONLY.
 *
 * getCapabilityManifest(workspaceId) returns every registered Mind tool enriched
 * with workspace-specific availability: when a tool's requiredIntegrations are
 * not connected the computed capabilityState is overridden to "integration_required";
 * when requiredCredentials are absent it becomes "credential_required".
 *
 * This is the single source of truth for "what can this workspace do right now"
 * — the UI, the chat orchestrator and SystemMind's deployment planner all read
 * from here.
 */
import type { MindToolMeta, CapabilityState } from "./tool-registry.shared";
import { enrichCapability } from "./capability-registry.shared";

// ── Integration presence lookup ───────────────────────────────────────────────

export interface ConnectedIntegrations {
  google_ads: boolean;
  google_search_console: boolean;
  meta_social: boolean;
  whatsapp: boolean;
  crm: boolean;
  email_sender: boolean;
}

async function resolveConnectedIntegrations(
  workspaceId: string,
): Promise<ConnectedIntegrations> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const admin = supabaseAdmin as any;

  const [gadsResult, gscResult, socialResult, settingsResult] = await Promise.all([
    admin
      .from("growthmind_gads_accounts")
      .select("id")
      .eq("workspace_id", workspaceId)
      .limit(1),
    admin
      .from("growthmind_gsc_oauth_tokens")
      .select("id")
      .eq("workspace_id", workspaceId)
      .limit(1),
    admin
      .from("growthmind_social_connections")
      .select("id")
      .eq("workspace_id", workspaceId)
      .in("provider", ["instagram", "facebook"])
      .eq("status", "active")
      .limit(1),
    admin
      .from("workspace_settings")
      .select("wati_api_key, twilio_account_sid, meta_wa_phone_number_id, crm_provider")
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
  ]);

  const settings = settingsResult.data ?? {};

  return {
    google_ads:            (gadsResult.data?.length   ?? 0) > 0,
    google_search_console: (gscResult.data?.length    ?? 0) > 0,
    meta_social:           (socialResult.data?.length ?? 0) > 0,
    whatsapp: !!(
      settings.wati_api_key ||
      settings.twilio_account_sid ||
      settings.meta_wa_phone_number_id
    ),
    crm:          !!(settings.crm_provider),
    email_sender: true, // Resend is a platform-level service (always available).
  };
}

function isIntegrationConnected(
  key: string,
  connected: ConnectedIntegrations,
): boolean {
  switch (key) {
    case "google_ads":            return connected.google_ads;
    case "google_search_console": return connected.google_search_console;
    case "meta_social":           return connected.meta_social;
    case "whatsapp":              return connected.whatsapp;
    case "crm":                   return connected.crm;
    case "email_sender":          return connected.email_sender;
    default:                      return true; // unknown keys fail open (assume connected)
  }
}

// ── Manifest entry type ───────────────────────────────────────────────────────

export interface CapabilityManifestEntry extends MindToolMeta {
  /** Effective capability state after overlay (may differ from static capabilityState). */
  capabilityState: CapabilityState;
  /** Integration keys that are declared required but not connected. */
  missingIntegrations: string[];
  /** Credential keys that are declared required but not configured. */
  missingCredentials: string[];
  /** Human-readable note when the capability is blocked. */
  limitationNote?: string;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Return every registered Mind tool enriched with workspace-specific availability.
 *
 * Tools whose requiredIntegrations are not all connected are surfaced as
 * "integration_required"; tools missing requiredCredentials as "credential_required".
 * All other enrichment defaults (mobileAvailable, rollbackSupported, etc.) are
 * applied via enrichCapability.
 */
export async function getCapabilityManifest(
  workspaceId: string,
): Promise<CapabilityManifestEntry[]> {
  const { listMindTools, mindToolsReady } = await import("./tool-registry.server");
  await mindToolsReady();
  const tools = listMindTools();

  const connected = await resolveConnectedIntegrations(workspaceId);

  return tools.map((rawTool): CapabilityManifestEntry => {
    // Apply standard enrichment (defaults, required-field checks).
    let tool: MindToolMeta;
    try {
      tool = enrichCapability(rawTool);
    } catch {
      tool = rawTool; // keep going — validation errors surface separately
    }

    const missingIntegrations = (tool.requiredIntegrations ?? []).filter(
      (key) => !isIntegrationConnected(key, connected),
    );

    // Credential checks: simple env-var presence (never expose values).
    const missingCredentials = (tool.requiredCredentials ?? []).filter(
      (key) => !process.env[key],
    );

    let capabilityState: CapabilityState = tool.capabilityState ?? "available";
    let limitationNote: string | undefined;

    if (missingIntegrations.length > 0) {
      capabilityState = "integration_required";
      limitationNote  = `Requires ${missingIntegrations.join(", ")} to be connected.`;
    } else if (missingCredentials.length > 0) {
      capabilityState = "credential_required";
      limitationNote  = `Requires credentials: ${missingCredentials.join(", ")}.`;
    }

    return {
      ...tool,
      capabilityState,
      missingIntegrations,
      missingCredentials,
      ...(limitationNote ? { limitationNote } : {}),
    };
  });
}
