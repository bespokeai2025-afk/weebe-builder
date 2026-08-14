/**
 * Personal (per-user) notification preferences.
 *
 * Workspace notification settings (workspace_notification_settings) are
 * workspace-wide policy; this layer lets an individual member mute specific
 * NON-CRITICAL events for themselves. Muting affects only that user's
 * in-app rows and member emails — workspace policy, custom-email recipients
 * and the executive event mirror are untouched.
 *
 * Delivery integration is best-effort and FAILS OPEN: a prefs lookup error
 * must never drop a notification for anyone.
 */
// Relative imports ONLY — this module is reachable from the vite-config
// plugin chain (notification-engine.shared → campaign-scheduler.plugin),
// where "@/" aliases cannot resolve.
import { supabaseAdmin } from "../../integrations/supabase/client.server";
import {
  NOTIFICATION_EVENT_KEYS,
  severityForEvent,
  type NotificationEventKey,
} from "./notification-engine.shared";

const sb = supabaseAdmin as any;

export interface UserNotificationPrefs {
  workspaceId: string;
  userId: string;
  mutedEventKeys: NotificationEventKey[];
  updatedAt: string | null;
}

const VALID_KEYS = new Set<string>(NOTIFICATION_EVENT_KEYS);

/** Events that can never be muted personally (critical severity). */
export function isMutableEventKey(key: string): boolean {
  return VALID_KEYS.has(key) && severityForEvent(key) !== "critical";
}

function sanitizeMuted(raw: unknown): NotificationEventKey[] {
  if (!Array.isArray(raw)) return [];
  const out: NotificationEventKey[] = [];
  for (const k of raw) {
    if (typeof k === "string" && VALID_KEYS.has(k) && !out.includes(k as NotificationEventKey)) {
      out.push(k as NotificationEventKey);
    }
  }
  return out;
}

/** Read a user's prefs. Missing row → empty prefs (nothing muted). */
export async function getUserNotificationPrefsCore(
  workspaceId: string,
  userId: string,
): Promise<UserNotificationPrefs> {
  const { data, error } = await sb
    .from("workspace_user_notification_prefs")
    .select("muted_event_keys, updated_at")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load notification preferences: ${error.message}`);
  return {
    workspaceId,
    userId,
    mutedEventKeys: sanitizeMuted(data?.muted_event_keys),
    updatedAt: data?.updated_at ?? null,
  };
}

/**
 * Replace a user's muted event set. Rejects unknown keys and critical
 * events explicitly (never silently drops caller input).
 */
export async function updateUserNotificationPrefsCore(
  workspaceId: string,
  userId: string,
  mutedEventKeys: unknown,
): Promise<UserNotificationPrefs> {
  if (!Array.isArray(mutedEventKeys)) throw new Error("muted_event_keys must be an array of event keys");
  if (mutedEventKeys.length > 200) throw new Error("Too many event keys");
  const cleaned: NotificationEventKey[] = [];
  for (const k of mutedEventKeys) {
    if (typeof k !== "string" || !VALID_KEYS.has(k)) throw new Error(`Unknown notification event key: ${String(k).slice(0, 100)}`);
    if (!isMutableEventKey(k)) throw new Error(`Critical events cannot be muted: ${k}`);
    if (!cleaned.includes(k as NotificationEventKey)) cleaned.push(k as NotificationEventKey);
  }
  const { error } = await sb
    .from("workspace_user_notification_prefs")
    .upsert(
      {
        workspace_id: workspaceId,
        user_id: userId,
        muted_event_keys: cleaned,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id,user_id" },
    );
  if (error) throw new Error(`Failed to save notification preferences: ${error.message}`);
  return { workspaceId, userId, mutedEventKeys: cleaned, updatedAt: new Date().toISOString() };
}

/**
 * Delivery-time filter: which of these member userIds have muted eventKey.
 * FAIL OPEN — on any error return an empty set (deliver to everyone).
 * Critical events are never mutable, so callers can skip the lookup for them.
 */
export async function getMutedUserIds(
  workspaceId: string,
  eventKey: string,
  userIds: string[],
): Promise<Set<string>> {
  try {
    if (!userIds.length) return new Set();
    if (!isMutableEventKey(eventKey)) return new Set();
    const { data, error } = await sb
      .from("workspace_user_notification_prefs")
      .select("user_id, muted_event_keys")
      .eq("workspace_id", workspaceId)
      .in("user_id", userIds)
      .contains("muted_event_keys", JSON.stringify([eventKey]));
    if (error) {
      console.warn("[notify-prefs] mute lookup failed (failing open):", error.message);
      return new Set();
    }
    return new Set((data ?? []).map((r: any) => String(r.user_id)));
  } catch (err: any) {
    console.warn("[notify-prefs] mute lookup failed (failing open):", err?.message ?? err);
    return new Set();
  }
}
