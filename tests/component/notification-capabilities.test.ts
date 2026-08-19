/**
 * Capability resolver fail-open semantics — a broken/indeterminate dependency
 * must NEVER hide notification settings (display filtering + provisioning
 * both derive from this resolver).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const entMock = vi.fn();
vi.mock("@/lib/packages/entitlements.server", () => ({
  getWorkspaceEntitlements: (...a: any[]) => entMock(...a),
}));

// Minimal supabase admin stub: workspace_settings + whatsapp_messages probes.
const settingsResult = { data: null as any, error: null as any };
const waCountResult = { count: 0 as number | null, error: null as any };
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => settingsResult,
          limit: async () => waCountResult,
        }),
      }),
    }),
  },
}));

import {
  getWorkspaceNotificationCapabilities,
  applicableEventKeys,
  invalidateNotificationCapabilitiesCache,
} from "@/lib/notifications/notification-capabilities.server";
import { NOTIFICATION_EVENT_KEYS } from "@/lib/notifications/notification-engine.shared";

const WS = "00000000-0000-0000-0000-000000000001";

function feats(overrides: Record<string, boolean>) {
  return { features: overrides };
}

beforeEach(() => {
  invalidateNotificationCapabilitiesCache();
  entMock.mockReset();
  settingsResult.data = null;
  settingsResult.error = null;
  waCountResult.count = 0;
  waCountResult.error = null;
});

describe("notification capability resolver fail-open", () => {
  it("entitlements throwing → all capabilities on (full catalogue visible)", async () => {
    entMock.mockRejectedValue(new Error("boom"));
    const caps = await getWorkspaceNotificationCapabilities(WS);
    expect(Object.values(caps).every((v) => v === true)).toBe(true);
    expect(applicableEventKeys(caps).length).toBe(NOTIFICATION_EVENT_KEYS.length);
  });

  it("noEntitlements shape (all features false) → indeterminate → all on, uncached", async () => {
    entMock.mockResolvedValue(feats({ leads: false, campaigns: false }));
    const caps = await getWorkspaceNotificationCapabilities(WS);
    expect(Object.values(caps).every((v) => v === true)).toBe(true);
    // Not cached: a healthy lookup afterwards resolves real capabilities.
    entMock.mockResolvedValue(feats({ leads: true, campaigns: false }));
    const caps2 = await getWorkspaceNotificationCapabilities(WS);
    expect(caps2.leads).toBe(true);
    expect(caps2.campaigns).toBe(false);
  });

  it("healthy lookup gates by features; core always on", async () => {
    entMock.mockResolvedValue(feats({ leads: true, whatsapp: false, hivemind: true }));
    const caps = await getWorkspaceNotificationCapabilities(WS);
    expect(caps.core).toBe(true);
    expect(caps.leads).toBe(true);
    expect(caps.whatsapp).toBe(false);
    expect(caps.hivemind).toBe(true);
    const keys = applicableEventKeys(caps);
    expect(keys).toContain("lead_created");
    expect(keys).toContain("needs_admin_attention");
    expect(keys).not.toContain("whatsapp_reply_received");
  });

  it("whatsapp entitled + settings probe error → capability fails open", async () => {
    entMock.mockResolvedValue(feats({ whatsapp: true, leads: true }));
    settingsResult.error = { message: "timeout" };
    const caps = await getWorkspaceNotificationCapabilities(WS);
    expect(caps.whatsapp).toBe(true);
  });

  it("whatsapp entitled, unconfigured, message-probe error → fails open", async () => {
    entMock.mockResolvedValue(feats({ whatsapp: true, leads: true }));
    waCountResult.error = { message: "timeout" };
    waCountResult.count = null;
    const caps = await getWorkspaceNotificationCapabilities(WS);
    expect(caps.whatsapp).toBe(true);
  });

  it("whatsapp entitled, unconfigured, no messages → capability off", async () => {
    entMock.mockResolvedValue(feats({ whatsapp: true, leads: true }));
    const caps = await getWorkspaceNotificationCapabilities(WS);
    expect(caps.whatsapp).toBe(false);
  });
});
