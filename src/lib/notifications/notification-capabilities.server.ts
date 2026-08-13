/**
 * Workspace notification capabilities — which catalogue capabilities are
 * active for a workspace, resolved from package entitlements ∩ real config.
 *
 * Used ONLY for provisioning + Settings UI applicability filtering. Display
 * filtering fails OPEN (show everything) so a resolution error can never
 * hide a user's notification settings.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  NOTIFICATION_EVENT_KEYS,
  NOTIFICATION_EVENT_DEFS,
  type NotificationCapabilityKey,
  type NotificationEventKey,
} from "./notification-engine.shared";

const sb = supabaseAdmin as any;

export type WorkspaceNotificationCapabilities = Record<NotificationCapabilityKey, boolean>;

const ALL_ON: WorkspaceNotificationCapabilities = {
  core: true, leads: true, campaigns: true, campaign_reports: true,
  follow_up: true, whatsapp: true, hivemind: true, growthmind: true,
  systemmind: true, accountsmind: true, reseller: true,
};

// Short in-process cache — capability changes surface within a minute.
const cache = new Map<string, { at: number; caps: WorkspaceNotificationCapabilities }>();
const CACHE_MS = 60_000;

/**
 * Resolve active capabilities. Package features gate everything; WhatsApp and
 * reseller additionally require real config. Fails OPEN to all-on so display
 * filtering never hides settings on a lookup error.
 */
export async function getWorkspaceNotificationCapabilities(
  workspaceId: string,
): Promise<WorkspaceNotificationCapabilities> {
  const hit = cache.get(workspaceId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.caps;
  try {
    const [{ getWorkspaceEntitlements }, settingsRes] = await Promise.all([
      import("@/lib/packages/entitlements.server"),
      sb
        .from("workspace_settings")
        .select("whatsapp_phone_id, meta_phone_number_id")
        .eq("workspace_id", workspaceId)
        .maybeSingle(),
    ]);
    const ent = await getWorkspaceEntitlements(workspaceId);
    const f = ent.features ?? {};
    // getWorkspaceEntitlements never throws — lookup failures come back as
    // noEntitlements() (every feature false). That shape is indistinguishable
    // from a broken lookup, so treat it as INDETERMINATE: fail open, uncached.
    if (!Object.values(f).some((v) => v === true)) return ALL_ON;

    // Settings probe failure → treat WhatsApp as feature-gated only (open).
    const settingsFailed = !!settingsRes?.error;
    const settings = settingsRes?.data ?? null;
    const whatsappConfigured = !!(settings?.whatsapp_phone_id || settings?.meta_phone_number_id);
    // WATI workspaces configure via provider tables, not workspace_settings —
    // treat any existing WhatsApp conversation as proof of configuration.
    let whatsappActive = f["whatsapp"] === true && (whatsappConfigured || settingsFailed);
    if (f["whatsapp"] === true && !whatsappActive) {
      const { count, error: waErr } = await sb
        .from("whatsapp_messages")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .limit(1);
      // Probe error → indeterminate → fail open for this capability.
      whatsappActive = waErr ? true : (count ?? 0) > 0;
    }
    const caps: WorkspaceNotificationCapabilities = {
      core: true,
      leads: f["leads"] === true,
      campaigns: f["campaigns"] === true,
      campaign_reports: f["campaign_reports"] === true || f["campaigns"] === true,
      follow_up: f["follow_up"] === true,
      whatsapp: whatsappActive,
      hivemind: f["hivemind"] === true,
      growthmind: f["growthmind"] === true,
      systemmind: f["systemmind"] === true,
      accountsmind: f["accountsmind"] === true,
      reseller: f["reseller_client_accounts"] === true,
    };
    cache.set(workspaceId, { at: Date.now(), caps });
    return caps;
  } catch (err: any) {
    console.warn("[notify-caps] capability resolution failed (failing open):", err?.message ?? err);
    return ALL_ON;
  }
}

/** Catalogue event keys applicable to the given capabilities. */
export function applicableEventKeys(
  caps: WorkspaceNotificationCapabilities,
): NotificationEventKey[] {
  return NOTIFICATION_EVENT_KEYS.filter(
    (k) => caps[NOTIFICATION_EVENT_DEFS[k].capability] === true,
  );
}

export function invalidateNotificationCapabilitiesCache(workspaceId?: string): void {
  if (workspaceId) cache.delete(workspaceId);
  else cache.clear();
}
