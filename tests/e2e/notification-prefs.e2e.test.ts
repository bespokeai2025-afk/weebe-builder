/**
 * E2E tests for notification preferences expansion & package defaults (Task #371).
 *
 * Runs against the REAL shared Supabase database (service role) using
 * throw-away random workspaces, and cleans up everything it creates.
 * No emails are ever sent: caps tests use packages without email, and the
 * emit test asserts DB rows only (in-app channel).
 *
 * Run: npx vitest run --config vitest.e2e.config.ts tests/e2e/notification-prefs.e2e.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  NOTIFICATION_EVENT_KEYS,
  emitCampaignNotification,
  loadNotificationCaps,
  clampSettingsToCaps,
} from "@/lib/notifications/notification-engine.shared";
import {
  notificationCapsForPackage,
  notificationDefaultsForPackage,
} from "@/lib/packages/packages.shared";
import { seedNotificationDefaults } from "@/lib/packages/entitlements.server";

const sb = supabaseAdmin as any;
const WS = randomUUID();
let ownerUserId: string;

beforeAll(async () => {
  const { data: profiles, error: pErr } = await sb
    .from("profiles")
    .select("user_id")
    .limit(1);
  if (pErr) throw new Error(pErr.message);
  if (!profiles?.length) throw new Error("Need an existing user");
  ownerUserId = profiles[0].user_id;

  const { error } = await sb.from("workspaces").insert({
    id: WS,
    name: "E2E notif prefs (safe to delete)",
    slug: `e2e-notif-${WS.slice(0, 8)}`,
    owner_id: ownerUserId,
  });
  if (error) throw new Error(error.message);
  const { error: mErr } = await sb
    .from("workspace_members")
    .insert({ workspace_id: WS, user_id: ownerUserId, role: "owner" });
  if (mErr) throw new Error(mErr.message);
});

afterAll(async () => {
  await sb.from("workspace_notifications").delete().eq("workspace_id", WS);
  await sb.from("workspace_notification_settings").delete().eq("workspace_id", WS);
  await sb.from("workspace_subscriptions").delete().eq("workspace_id", WS);
  await sb.from("workspace_members").delete().eq("workspace_id", WS);
  await sb.from("workspaces").delete().eq("id", WS);
});

describe("package caps", () => {
  it("fail closed for unknown/missing package", () => {
    const caps = notificationCapsForPackage("nonexistent_package");
    expect(caps.emailAllowed).toBe(false);
    expect(caps.customRecipientsAllowed).toBe(false);
  });

  it("loadNotificationCaps fails closed with no subscription row", async () => {
    const caps = await loadNotificationCaps(sb, WS);
    expect(caps.emailAllowed).toBe(false);
  });

  it("pro package allows email + custom recipients", () => {
    const caps = notificationCapsForPackage("receptionist_pro");
    expect(caps.emailAllowed).toBe(true);
    expect(caps.customRecipientsAllowed).toBe(true);
  });

  it("clampSettingsToCaps strips email + custom recipients when not allowed", () => {
    const clamped = clampSettingsToCaps(
      {
        enabled: true,
        emailEnabled: true,
        inAppEnabled: true,
        frequency: "immediate",
        recipients: { owner: true, admins: true, userIds: [], roleKeys: [], customEmails: ["x@y.z"], campaignOwner: false },
      } as any,
      { emailAllowed: false, customRecipientsAllowed: false, packageKey: "trial" } as any,
    );
    expect(clamped.emailEnabled).toBe(false);
    expect(clamped.recipients.customEmails).toEqual([]);
  });
});

describe("package default seeding", () => {
  it("seeds defaults without overwriting admin-customised rows", async () => {
    // Pre-existing admin row
    const { error: preErr } = await sb.from("workspace_notification_settings").insert({
      workspace_id: WS,
      event_key: "workflow_error",
      enabled: false,
      email_enabled: false,
      in_app_enabled: false,
      recipients: { owner: true, admins: false, userIds: [], roleKeys: [], customEmails: [], campaignOwner: false },
      frequency: "weekly",
    });
    expect(preErr).toBeNull();

    await seedNotificationDefaults(WS, "receptionist_pro");

    const { data: rows } = await sb
      .from("workspace_notification_settings")
      .select("event_key, enabled, frequency")
      .eq("workspace_id", WS);
    const byKey = new Map((rows ?? []).map((r: any) => [r.event_key, r]));

    // Admin row untouched
    const wf: any = byKey.get("workflow_error");
    expect(wf.enabled).toBe(false);
    expect(wf.frequency).toBe("weekly");

    // Defaults seeded for other events
    const defaults = notificationDefaultsForPackage("receptionist_pro");
    for (const key of Object.keys(defaults)) {
      if (key === "workflow_error") continue;
      expect(byKey.has(key), `expected seeded default for ${key}`).toBe(true);
    }
  });
});

describe("new event catalog + emit", () => {
  it("catalog contains the new event keys", () => {
    for (const k of [
      "workflow_error",
      "qualified_leads_generated",
      "appointments_booked",
      "staff_invite_accepted",
      "systemmind_fix_suggested",
      "reseller_client_created",
      "email_provider_failing",
    ]) {
      expect(NOTIFICATION_EVENT_KEYS as readonly string[]).toContain(k);
    }
  });

  it("emit writes in-app rows and never sends email without caps", async () => {
    await emitCampaignNotification(sb, {
      workspaceId: WS,
      eventKey: "staff_invite_accepted",
      summary: "E2E test emit — safe to delete",
    });
    const { data: notifs } = await sb
      .from("workspace_notifications")
      .select("channel, event_key")
      .eq("workspace_id", WS)
      .eq("event_key", "staff_invite_accepted");
    expect((notifs ?? []).length).toBeGreaterThan(0);
    expect((notifs ?? []).every((n: any) => n.channel === "in_app")).toBe(true);
  });
});
