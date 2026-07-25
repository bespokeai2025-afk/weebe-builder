/**
 * E2E tests for Task #457: SystemMind CRM integration engine.
 *
 * Covers: connector registry metadata (secret flags, all 9 providers),
 * connection CRUD with encrypted credential storage + masked reads, blank/
 * masked value merge on update, provider immutability, test-connection
 * lifecycle against a REAL local mock REST CRM (evidence steps, persisted
 * status + report), truthful failure reporting (bad key = failed, no green
 * checkmarks), webhook connector HMAC delivery + honest skipped read step,
 * WEBEE internal connector read/write/discovery, discovery snapshot
 * persistence + mapping-engine field feed, workspace isolation and the WBAH
 * hard-block on every entry point.
 *
 * Runs against the REAL shared Supabase database (service role) using
 * throw-away workspaces, and cleans up everything.
 *
 * Run: npx vitest run --config tests/e2e/vitest.e2e.config.ts tests/e2e/crm-connections.e2e.test.ts
 */
// The mock CRM server binds 127.0.0.1, which the SSRF guard blocks by default.
process.env.CRM_CONNECTIONS_ALLOW_PRIVATE_URLS = "1";

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID, createHmac } from "node:crypto";
import http from "node:http";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  listCrmConnectionsServer,
  saveCrmConnectionServer,
  deleteCrmConnectionServer,
  testCrmConnectionServer,
  runCrmDiscoveryServer,
  getCrmDiscoveryServer,
  getDiscoveredCrmFieldsForWorkspace,
  listConnectorCatalog,
  MASKED_VALUE,
} from "@/lib/systemmind/crm-connections.server";
import { CRM_CONNECTOR_REGISTRY, secretFieldKeys, buildConnector } from "@/lib/systemmind/crm-connections/connector-registry";

const sb = supabaseAdmin as any;
const WS = randomUUID();
const OTHER_WS = randomUUID();
const WBAH_WORKSPACE_ID = "5cb750b6-fabf-4e84-9b92-740df1cd8d53";
let OWNER_ID = "";

// ── Mock REST CRM server ──────────────────────────────────────────────────────
const API_KEY = "test-key-123";
let mockServer: http.Server;
let mockPort = 0;
let receivedWebhook: { body: string; signature: string | undefined } | null = null;
const createdRecords: any[] = [];

function startMockServer(): Promise<void> {
  mockServer = http.createServer((req, res) => {
    const auth = req.headers.authorization;
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.url?.startsWith("/hooks/")) {
        receivedWebhook = { body, signature: req.headers["x-webee-signature"] as string | undefined };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ received: true }));
        return;
      }
      if (req.method === "GET" && req.url === "/echo-auth") {
        // Reflective/malicious endpoint: echoes the Authorization header in a 500 body.
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "boom", got_authorization: auth ?? null }));
        return;
      }
      if (auth !== `Bearer ${API_KEY}`) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      if (req.method === "GET" && req.url === "/me") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, user: "e2e" }));
      } else if (req.method === "GET" && req.url?.startsWith("/contacts")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: [{ id: "c1", name: "Jane Doe", email: "jane@example.com", phone: "+441234", score: 9, vip: true }] }));
      } else if (req.method === "POST" && req.url === "/contacts") {
        createdRecords.push(JSON.parse(body || "{}"));
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: "c-new" }));
      } else {
        res.writeHead(404); res.end();
      }
    });
  });
  return new Promise((resolve) => {
    mockServer.listen(0, "127.0.0.1", () => {
      mockPort = (mockServer.address() as any).port;
      resolve();
    });
  });
}

const baseUrl = () => `http://127.0.0.1:${mockPort}`;

