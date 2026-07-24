/**
 * HiveMind executive event backbone (e2e, real DB).
 *
 * Uses a throwaway fixture workspace (hivemind_executive_events has a REAL
 * workspaces FK) — created in beforeAll, cascaded away in afterAll.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  publishExecutiveEvent,
  classifyPendingExecutiveEvents,
  classifyEvent,
} from "@/lib/hivemind/executive-events.shared";
import { claimReconJob } from "@/lib/hivemind/executive-reconciliation.server";

const sb = supabaseAdmin as any;

const WS_A = randomUUID();
const WS_B = randomUUID();
let ownerUserId: string;

beforeAll(async () => {
  const { data: profiles, error } = await sb.from("profiles").select("user_id").limit(1);
  if (error || !profiles?.length) throw new Error("Need an existing user for workspace fixture");
  ownerUserId = profiles[0].user_id;
  for (const id of [WS_A, WS_B]) {
    const { error: wErr } = await sb.from("workspaces").insert({
      id,
      name: `exec-events e2e ${id.slice(0, 8)}`,
      slug: `exec-events-e2e-${id.slice(0, 8)}`,
      owner_id: ownerUserId,
    });
    if (wErr) throw new Error(`fixture workspace insert failed: ${wErr.message}`);
  }
});

afterAll(async () => {
  // FK ON DELETE CASCADE removes events + reconciliation state.
  await sb.from("workspaces").delete().in("id", [WS_A, WS_B]);
});

describe("publishExecutiveEvent", () => {
  it("publishes an event with catalog severity defaults", async () => {
    const res = await publishExecutiveEvent(sb, {
      workspaceId: WS_A,
      eventType: "call_failed",
      sourceSystem: "retell",
      title: "Test call failed",
      entityType: "call",
      entityId: "call_e2e_1",
    });
    expect(res.ok).toBe(true);
    expect(res.deduped).toBe(false);
    const { data } = await sb
      .from("hivemind_executive_events")
      .select("severity, dedup_key, processing_status")
      .eq("id", res.id)
      .single();
    expect(data.severity).toBe("warning"); // catalog default
    expect(data.dedup_key).toBe("call_failed:call:call_e2e_1");
    expect(data.processing_status).toBe("pending");
  });

  it("silently dedupes a second publish with the same dedup key", async () => {
    const dup = await publishExecutiveEvent(sb, {
      workspaceId: WS_A,
      eventType: "call_failed",
      sourceSystem: "retell",
      title: "Test call failed AGAIN",
      entityType: "call",
      entityId: "call_e2e_1",
    });
    expect(dup.ok).toBe(true);
    expect(dup.deduped).toBe(true);
    const { count } = await sb
      .from("hivemind_executive_events")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", WS_A)
      .eq("dedup_key", "call_failed:call:call_e2e_1");
    expect(count).toBe(1);
  });

  it("same dedup key in ANOTHER workspace is a separate event (isolation)", async () => {
    const other = await publishExecutiveEvent(sb, {
      workspaceId: WS_B,
      eventType: "call_failed",
      sourceSystem: "retell",
      title: "Other tenant call failed",
      entityType: "call",
      entityId: "call_e2e_1",
    });
    expect(other.ok).toBe(true);
    expect(other.deduped).toBe(false);
    // And WS_B events never appear in WS_A reads.
    const { data: aRows } = await sb
      .from("hivemind_executive_events")
      .select("id")
      .eq("workspace_id", WS_A);
    const { data: bRows } = await sb
      .from("hivemind_executive_events")
      .select("id")
      .eq("workspace_id", WS_B);
    const aIds = new Set((aRows ?? []).map((r: any) => r.id));
    for (const r of bRows ?? []) expect(aIds.has(r.id)).toBe(false);
  });

  it("never throws on invalid input", async () => {
    const res = await publishExecutiveEvent(sb, {
      workspaceId: "",
      eventType: "call_failed",
      sourceSystem: "retell",
      title: "x",
    });
    expect(res.ok).toBe(false);
  });
});

describe("deterministic classification", () => {
  it("classifyEvent applies catalog rules + severity upgrades", () => {
    expect(classifyEvent("campaign_failed", "critical")).toBe("critical");
    expect(classifyEvent("lead_created", "info")).toBe("briefing");
    expect(classifyEvent("lead_created", "warning")).toBe("warning");
    expect(classifyEvent("lead_stale", "warning")).toBe("task_candidate");
    expect(classifyEvent("unknown_type", "info")).toBe("informational");
    expect(classifyEvent("unknown_type", "critical")).toBe("critical");
  });

  it("classifyPendingExecutiveEvents stamps pending rows", async () => {
    const res = await publishExecutiveEvent(sb, {
      workspaceId: WS_A,
      eventType: "booking_created",
      sourceSystem: "calcom",
      title: "Booked for classification test",
      entityType: "booking",
      entityId: "bk_e2e_classify",
    });
    expect(res.ok).toBe(true);
    const out = await classifyPendingExecutiveEvents(sb, 500);
    expect(out.classified).toBeGreaterThan(0);
    const { data } = await sb
      .from("hivemind_executive_events")
      .select("processing_status, classification")
      .eq("id", res.id)
      .single();
    expect(data.processing_status).toBe("classified");
    expect(data.classification).toBe("briefing");
  });
});

describe("reconciliation jobs against real schema", () => {
  it("missed_appointments detects a passed accepted booking", async () => {
    const { RECON_JOBS_FOR_TEST } = await import("@/lib/hivemind/executive-reconciliation.server");
    const job = RECON_JOBS_FOR_TEST.find((j) => j.key === "missed_appointments")!;
    const { data: booking, error } = await sb
      .from("calendar_bookings")
      .insert({
        workspace_id: WS_A,
        external_id: `e2e-missed-${WS_A.slice(0, 8)}`,
        source: "calcom",
        title: "e2e missed booking",
        start_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        end_at: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
        status: "accepted",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    const detail = await job.run(sb, WS_A);
    expect(Number(detail.missed)).toBeGreaterThan(0);
    const { data: ev } = await sb
      .from("hivemind_executive_events")
      .select("id, event_type")
      .eq("workspace_id", WS_A)
      .eq("event_type", "booking_missed")
      .eq("entity_id", String(booking.id));
    expect(ev?.length).toBe(1);
  });

  it("stale_leads and failed_workflows run without schema errors", async () => {
    const { RECON_JOBS_FOR_TEST } = await import("@/lib/hivemind/executive-reconciliation.server");
    for (const key of ["stale_leads", "failed_workflows", "integration_failures"]) {
      const job = RECON_JOBS_FOR_TEST.find((j) => j.key === key)!;
      await expect(job.run(sb, WS_A)).resolves.toBeTruthy();
    }
  });
});

describe("reconciliation CAS claims", () => {
  it("first claim wins, immediate re-claim loses (cadence)", async () => {
    const first = await claimReconJob(sb, WS_A, "e2e_job", 60 * 60 * 1000);
    expect(first).toBe(true);
    const second = await claimReconJob(sb, WS_A, "e2e_job", 60 * 60 * 1000);
    expect(second).toBe(false);
  });

  it("claim is due again once the interval elapses", async () => {
    // Backdate last_run_at beyond the interval, then reclaim.
    const past = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    await sb
      .from("hivemind_reconciliation_state")
      .update({ last_run_at: past })
      .eq("workspace_id", WS_A)
      .eq("job_key", "e2e_job");
    const again = await claimReconJob(sb, WS_A, "e2e_job", 60 * 60 * 1000);
    expect(again).toBe(true);
  });

  it("claims are workspace-scoped", async () => {
    const other = await claimReconJob(sb, WS_B, "e2e_job", 60 * 60 * 1000);
    expect(other).toBe(true);
  });
});
