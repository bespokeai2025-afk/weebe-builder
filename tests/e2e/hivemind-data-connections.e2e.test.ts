/**
 * HiveMind full data connections + freshness tracking (e2e, real DB).
 *
 * Uses throwaway fixture workspaces (real workspaces FK on leads/calendar
 * tables) — created in beforeAll, cascaded away in afterAll. Verifies:
 *   • each new intelligence block returns real shaped data for a seeded workspace
 *   • the data-health layer marks empty/degraded sources honestly
 *   • multi-tenant isolation (workspace B never sees workspace A's data)
 *   • the WBAH split (WBAH never queries the huge leads table)
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  getCalendarIntelligence,
  getEmailIntelligence,
  getOnboardingPipeline,
  getBillingSignals,
} from "@/lib/hivemind/exec-intelligence.server";
import { getWorkspaceDataHealth, invalidateDataHealth } from "@/lib/hivemind/data-health.server";

const sb = supabaseAdmin as any;

const WS_A = randomUUID();
const WS_B = randomUUID();
let ownerUserId: string;
let leadQualifiedId: string;
let leadBookedId: string;

const HOUR = 3_600_000;

beforeAll(async () => {
  const { data: profiles, error } = await sb.from("profiles").select("user_id").limit(1);
  if (error || !profiles?.length) throw new Error("Need an existing user for workspace fixture");
  ownerUserId = profiles[0].user_id;

  for (const id of [WS_A, WS_B]) {
    const { error: wErr } = await sb.from("workspaces").insert({
      id,
      name: `hm-data e2e ${id.slice(0, 8)}`,
      slug: `hm-data-e2e-${id.slice(0, 8)}`,
      owner_id: ownerUserId,
    });
    if (wErr) throw new Error(`fixture workspace insert failed: ${wErr.message}`);
  }

  // Leads: one qualified WITHOUT a booking, one interested WITH a booking.
  const { data: l1, error: l1e } = await sb
    .from("leads")
    .insert({
      workspace_id: WS_A,
      full_name: "E2E Qualified NoBooking",
      phone: "+440000000001",
      status: "qualified",
      source: "website",
    })
    .select("id")
    .single();
  if (l1e) throw new Error(l1e.message);
  leadQualifiedId = l1.id;

  const { data: l2, error: l2e } = await sb
    .from("leads")
    .insert({
      workspace_id: WS_A,
      full_name: "E2E Interested Booked",
      phone: "+440000000002",
      status: "interested",
      source: "website",
    })
    .select("id")
    .single();
  if (l2e) throw new Error(l2e.message);
  leadBookedId = l2.id;

  // Calendar: today's booking (linked to lead 2), two overlapping future
  // bookings (conflict), one pending within 48h, one cancelled.
  const now = Date.now();
  const rows = [
    {
      workspace_id: WS_A, source: "calcom", title: "e2e today", status: "accepted",
      lead_id: leadBookedId,
      start_at: new Date(now + 1 * HOUR).toISOString(),
      end_at: new Date(now + 2 * HOUR).toISOString(),
      external_id: `e2e-today-${WS_A.slice(0, 8)}`,
    },
    {
      workspace_id: WS_A, source: "calcom", title: "e2e overlap A", status: "accepted",
      start_at: new Date(now + 50 * HOUR).toISOString(),
      end_at: new Date(now + 51 * HOUR).toISOString(),
      external_id: `e2e-ovA-${WS_A.slice(0, 8)}`,
    },
    {
      workspace_id: WS_A, source: "calcom", title: "e2e overlap B", status: "accepted",
      start_at: new Date(now + 50.5 * HOUR).toISOString(),
      end_at: new Date(now + 51.5 * HOUR).toISOString(),
      external_id: `e2e-ovB-${WS_A.slice(0, 8)}`,
    },
    {
      workspace_id: WS_A, source: "calcom", title: "e2e pending soon", status: "pending",
      start_at: new Date(now + 24 * HOUR).toISOString(),
      end_at: new Date(now + 25 * HOUR).toISOString(),
      external_id: `e2e-pend-${WS_A.slice(0, 8)}`,
    },
    {
      workspace_id: WS_A, source: "calcom", title: "e2e cancelled", status: "cancelled",
      start_at: new Date(now + 30 * HOUR).toISOString(),
      end_at: new Date(now + 31 * HOUR).toISOString(),
      external_id: `e2e-canc-${WS_A.slice(0, 8)}`,
    },
  ];
  const { error: cbErr } = await sb.from("calendar_bookings").insert(rows);
  if (cbErr) throw new Error(cbErr.message);

  // Email log: one sent, one failed.
  const { error: elErr } = await sb.from("lead_email_log").insert([
    {
      workspace_id: WS_A, lead_id: leadBookedId, to_email: "e2e-ok@example.com",
      status: "sent", trigger: "e2e",
    },
    {
      workspace_id: WS_A, lead_id: leadQualifiedId, to_email: "e2e-fail@example.com",
      status: "failed", error: "550 mailbox unavailable", trigger: "e2e",
    },
  ]);
  if (elErr) throw new Error(elErr.message);

  // WhatsApp: an inbound-last conversation (awaiting reply) and an
  // outbound-only conversation (silent).
  const { error: waErr } = await sb.from("whatsapp_messages").insert([
    { workspace_id: WS_A, contact_phone: "+441111111111", contact_name: "E2E Waiting", direction: "outbound", status: "sent", created_at: new Date(now - 30 * HOUR).toISOString() },
    { workspace_id: WS_A, contact_phone: "+441111111111", contact_name: "E2E Waiting", direction: "inbound", status: "delivered", created_at: new Date(now - 26 * HOUR).toISOString() },
    { workspace_id: WS_A, contact_phone: "+442222222222", contact_name: "E2E Silent", direction: "outbound", status: "sent", created_at: new Date(now - 40 * HOUR).toISOString() },
    { workspace_id: WS_A, contact_phone: "+442222222222", contact_name: "E2E Silent", direction: "outbound", status: "sent", created_at: new Date(now - 20 * HOUR).toISOString() },
  ]);
  if (waErr) throw new Error(waErr.message);

  // Onboarding checklist: incomplete row.
  const { error: obErr } = await sb.from("workspace_onboarding").insert({
    workspace_id: WS_A,
    user_id: ownerUserId,
    completed: false,
    dismissed: false,
    business_dna_done: true,
    knowledge_uploaded: false,
    connections_done: false,
    first_agent_done: false,
    first_campaign_done: false,
    analysis_done: false,
    telephony_done: false,
  });
  if (obErr) throw new Error(obErr.message);

  // Billing: loss-making current month.
  const monthStr = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
    .toISOString()
    .split("T")[0];
  const { error: bpErr } = await sb.from("client_billing_profiles").insert({
    workspace_id: WS_A,
    monthly_charge_cents: 50_000,
    currency: "GBP",
    status: "active",
    billing_cycle: "monthly",
    billing_address: "e2e test",
    included_minutes: 100,
    included_messages: 0,
    included_email_sends: 0,
    included_storage_mb: 0,
    included_video_seconds: 0,
    overage_rates_json: {},
    contract_end_date: new Date(now + 30 * 24 * HOUR).toISOString().split("T")[0],
  });
  if (bpErr) throw new Error(bpErr.message);
  const { error: mcErr } = await sb.from("client_monthly_costs").insert({
    workspace_id: WS_A,
    month: monthStr,
    monthly_charge_cents: 50_000,
    total_cost_cents: 60_000,
    gross_profit_cents: -10_000,
    gross_margin_percent: -20,
    voice_cost_cents: 0, llm_cost_cents: 0, telephony_cost_cents: 0,
    whatsapp_cost_cents: 0, email_cost_cents: 0, image_cost_cents: 0,
    video_cost_cents: 0, storage_cost_cents: 0, infrastructure_cost_cents: 0,
    source_breakdown_json: {},
  });
  if (mcErr) throw new Error(mcErr.message);
});

afterAll(async () => {
  // Some fixture tables lack ON DELETE CASCADE — clean explicitly first.
  for (const table of [
    "lead_email_log",
    "whatsapp_messages",
    "calendar_bookings",
    "workspace_onboarding",
    "client_monthly_costs",
    "client_billing_profiles",
    "leads",
  ]) {
    await sb.from(table).delete().in("workspace_id", [WS_A, WS_B]);
  }
  await sb.from("workspaces").delete().in("id", [WS_A, WS_B]);
});

describe("calendar intelligence", () => {
  it("derives today/upcoming, conflicts, unconfirmed, cancellations and qualified-no-booking", async () => {
    const ci = await getCalendarIntelligence(WS_A, false);
    expect(ci.todayCount + ci.upcoming7d).toBeGreaterThanOrEqual(3);
    expect(ci.cancellations30d).toBe(1);
    expect(ci.conflicts.length).toBeGreaterThanOrEqual(1);
    expect(ci.unconfirmedSoon.length).toBe(1);
    const noBookingIds = ci.qualifiedNoBooking.map((l) => l.id);
    expect(noBookingIds).toContain(leadQualifiedId);
    expect(noBookingIds).not.toContain(leadBookedId);
    expect(ci.avgBookingToApptHours).not.toBeNull();
  });

  it("is workspace-isolated (workspace B sees none of A's data)", async () => {
    const ci = await getCalendarIntelligence(WS_B, false);
    expect(ci.todayCount).toBe(0);
    expect(ci.upcoming7d).toBe(0);
    expect(ci.conflicts.length).toBe(0);
    expect(ci.qualifiedNoBooking.length).toBe(0);
  });
});

describe("email + follow-up intelligence", () => {
  it("reports failures, awaiting-reply and silent conversations for the seeded workspace", async () => {
    const ei = await getEmailIntelligence(WS_A, false);
    expect(ei.emails.sent).toBe(1);
    expect(ei.emails.failed).toBe(1);
    expect(ei.emails.failedSample[0].to).toBe("e2e-fail@example.com");
    expect(ei.conversations.awaitingReplyCount).toBe(1);
    expect(ei.conversations.awaitingReply[0].contact).toBe("+441111111111");
    expect(ei.conversations.awaitingReply[0].waitingHours).toBeGreaterThanOrEqual(25);
    expect(ei.conversations.silentCount).toBe(1);
  });

  it("is workspace-isolated", async () => {
    const ei = await getEmailIntelligence(WS_B, false);
    expect(ei.emails.sent).toBe(0);
    expect(ei.emails.failed).toBe(0);
    expect(ei.conversations.awaitingReplyCount).toBe(0);
    expect(ei.conversations.silentCount).toBe(0);
  });
});

describe("onboarding pipeline", () => {
  it("surfaces incomplete checklists with blocked steps", async () => {
    const ob = await getOnboardingPipeline(WS_A);
    expect(ob.checklists).toBe(1);
    expect(ob.incomplete).toBe(1);
    expect(ob.blockedStepCounts["Knowledge upload"]).toBe(1);
    expect(ob.blockedStepCounts["Business DNA"]).toBeUndefined();
    expect(ob.hasFirstCampaign).toBe(false);
  });
});

describe("billing signals", () => {
  it("flags loss-making and renewal-due clients from real rows", async () => {
    const bs = await getBillingSignals(WS_A);
    expect(bs).not.toBeNull();
    expect(bs!.flags).toContain("loss_making");
    expect(bs!.flags).toContain("renewal_due_soon");
    expect(bs!.plan!.includedMinutes).toBe(100);
    expect(bs!.currentMonth!.grossProfitCents).toBe(-10_000);
  });

  it("returns null (honestly absent) for a workspace with no commercial data", async () => {
    const bs = await getBillingSignals(WS_B);
    expect(bs).toBeNull();
  });
});

describe("data-source health", () => {
  it("returns one row per source with honest empty/healthy statuses", async () => {
    invalidateDataHealth(WS_A, { broadcast: false });
    const dh = await getWorkspaceDataHealth(WS_A, false);
    const names = dh.sources.map((s) => s.source).sort();
    expect(names).toEqual(["billing", "calendar", "calls", "campaigns", "email", "gads", "leads", "whatsapp"].sort());
    const by = Object.fromEntries(dh.sources.map((s) => [s.source, s]));
    expect(by.leads.status).toBe("healthy");
    expect(by.leads.recordsInWindow).toBe(2);
    expect(by.email.recordsInWindow).toBe(2);
    expect(by.whatsapp.recordsInWindow).toBe(4);
    expect(by.calls.status).toBe("empty"); // no calls seeded — must NOT claim healthy
    expect(by.gads.status).toBe("empty");
    expect(by.billing.status).toBe("healthy");
    expect(by.billing.lastActivityAt).not.toBeNull();
  });

  it("caches per workspace and can be invalidated", async () => {
    const first = await getWorkspaceDataHealth(WS_A, false);
    const second = await getWorkspaceDataHealth(WS_A, false);
    expect(second.computedAt).toBe(first.computedAt); // cache hit
    invalidateDataHealth(WS_A, { broadcast: false });
    const third = await getWorkspaceDataHealth(WS_A, false);
    expect(third.computedAt >= first.computedAt).toBe(true);
  });

  it("WBAH mode reads wbah_calls, never the doomed leads table", async () => {
    invalidateDataHealth(WS_B, { broadcast: false });
    const dh = await getWorkspaceDataHealth(WS_B, true);
    expect(dh.isWbah).toBe(true);
    const leadsSrc = dh.sources.find((s) => s.source === "leads")!;
    // Detail must explicitly reference the wbah_calls derivation.
    expect(leadsSrc.detail).toContain("wbah_calls");
    const callsSrc = dh.sources.find((s) => s.source === "calls")!;
    expect(callsSrc.detail).toContain("wbah_calls");
  });
});

describe("WBAH split in intelligence blocks", () => {
  it("calendar intelligence skips the leads join for WBAH", async () => {
    const ci = await getCalendarIntelligence(WS_A, true);
    expect(ci.isWbah).toBe(true);
    // Even though WS_A HAS qualified leads, the WBAH path must not read them.
    expect(ci.qualifiedNoBooking.length).toBe(0);
    expect(ci.avgLeadToBookingHours).toBeNull();
  });
});