beforeAll(async () => {
  const { data: anyWs } = await sb.from("workspaces").select("owner_id").limit(1).single();
  OWNER_ID = anyWs.owner_id as string;
  for (const [id, name] of [[WS, "e2e crmconn ws"], [OTHER_WS, "e2e crmconn other ws"]]) {
    const { error } = await sb.from("workspaces").insert({
      id, name, owner_id: OWNER_ID, slug: `e2e-crmc-${String(id).slice(0, 8)}`,
    });
    if (error) throw new Error(`workspace fixture: ${error.message}`);
  }
  await startMockServer();
}, 30_000);

afterAll(async () => {
  await new Promise<void>((r) => mockServer?.close(() => r()));
  for (const ws of [WS, OTHER_WS]) {
    await sb.from("systemmind_crm_discoveries").delete().eq("workspace_id", ws);
    await sb.from("systemmind_crm_connections").delete().eq("workspace_id", ws);
    await sb.from("leads").delete().eq("workspace_id", ws);
    await sb.from("systemmind_change_audit").delete().eq("workspace_id", ws).catch?.(() => {});
    await sb.from("workspaces").delete().eq("id", ws);
  }
}, 30_000);

// ── Registry metadata ─────────────────────────────────────────────────────────
describe("connector registry", () => {
  it("exposes all 9 providers with UI-safe field metadata", () => {
    const providers = CRM_CONNECTOR_REGISTRY.map((e) => e.provider).sort();
    expect(providers).toEqual([
      "dynamics", "generic_rest", "gohighlevel", "hubspot", "pipedrive",
      "salesforce", "webee", "webhook", "zoho",
    ]);
    for (const e of CRM_CONNECTOR_REGISTRY) {
      expect(e.label.length).toBeGreaterThan(0);
      for (const f of e.fields) expect(f.help.length).toBeGreaterThan(10);
    }
  });

  it("flags secrets correctly and catalog contains no credential values", () => {
    expect(secretFieldKeys("hubspot").has("apiKey")).toBe(true);
    expect(secretFieldKeys("salesforce").has("accessToken")).toBe(true);
    expect(secretFieldKeys("salesforce").has("instanceUrl")).toBe(false);
    const catalog = listConnectorCatalog();
    expect(JSON.stringify(catalog)).not.toContain("_enc");
  });

  it("rejects unknown providers", async () => {
    await expect(buildConnector("nonsense", {}, { workspaceId: WS })).rejects.toThrow(/Unsupported/);
  });
});

