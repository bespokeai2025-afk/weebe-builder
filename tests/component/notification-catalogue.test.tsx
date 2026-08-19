/**
 * Canonical notification catalogue integrity (Task: catalogue + dedup engine).
 *
 * Guards the lockstep invariants:
 *  • every event key has a label AND a catalogue def (category/capability/deepLink)
 *  • no def/label exists for an unknown key
 *  • DEFAULT_OFF_EVENTS only contains NEW catalogue keys (existing keys must
 *    keep their historic default-on behaviour)
 *  • defaultSettingsForEvent honours DEFAULT_OFF_EVENTS without mutating the
 *    shared default object
 *  • every def category appears in NOTIFICATION_CATEGORY_ORDER
 *  • the migration file lists every event key in the DB check constraint
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  NOTIFICATION_EVENT_KEYS,
  NOTIFICATION_EVENT_LABELS,
  NOTIFICATION_EVENT_DEFS,
  NOTIFICATION_CATEGORY_ORDER,
  DEFAULT_OFF_EVENTS,
  DEFAULT_EVENT_SETTINGS,
  defaultSettingsForEvent,
  severityForEvent,
} from "@/lib/notifications/notification-engine.shared";

const LEGACY_KEYS = new Set([
  "launched", "activated", "paused", "completed", "failed", "safety_blocked",
  "no_eligible_leads", "daily_cap_hit", "safety_cap_hit", "provider_error",
  "workflow_error", "kpi_report_ready", "high_negative_sentiment",
  "high_positive_performance", "qualified_leads_generated", "appointments_booked",
  "follow_up_tasks_created", "needs_admin_attention", "staff_invite_accepted",
  "systemmind_fix_suggested", "reseller_client_created", "email_provider_failing",
  "lead_created", "whatsapp_reply_received", "marketing_operator_digest",
]);

describe("notification catalogue integrity", () => {
  it("every event key has a label and a def; no extras", () => {
    for (const k of NOTIFICATION_EVENT_KEYS) {
      expect(NOTIFICATION_EVENT_LABELS[k], `label for ${k}`).toBeTruthy();
      const def = NOTIFICATION_EVENT_DEFS[k];
      expect(def, `def for ${k}`).toBeTruthy();
      expect(def.deepLink.startsWith("/"), `deepLink for ${k}`).toBe(true);
    }
    expect(Object.keys(NOTIFICATION_EVENT_DEFS).sort()).toEqual([...NOTIFICATION_EVENT_KEYS].sort());
    expect(Object.keys(NOTIFICATION_EVENT_LABELS).sort()).toEqual([...NOTIFICATION_EVENT_KEYS].sort());
  });

  it("every def category is in the category order", () => {
    const order = new Set<string>(NOTIFICATION_CATEGORY_ORDER);
    for (const k of NOTIFICATION_EVENT_KEYS) {
      expect(order.has(NOTIFICATION_EVENT_DEFS[k].category), `category for ${k}`).toBe(true);
    }
  });

  it("DEFAULT_OFF_EVENTS never contains legacy keys (no behaviour change)", () => {
    for (const k of DEFAULT_OFF_EVENTS) {
      expect(LEGACY_KEYS.has(k), `${k} must not be a legacy key`).toBe(false);
      expect((NOTIFICATION_EVENT_KEYS as readonly string[]).includes(k), `${k} unknown`).toBe(true);
    }
  });

  it("defaultSettingsForEvent honours default-off without mutating shared defaults", () => {
    const offKey = [...DEFAULT_OFF_EVENTS][0]!;
    const off = defaultSettingsForEvent(offKey);
    expect(off.enabled).toBe(false);
    expect(defaultSettingsForEvent("failed").enabled).toBe(true);
    expect(DEFAULT_EVENT_SETTINGS.enabled).toBe(true); // untouched
    off.recipients.userIds.push("x");
    expect(DEFAULT_EVENT_SETTINGS.recipients.userIds).toEqual([]); // deep clone
  });

  it("new keys have sensible severities", () => {
    expect(severityForEvent("systemmind_workflow_failed")).toBe("critical");
    expect(severityForEvent("report_failed")).toBe("critical");
    expect(severityForEvent("campaign_stalled")).toBe("warning");
    expect(severityForEvent("lead_assigned")).toBe("info");
  });

  it("DB check-constraint migration lists every catalogue key (lockstep)", () => {
    const sql = readFileSync(
      "supabase/migrations/20260922000000_notification_catalogue_dedup.sql",
      "utf8",
    );
    for (const k of NOTIFICATION_EVENT_KEYS) {
      expect(sql.includes(`'${k}'`), `migration missing '${k}'`).toBe(true);
    }
  });
});
