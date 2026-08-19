/**
 * Task #578 acceptance sweep — run manually against the live dev DB:
 *   npx vitest run --config vitest.component.config.ts scripts/acceptance-578-sweep.test.ts
 *
 * NOT part of the component suite (lives outside tests/component).
 *
 * Checks, across ≥3 capability-diverse workspaces:
 *  1. Only capability-relevant notification categories are applicable.
 *  2. Provisioning is insert-only: running it never changes existing rows,
 *     and inserts only applicable catalogue events that were missing.
 */
import { describe, it, expect } from "vitest";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  getWorkspaceNotificationCapabilities,
  applicableEventKeys,
  invalidateNotificationCapabilitiesCache,
} from "@/lib/notifications/notification-capabilities.server";
import { provisionWorkspaceNotifications } from "@/lib/notifications/notification-provisioning.server";
import { NOTIFICATION_EVENT_DEFS, NOTIFICATION_EVENT_KEYS } from "@/lib/notifications/notification-engine.shared";

const sb = supabaseAdmin as any;

async function pickDiverseWorkspaces(): Promise<Array<{ id: string; name: string }>> {
  const { data: subs } = await sb
    .from("workspace_subscriptions")
    .select("workspace_id, package_key")
    .limit(200);
  const byPackage = new Map<string, string>();
  for (const s of subs ?? []) {
    if (!byPackage.has(s.package_key)) byPackage.set(s.package_key, s.workspace_id);
  }
  const ids = [...new Set([...byPackage.values()])].slice(0, 5);
  const { data: ws } = await sb.from("workspaces").select("id, name").in("id", ids);
  return (ws ?? []) as any[];
}

describe("578 acceptance sweep (live DB)", () => {
  it("capability-diverse workspaces expose only relevant categories; provisioning is insert-only", async () => {
    const workspaces = await pickDiverseWorkspaces();
    expect(workspaces.length).toBeGreaterThanOrEqual(3);
    const catalogue = new Set<string>(NOTIFICATION_EVENT_KEYS);
    const signatures = new Set<string>();

    for (const w of workspaces) {
      invalidateNotificationCapabilitiesCache(w.id);
      const caps = await getWorkspaceNotificationCapabilities(w.id);
      const applicable = applicableEventKeys(caps);
      signatures.add(JSON.stringify(caps));

      // 1. Applicability honesty: every applicable event's capability is on.
      for (const k of applicable) {
        expect(caps[NOTIFICATION_EVENT_DEFS[k].capability]).toBe(true);
      }
      // Inapplicable events are excluded.
      for (const k of NOTIFICATION_EVENT_KEYS) {
        if (caps[NOTIFICATION_EVENT_DEFS[k].capability] !== true) {
          expect(applicable).not.toContain(k);
        }
      }

      // 2. Insert-only provisioning: snapshot, provision, compare.
      const before = await sb
        .from("workspace_notification_settings")
        .select("event_key, enabled, email_enabled, in_app_enabled, frequency, recipients, lead_filter")
        .eq("workspace_id", w.id);
      const beforeMap = new Map<string, string>(
        ((before.data ?? []) as any[]).map((r) => [r.event_key, JSON.stringify(r)]),
      );

      await provisionWorkspaceNotifications(w.id, "acceptance_sweep_578");

      const after = await sb
        .from("workspace_notification_settings")
        .select("event_key, enabled, email_enabled, in_app_enabled, frequency, recipients, lead_filter")
        .eq("workspace_id", w.id);
      const afterRows = (after.data ?? []) as any[];

      // Existing rows byte-identical (never overwritten).
      for (const r of afterRows) {
        const prev = beforeMap.get(r.event_key);
        if (prev !== undefined) expect(JSON.stringify(r)).toBe(prev);
      }
      // Inserted rows are only applicable catalogue events.
      const applicableSet = new Set(applicable);
      const inserted = afterRows.filter((r) => !beforeMap.has(r.event_key));
      for (const r of inserted) {
        expect(catalogue.has(r.event_key)).toBe(true);
        expect(applicableSet.has(r.event_key)).toBe(true);
      }
      // Second run is a no-op (idempotent).
      await provisionWorkspaceNotifications(w.id, "acceptance_sweep_578_rerun");
      const { count } = await sb
        .from("workspace_notification_settings")
        .select("event_key", { count: "exact", head: true })
        .eq("workspace_id", w.id);
      expect(count).toBe(afterRows.length);

      console.log(
        `[sweep] ${w.name} (${w.id}): caps=${Object.entries(caps).filter(([, v]) => v).map(([k]) => k).join(",")} applicable=${applicable.length} inserted=${inserted.length}`,
      );
    }

    // Diversity: at least 2 distinct capability signatures across the set.
    expect(signatures.size).toBeGreaterThanOrEqual(2);
  }, 120_000);
});