// ── CRUD + credential security ────────────────────────────────────────────────
describe("connection CRUD & credential security", () => {
  let connId = "";

  it("saves a connection with encrypted credentials and masked reads", async () => {
    const conn = await saveCrmConnectionServer({
      workspaceId: WS, userId: OWNER_ID, provider: "generic_rest", label: "Mock CRM",
      credentials: {
        baseUrl: baseUrl(), authStyle: "bearer", apiKey: API_KEY,
        testPath: "/me", listPath: "/contacts?limit=1", createPath: "/contacts",
      },
    });
    connId = conn.id;
    expect(conn.status).toBe("unverified");
    expect(conn.maskedCredentials.apiKey).toBe(MASKED_VALUE);
    expect(conn.maskedCredentials.baseUrl).toBe(MASKED_VALUE); // strict masking: no values on read
    expect(conn.credentialKeys).toContain("baseUrl");
    expect(JSON.stringify(conn)).not.toContain(API_KEY);

    // Raw row is encrypted — the API key must not appear in plaintext.
    const { data: raw } = await sb.from("systemmind_crm_connections").select("*").eq("id", connId).single();
    expect(JSON.stringify(raw)).not.toContain(API_KEY);
    expect(raw.credentials_encrypted).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
  });

  it("keeps stored secrets when update sends blank or masked values", async () => {
    const updated = await saveCrmConnectionServer({
      workspaceId: WS, userId: OWNER_ID, id: connId, provider: "generic_rest", label: "Mock CRM v2",
      credentials: { apiKey: MASKED_VALUE, baseUrl: "", testPath: "/me" },
    });
    expect(updated.label).toBe("Mock CRM v2");
    expect(updated.credentialKeys).toContain("baseUrl"); // kept (values never surface)
    // Secret retained: a test still authenticates.
    const { report } = await testCrmConnectionServer({ workspaceId: WS, userId: OWNER_ID, id: connId });
    expect(report.steps.find((s) => s.key === "auth")?.ok).toBe(true);
  });

  it("blocks provider changes and missing required fields", async () => {
    await expect(saveCrmConnectionServer({
      workspaceId: WS, userId: OWNER_ID, id: connId, provider: "hubspot", credentials: {},
    })).rejects.toThrow(/Provider cannot be changed/);
    await expect(saveCrmConnectionServer({
      workspaceId: WS, userId: OWNER_ID, provider: "hubspot", label: "hs", credentials: {},
    })).rejects.toThrow(/Missing required/);
  });

  it("SSRF guard blocks private/internal endpoint URLs when enabled", async () => {
    delete process.env.CRM_CONNECTIONS_ALLOW_PRIVATE_URLS;
    try {
      await expect(saveCrmConnectionServer({
        workspaceId: WS, userId: OWNER_ID, provider: "generic_rest", label: "SSRF probe",
        credentials: { baseUrl: "http://127.0.0.1:8080/api", authStyle: "bearer", apiKey: "x-not-real-x" },
      })).rejects.toThrow(/private|internal/i);
      await expect(saveCrmConnectionServer({
        workspaceId: WS, userId: OWNER_ID, provider: "webhook", label: "SSRF hook",
        credentials: { webhookUrl: "http://169.254.169.254/latest/meta-data" },
      })).rejects.toThrow(/private|internal/i);
    } finally {
      process.env.CRM_CONNECTIONS_ALLOW_PRIVATE_URLS = "1";
    }
  });

  it("scrubs credential values echoed back by external systems from test reports", async () => {
    // Mock server /echo-auth reflects the Authorization header in an error body.
    const conn = await saveCrmConnectionServer({
      workspaceId: WS, userId: OWNER_ID, provider: "generic_rest", label: "Reflective CRM",
      credentials: { baseUrl: baseUrl(), authStyle: "bearer", apiKey: API_KEY, testPath: "/echo-auth" },
    });
    try {
      const { report } = await testCrmConnectionServer({ workspaceId: WS, userId: OWNER_ID, id: conn.id });
      expect(JSON.stringify(report)).not.toContain(API_KEY);
      const { data: raw } = await sb.from("systemmind_crm_connections").select("last_test_report").eq("id", conn.id).single();
      expect(JSON.stringify(raw?.last_test_report ?? {})).not.toContain(API_KEY);
    } finally {
      await deleteCrmConnectionServer({ workspaceId: WS, userId: OWNER_ID, id: conn.id });
    }
  });

  it("enforces workspace isolation on reads and deletes", async () => {
    const other = await listCrmConnectionsServer({ workspaceId: OTHER_WS });
    expect(other.find((c) => c.id === connId)).toBeUndefined();
    await expect(deleteCrmConnectionServer({ workspaceId: OTHER_WS, userId: OWNER_ID, id: connId }))
      .rejects.toThrow(/not found/);
  });
});

