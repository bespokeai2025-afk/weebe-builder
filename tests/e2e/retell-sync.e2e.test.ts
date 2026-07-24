/**
 * E2E tests for the Retell deployment sync, extraction & webhook layer.
 *
 * Covers: the pure six-state sync diff, config normalization + stable hashing,
 * extraction-schema building from approved variables and read-back compare,
 * webhook dedup keys, replay detection, retry backoff, real-DB ledger dedup
 * (23505 unique violation → duplicate), webhook config ensure/rotate, and
 * workspace isolation of sync status reads.
 *
 * NEVER calls the live Retell API — status tests use agents WITHOUT a deployed
 * Retell id so the live fetch path is skipped.
 *
 * Runs against the REAL shared Supabase database (service role) using
 * throw-away workspaces, and cleans up everything it creates.
 *
 * Run: npx vitest run --config vitest.e2e.config.ts tests/e2e/retell-sync.e2e.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  stableStringify,
  hashRetellConfig,
  normalizeRetellAgentForCompare,
  computeSyncState,
  buildExtractionSchema,
  compareExtractionSchemas,
  localConfigHashForAgent,
  diffRetellConfigs,
  getRetellSyncStatusServer,
} from "@/lib/systemmind/retell-sync.server";
import {
  computeWebhookDedupKey,
  isReplayedEvent,
  nextRetryDelayMs,
  claimWebhookDelivery,
  markWebhookProcessed,
  markWebhookFailed,
  ensureWebhookConfig,
  rotateWebhookSecret,
  getWebhookHealthServer,
  WEBHOOK_MAX_ATTEMPTS,
} from "@/lib/retell/retell-webhook-management.server";

const sb = supabaseAdmin as any;
const WS = randomUUID();
const OTHER_WS = randomUUID();
let OWNER = "";
let AGENT_LOCAL = ""; // has flow_data, no deployed retell id
let AGENT_OTHER = ""; // agent in OTHER_WS

beforeAll(async () => {
  const { data: anyWs } = await sb.from("workspaces").select("owner_id").limit(1).single();
  OWNER = anyWs.owner_id as string;
  for (const [id, name] of [
    [WS, "e2e retell-sync ws"],
    [OTHER_WS, "e2e retell-sync other ws"],
  ]) {
    const { error } = await sb.from("workspaces").insert({
      id, name, owner_id: OWNER, slug: `e2e-rsync-${(id as string).slice(0, 8)}`,
    });
    if (error) throw new Error(`workspace fixture: ${error.message}`);
  }
  const mk = async (ws: string, name: string) => {
    const { data, error } = await sb
      .from("agents")
      .insert({
        workspace_id: ws, user_id: OWNER, name,
        flow_data: { nodes: [{ id: "n1" }], edges: [] },
        settings: {},
      })
      .select("id")
      .single();
    if (error) throw new Error(`agent fixture: ${error.message}`);
    return data.id as string;
  };
  AGENT_LOCAL = await mk(WS, "e2e rsync local agent");
  AGENT_OTHER = await mk(OTHER_WS, "e2e rsync other agent");
});

afterAll(async () => {
  for (const ws of [WS, OTHER_WS]) {
    await sb.from("retell_webhook_processing").delete().eq("workspace_id", ws);
    await sb.from("retell_webhook_config").delete().eq("workspace_id", ws);
    await sb.from("retell_deployment_state").delete().eq("workspace_id", ws);
    await sb.from("agents").delete().eq("workspace_id", ws);
    await sb.from("workspaces").delete().eq("id", ws);
  }
});

// ── Pure: stable hashing + normalization ─────────────────────────────────────

describe("stableStringify / hashRetellConfig", () => {
  it("is key-order independent", () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(stableStringify({ a: { c: 3, d: 2 }, b: 1 }));
    expect(hashRetellConfig({ x: [1, 2], y: "z" })).toBe(hashRetellConfig({ y: "z", x: [1, 2] }));
  });
  it("is array-order sensitive", () => {
    expect(hashRetellConfig({ x: [1, 2] })).not.toBe(hashRetellConfig({ x: [2, 1] }));
  });
});

describe("normalizeRetellAgentForCompare", () => {
  it("keeps only builder-owned keys and drops Retell metadata", () => {
    const n = normalizeRetellAgentForCompare(
      { agent_name: "A", voice_id: "v1", last_modification_timestamp: 123, version: 7 } as any,
      { global_prompt: "p", nodes: [{ id: "n1", display_position: { x: 1, y: 2 } }], version: 3 } as any,
    );
    expect(n.agent).toEqual({ agent_name: "A", voice_id: "v1" });
    const cf = n.conversationFlow as any;
    expect(cf.global_prompt).toBe("p");
    expect(cf.version).toBeUndefined();
    expect(cf.nodes[0].display_position).toBeUndefined();
  });
  it("display-position churn does not change the hash", () => {
    const a = { agent_name: "A" };
    const h1 = hashRetellConfig(normalizeRetellAgentForCompare(a, { nodes: [{ id: "n1", display_position: { x: 1 } }] } as any));
    const h2 = hashRetellConfig(normalizeRetellAgentForCompare(a, { nodes: [{ id: "n1", display_position: { x: 99 } }] } as any));
    expect(h1).toBe(h2);
  });
});

// ── Pure: six-state diff ──────────────────────────────────────────────────────

describe("computeSyncState — six states", () => {
  const base = {
    credentialsOk: true, hasDeployedAgentId: true, lastDeployFailed: false,
    localHash: "L", lastDeployedHash: "L", liveHash: "R", lastLiveHash: "R",
  };
  it("credentials_missing wins over everything", () => {
    expect(computeSyncState({ ...base, credentialsOk: false, lastDeployFailed: true })).toBe("credentials_missing");
  });
  it("failed when last deploy failed", () => {
    expect(computeSyncState({ ...base, lastDeployFailed: true })).toBe("failed");
  });
  it("webee_not_deployed when never deployed or never snapshotted", () => {
    expect(computeSyncState({ ...base, hasDeployedAgentId: false })).toBe("webee_not_deployed");
    expect(computeSyncState({ ...base, lastDeployedHash: null })).toBe("webee_not_deployed");
  });
  it("webee_not_deployed when local changed since snapshot", () => {
    expect(computeSyncState({ ...base, localHash: "L2" })).toBe("webee_not_deployed");
  });
  it("retell_not_imported when only live changed", () => {
    expect(computeSyncState({ ...base, liveHash: "R2" })).toBe("retell_not_imported");
  });
  it("conflict when both changed", () => {
    expect(computeSyncState({ ...base, localHash: "L2", liveHash: "R2" })).toBe("conflict");
  });
  it("in_sync when nothing changed", () => {
    expect(computeSyncState(base)).toBe("in_sync");
  });
  it("unreachable live (null) never counts as retell change", () => {
    expect(computeSyncState({ ...base, liveHash: null })).toBe("in_sync");
    expect(computeSyncState({ ...base, liveHash: null, localHash: "L2" })).toBe("webee_not_deployed");
  });
});

// ── Pure: field-level diff directionality ─────────────────────────────────────

describe("diffRetellConfigs — directional labels", () => {
  it("labels top-level additions/removals by side correctly", () => {
    const diffs = diffRetellConfigs({ onlySnap: 1, same: "x" }, { onlyLive: 2, same: "x" });
    expect(diffs).toEqual(
      expect.arrayContaining([
        { path: "onlySnap", changed: "snapshot_only" },
        { path: "onlyLive", changed: "live_only" },
      ]),
    );
    expect(diffs.length).toBe(2);
  });
  it("keeps directional labels at NESTED paths (regression: recursion arg-order)", () => {
    const diffs = diffRetellConfigs(
      { agent: { voice_id: "v1", snapOnly: true }, conversationFlow: { global_prompt: "a" } },
      { agent: { voice_id: "v2", liveOnly: true }, conversationFlow: { global_prompt: "a" } },
    );
    expect(diffs).toEqual(
      expect.arrayContaining([
        { path: "agent.voice_id", changed: "different" },
        { path: "agent.snapOnly", changed: "snapshot_only" },
        { path: "agent.liveOnly", changed: "live_only" },
      ]),
    );
    expect(diffs.length).toBe(3);
  });
  it("skips secret-looking keys and returns empty for identical configs", () => {
    expect(diffRetellConfigs({ api_key: "a" }, { api_key: "b" })).toEqual([]);
    expect(diffRetellConfigs({ a: { b: 1 } }, { a: { b: 1 } })).toEqual([]);
  });
});

// ── Pure: extraction schema ───────────────────────────────────────────────────

describe("buildExtractionSchema", () => {
  it("includes only approved/edited Retell→WEBEE variables, deduped", () => {
    const fields = buildExtractionSchema([
      { name: "budget", status: "approved", direction: "retell_to_webee", data_type: "currency" },
      { name: "budget", status: "approved", direction: "retell_to_webee" }, // dup
      { name: "notes", status: "draft", direction: "retell_to_webee" }, // wrong status
      { name: "city", status: "edited", direction: "webee_to_retell" }, // wrong direction
      { name: "intent", status: "edited", direction: "bidirectional", data_type: "single_select", example_value: "buy", default_value: "browse" },
      { name: "", status: "approved", direction: "retell_to_webee" }, // empty name
      { name: "callback", status: "approved", direction: "retell_to_crm_via_webee", data_type: "boolean", description: "Wants callback" },
    ]);
    expect(fields.map((f) => f.name)).toEqual(["budget", "intent", "callback"]);
    expect(fields[0].type).toBe("number");
    expect(fields[1].type).toBe("enum");
    expect(fields[1].choices).toEqual(["buy", "browse"]);
    expect(fields[2].type).toBe("boolean");
    expect(fields[2].description).toBe("Wants callback");
  });
  it("enum without choices degrades to string", () => {
    const [f] = buildExtractionSchema([
      { name: "pick", status: "approved", direction: "retell_to_webee", data_type: "single_select" },
    ]);
    expect(f.type).toBe("string");
  });
});

describe("compareExtractionSchemas (read-back verification)", () => {
  const sent = buildExtractionSchema([
    { name: "budget", status: "approved", direction: "retell_to_webee", data_type: "number" },
    { name: "intent", status: "approved", direction: "retell_to_webee", data_type: "single_select", example_value: "a", default_value: "b" },
  ]);
  it("verifies when live matches", () => {
    expect(compareExtractionSchemas(sent, [
      { name: "budget", type: "number" },
      { name: "intent", type: "enum", choices: ["a", "b"] },
    ])).toEqual([]);
  });
  it("flags missing, type-drifted and choice-drifted fields", () => {
    expect(compareExtractionSchemas(sent, [{ name: "budget", type: "string" }])).toEqual(["budget", "intent"]);
    expect(compareExtractionSchemas(sent, [
      { name: "budget", type: "number" },
      { name: "intent", type: "enum", choices: ["a"] },
    ])).toEqual(["intent"]);
  });
});

// ── Pure: webhook helpers ─────────────────────────────────────────────────────

describe("webhook pure helpers", () => {
  it("dedup key is stable for identical deliveries, distinct otherwise", () => {
    const k1 = computeWebhookDedupKey("call_ended", "c1", '{"a":1}');
    expect(computeWebhookDedupKey("call_ended", "c1", '{"a":1}')).toBe(k1);
    expect(computeWebhookDedupKey("call_started", "c1", '{"a":1}')).not.toBe(k1);
    expect(computeWebhookDedupKey("call_ended", "c2", '{"a":1}')).not.toBe(k1);
    expect(computeWebhookDedupKey("call_ended", "c1", '{"a":2}')).not.toBe(k1);
  });
  it("replay detection respects window and allows missing timestamps", () => {
    const now = Date.now();
    expect(isReplayedEvent({ call: { end_timestamp: now - 10_000 } }, 300, now)).toBe(false);
    expect(isReplayedEvent({ call: { end_timestamp: now - 301_000 } }, 300, now)).toBe(true);
    expect(isReplayedEvent({ call: { start_timestamp: now - 400_000 } }, 300, now)).toBe(true);
    expect(isReplayedEvent({}, 300, now)).toBe(false);
  });
  it("retry backoff is exponential and capped at 6h", () => {
    expect(nextRetryDelayMs(1)).toBe(60_000);
    expect(nextRetryDelayMs(2)).toBe(240_000);
    expect(nextRetryDelayMs(3)).toBe(960_000);
    expect(nextRetryDelayMs(10)).toBe(6 * 3600_000);
  });
});

// ── DB: ledger dedup + lifecycle ──────────────────────────────────────────────

describe("claimWebhookDelivery (real DB)", () => {
  const callId = `e2e_call_${randomUUID().slice(0, 8)}`;
  const rawBody = JSON.stringify({ event: "call_ended", call: { call_id: callId, end_timestamp: Date.now() } });
  const payload = JSON.parse(rawBody);

  it("first claim processes, exact re-delivery is a duplicate", async () => {
    const first = await claimWebhookDelivery({ workspaceId: WS, eventType: "call_ended", callId, rawBody, payload });
    expect(first.action).toBe("process");
    expect((first as any).ledgerId).toBeTruthy();
    const again = await claimWebhookDelivery({ workspaceId: WS, eventType: "call_ended", callId, rawBody, payload });
    expect(again.action).toBe("duplicate");
  });

  it("different event type on the same call is NOT a duplicate", async () => {
    const r = await claimWebhookDelivery({ workspaceId: WS, eventType: "call_analyzed", callId, rawBody, payload });
    expect(r.action).toBe("process");
  });

  it("rejects replayed events beyond the 24h window", async () => {
    const old = { event: "call_ended", call: { call_id: callId, end_timestamp: Date.now() - 25 * 3600_000 } };
    const r = await claimWebhookDelivery({
      workspaceId: WS, eventType: "call_ended", callId, rawBody: JSON.stringify(old), payload: old,
    });
    expect(r.action).toBe("replay");
  });

  it("processed/failed lifecycle updates the ledger row", async () => {
    const body = JSON.stringify({ event: "call_started", call: { call_id: `${callId}_b`, start_timestamp: Date.now() } });
    const c = await claimWebhookDelivery({
      workspaceId: WS, eventType: "call_started", callId: `${callId}_b`, rawBody: body, payload: JSON.parse(body),
    });
    expect(c.action).toBe("process");
    const id = (c as any).ledgerId as string;
    await markWebhookFailed(id, WS, "boom");
    let { data: row } = await sb.from("retell_webhook_processing").select("status, attempts, last_error, next_retry_at").eq("id", id).single();
    expect(row.status === "error" || row.status === "failed").toBe(true);
    expect(row.attempts).toBeGreaterThanOrEqual(1);
    expect(String(row.last_error)).toContain("boom");
    await markWebhookProcessed(id, WS);
    ({ data: row } = await sb.from("retell_webhook_processing").select("status, last_error").eq("id", id).single());
    expect(row.status).toBe("processed");
    expect(row.last_error).toBeNull();
    expect(WEBHOOK_MAX_ATTEMPTS).toBeGreaterThan(1);
  });
});

// ── DB: webhook config + health ───────────────────────────────────────────────

describe("webhook config + health", () => {
  it("ensureWebhookConfig is idempotent; rotate returns only a masked secret", async () => {
    await ensureWebhookConfig(WS);
    await ensureWebhookConfig(WS);
    const { data: rows } = await sb.from("retell_webhook_config").select("secret").eq("workspace_id", WS);
    expect(rows.length).toBe(1);
    const before = rows[0].secret as string;
    const rotated = await rotateWebhookSecret(WS);
    expect(rotated.masked).toMatch(/^whsec_.{4}…/);
    expect(rotated.masked.length).toBeLessThan(20);
    const { data: after } = await sb.from("retell_webhook_config").select("secret").eq("workspace_id", WS).single();
    expect(after.secret).not.toBe(before);
    expect(rotated.masked).not.toContain(after.secret);
  });

  it("health reflects this workspace's ledger only", async () => {
    // Seed one failed ledger row so the health counts have something to find.
    const body = JSON.stringify({ event: "call_ended", call: { call_id: "e2e_health", end_timestamp: Date.now() } });
    const c = await claimWebhookDelivery({
      workspaceId: WS, eventType: "call_ended", callId: "e2e_health", rawBody: body, payload: JSON.parse(body),
    });
    if (c.action === "process" && c.ledgerId) await markWebhookFailed(c.ledgerId, WS, "health seed");
    const health = await getWebhookHealthServer(WS);
    expect(health.counts7d.failed).toBeGreaterThanOrEqual(1);
    expect(health.retryable.length).toBeGreaterThanOrEqual(1);
    expect(health.config.lastFailureAt).toBeTruthy();
    const otherHealth = await getWebhookHealthServer(OTHER_WS);
    expect(otherHealth.counts7d.total).toBe(0);
    expect(otherHealth.counts7d.failed).toBe(0);
    expect(otherHealth.retryable.length).toBe(0);
  });
});

// ── DB: sync status + workspace isolation ────────────────────────────────────

describe("getRetellSyncStatusServer", () => {
  it("undeployed agent reports webee_not_deployed and persists a state row", async () => {
    const s = await getRetellSyncStatusServer(WS, AGENT_LOCAL);
    expect(s.state).toBe("webee_not_deployed");
    expect(s.retellAgentId).toBeNull();
    expect(s.evidence.localHash).toBeTruthy();
    const { data: row } = await sb.from("retell_deployment_state").select("workspace_id").eq("agent_id", AGENT_LOCAL).single();
    expect(row.workspace_id).toBe(WS);
  });

  it("rejects cross-workspace reads (isolation)", async () => {
    await expect(getRetellSyncStatusServer(WS, AGENT_OTHER)).rejects.toThrow(/not found/i);
    await expect(getRetellSyncStatusServer(OTHER_WS, AGENT_LOCAL)).rejects.toThrow(/not found/i);
  });

  it("localConfigHashForAgent ignores deploy bookkeeping keys", () => {
    const base = { id: "x", workspace_id: WS, name: "a", retell_agent_id: null, retell_conversation_flow_id: null, flow_data: { nodes: [1] }, settings: { voice: "v" } } as any;
    const withBookkeeping = { ...base, settings: { voice: "v", deployedRetellAgentId: "agent_1", lastDeployedAt: "t" } };
    expect(localConfigHashForAgent(base)).toBe(localConfigHashForAgent(withBookkeeping));
    const changed = { ...base, settings: { voice: "v2" } };
    expect(localConfigHashForAgent(base)).not.toBe(localConfigHashForAgent(changed));
  });
});