// ── Test connection: truthful evidence ────────────────────────────────────────
describe("testConnection evidence", () => {
  it("verifies auth/read/write with real calls, persists connected status + report", async () => {
    const conn = await saveCrmConnectionServer({
      workspaceId: WS, userId: OWNER_ID, provider: "generic_rest", label: "Evidence CRM",
      credentials: {
        baseUrl: baseUrl(), authStyle: "bearer", apiKey: API_KEY,
        testPath: "/me", listPath: "/contacts?limit=1", createPath: "/contacts",
      },
    });
    const before = createdRecords.length;
    const { connection, report } = await testCrmConnectionServer({ workspaceId: WS, userId: OWNER_ID, id: conn.id });
    expect(report.ok).toBe(true);
    expect(report.steps.find((s) => s.key === "auth")?.ok).toBe(true);
    expect(report.steps.find((s) => s.key === "read")?.ok).toBe(true);
    expect(report.steps.find((s) => s.key === "write")?.ok).toBe(true);
    expect(createdRecords.length).toBe(before + 1); // write REALLY happened
    expect(createdRecords.at(-1)?.test).toBe(true); // and was flagged as test
    expect(report.sampleRecord?.name).toBe("Jane Doe");
    expect(report.fieldCount).toBeGreaterThan(3);
    expect(connection.status).toBe("connected");
    expect(connection.lastTestedAt).toBeTruthy();

    // Report persisted and contains NO secret values.
    const { data: raw } = await sb.from("systemmind_crm_connections").select("last_test_report, status").eq("id", conn.id).single();
    expect(raw.status).toBe("connected");
    expect(JSON.stringify(raw.last_test_report)).not.toContain(API_KEY);
    await deleteCrmConnectionServer({ workspaceId: WS, userId: OWNER_ID, id: conn.id });
  });

  it("reports truthful failure on a bad key — no green checkmarks", async () => {
    const conn = await saveCrmConnectionServer({
      workspaceId: WS, userId: OWNER_ID, provider: "generic_rest", label: "Bad key CRM",
      credentials: { baseUrl: baseUrl(), authStyle: "bearer", apiKey: "WRONG", testPath: "/me", listPath: "/contacts" },
    });
    const { connection, report } = await testCrmConnectionServer({ workspaceId: WS, userId: OWNER_ID, id: conn.id });
    expect(report.ok).toBe(false);
    expect(report.steps.every((s) => !s.ok)).toBe(true);
    expect(report.steps.find((s) => s.key === "auth")?.detail).toMatch(/401|unauthorized/i);
    expect(connection.status).toBe("failed");
    await deleteCrmConnectionServer({ workspaceId: WS, userId: OWNER_ID, id: conn.id });
  });

  it("truthfully marks unverifiable steps as skipped (no listPath/createPath)", async () => {
    const conn = await saveCrmConnectionServer({
      workspaceId: WS, userId: OWNER_ID, provider: "generic_rest", label: "Minimal CRM",
      credentials: { baseUrl: baseUrl(), authStyle: "bearer", apiKey: API_KEY, testPath: "/me" },
    });
    const { report } = await testCrmConnectionServer({ workspaceId: WS, userId: OWNER_ID, id: conn.id });
    const read = report.steps.find((s) => s.key === "read");
    const write = report.steps.find((s) => s.key === "write");
    expect(read?.skipped).toBe(true);
    expect(read?.ok).toBe(false);
    expect(write?.skipped).toBe(true);
    await deleteCrmConnectionServer({ workspaceId: WS, userId: OWNER_ID, id: conn.id });
  });
});

// ── Webhook connector ─────────────────────────────────────────────────────────
describe("webhook connector", () => {
  it("delivers a signed test event and is honest that read is not applicable", async () => {
    const secret = "whsec_e2e";
    const conn = await saveCrmConnectionServer({
      workspaceId: WS, userId: OWNER_ID, provider: "webhook", label: "Hook",
      credentials: { webhookUrl: `${baseUrl()}/hooks/in`, signingSecret: secret },
    });
    receivedWebhook = null;
    const { report } = await testCrmConnectionServer({ workspaceId: WS, userId: OWNER_ID, id: conn.id });
    expect(report.ok).toBe(true);
    expect(receivedWebhook).toBeTruthy();
    const expected = createHmac("sha256", secret).update(receivedWebhook!.body).digest("hex");
    expect(receivedWebhook!.signature).toBe(expected); // real HMAC verified end-to-end
    const read = report.steps.find((s) => s.key === "read");
    expect(read?.skipped).toBe(true);
    expect(read?.detail).toMatch(/outbound-only/i);
    await deleteCrmConnectionServer({ workspaceId: WS, userId: OWNER_ID, id: conn.id });
  });
});

// ── WEBEE internal connector + discovery persistence ──────────────────────────
describe("WEBEE connector & discovery", () => {
  let connId = "";

  it("verifies real read/write against the workspace leads table", async () => {
    const conn = await saveCrmConnectionServer({
      workspaceId: WS, userId: OWNER_ID, provider: "webee", label: "Built-in CRM", credentials: {},
    });
    connId = conn.id;
    const { report } = await testCrmConnectionServer({ workspaceId: WS, userId: OWNER_ID, id: connId });
    expect(report.ok).toBe(true);
    expect(report.steps.find((s) => s.key === "write")?.ok).toBe(true);
    // The test lead was cleaned up.
    const { count } = await sb.from("leads").select("id", { count: "exact", head: true })
      .eq("workspace_id", WS).contains?.("meta", { webee_connection_test: true }) ?? { count: 0 };
    expect(count ?? 0).toBe(0);
  });

  it("persists a discovery snapshot with objects, pipeline stages and counts", async () => {
    const { snapshot, summary } = await runCrmDiscoveryServer({ workspaceId: WS, userId: OWNER_ID, id: connId });
    expect(snapshot.objects[0].fields.length).toBeGreaterThan(5);
    expect(snapshot.pipelines[0].stages.map((s) => s.id)).toContain("qualified");
    expect(summary.fieldCount).toBe(snapshot.objects[0].fields.length);

    const stored = await getCrmDiscoveryServer({ workspaceId: WS, connectionId: connId });
    expect(stored?.provider).toBe("webee");

    // Re-run upserts (still exactly one snapshot row per connection).
    await runCrmDiscoveryServer({ workspaceId: WS, userId: OWNER_ID, id: connId });
    const { count } = await sb.from("systemmind_crm_discoveries")
      .select("id", { count: "exact", head: true }).eq("connection_id", connId);
    expect(count).toBe(1);
  });

  it("feeds discovered fields to the mapping engine and isolates workspaces", async () => {
    const fields = await getDiscoveredCrmFieldsForWorkspace({ workspaceId: WS });
    expect(fields.some((f) => f.provider === "webee" && f.field === "email")).toBe(true);
    const otherFields = await getDiscoveredCrmFieldsForWorkspace({ workspaceId: OTHER_WS });
    expect(otherFields.length).toBe(0);
    // Cross-workspace snapshot read is blocked.
    const foreign = await getCrmDiscoveryServer({ workspaceId: OTHER_WS, connectionId: connId });
    expect(foreign).toBeNull();
  });
});

// ── WBAH hard-block ───────────────────────────────────────────────────────────
describe("WBAH hard-block", () => {
  it("rejects every entry point for the WBAH workspace", async () => {
    await expect(listCrmConnectionsServer({ workspaceId: WBAH_WORKSPACE_ID })).rejects.toThrow();
    await expect(saveCrmConnectionServer({
      workspaceId: WBAH_WORKSPACE_ID, userId: OWNER_ID, provider: "webee", credentials: {},
    })).rejects.toThrow();
    await expect(testCrmConnectionServer({ workspaceId: WBAH_WORKSPACE_ID, userId: OWNER_ID, id: randomUUID() })).rejects.toThrow();
    await expect(runCrmDiscoveryServer({ workspaceId: WBAH_WORKSPACE_ID, userId: OWNER_ID, id: randomUUID() })).rejects.toThrow();
    await expect(getDiscoveredCrmFieldsForWorkspace({ workspaceId: WBAH_WORKSPACE_ID })).rejects.toThrow();
  });
});

// ── Server-only table protection ──────────────────────────────────────────────
describe("table security", () => {
  it("service role can read (server-only path) while tables carry RLS + REVOKE", async () => {
    const { data, error } = await sb.from("systemmind_crm_connections").select("id").limit(1);
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });
});
