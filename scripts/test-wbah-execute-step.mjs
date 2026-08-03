#!/usr/bin/env bun
/**
 * Run WBAH post-call Execute step against pin data + default fixture.
 * Simulates ngrok → WEBEE `/api/public/voice-webhook` (not legacy n8n webhook id).
 *
 * Usage:
 *   bun scripts/test-wbah-execute-step.mjs
 *   WBAH_TEST_WEBHOOK_BASE_URL=https://xxxx.ngrok-free.app bun scripts/test-wbah-execute-step.mjs
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

function loadDotenv() {
  try {
    for (const line of readFileSync(join(process.cwd(), ".env"), "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq < 0) continue;
      const key = t.slice(0, eq).trim();
      let val = t.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    /* optional */
  }
}

loadDotenv();

const baseUrl =
  process.env.WBAH_TEST_WEBHOOK_BASE_URL?.replace(/\/$/, "") || "http://localhost:5003";
const webhookUrl = `${baseUrl}/api/public/voice-webhook`;

const pinRaw = JSON.parse(
  readFileSync(join(process.cwd(), "scripts/test-wbah-voice-webhook-n8n.json"), "utf8"),
);
const pinData = pinRaw.map((item) => ({
  ...item,
  webhookUrl,
  executionMode: "test",
}));

const { defaultWbahPostCallWorkflowConfig } = await import(
  "../src/lib/wbah/workflow/wbah-workflow-steps.shared.ts"
);
const { executeWbahWorkflowNodeStep } = await import(
  "../src/lib/wbah/workflow/wbah-workflow-node-execute.server.ts"
);
const {
  normalizeN8nWebhookItem,
  unwrapPinDataToJson,
  WBAH_DEFAULT_EXECUTE_TRIGGER,
} = await import("../src/lib/wbah/workflow/wbah-test-trigger-fixture.shared.ts");
const { resolveWbahRetellAgent } = await import(
  "../src/lib/wbah/post-call/wbah-retell-agents.shared.ts"
);

const pipeline = defaultWbahPostCallWorkflowConfig();
const webhookNode = pipeline.n8n_graph?.nodes.find((n) => n.id === "webhook");

console.log("=== WBAH Execute step simulation ===");
console.log("Webhook URL:", webhookUrl);
console.log("Agent:", WBAH_DEFAULT_EXECUTE_TRIGGER.body?.call?.agent_id);
console.log(
  "Agent mapped:",
  resolveWbahRetellAgent("agent_0440750bb59597eef7352901bf")?.agentName ?? "NOT FOUND",
);

const pinJson = unwrapPinDataToJson(pinData);
console.log("\nPin data normalized:");
console.log("  event:", pinJson.body?.event);
console.log("  lead_id:", pinJson.body?.call?.retell_llm_dynamic_variables?.lead_id);
console.log("  webhookUrl:", pinJson.webhookUrl);

const nodesToTest = [
  { id: "webhook", label: "Webhook trigger", usePin: true },
  { id: "filter-lead-1", label: "Filter — lead_id exists", usePin: true },
  { id: "call-analyzed-dashboard", label: "call_analyzed (dashboard)", usePin: true },
];

let failed = 0;

for (const spec of nodesToTest) {
  const nodePin = spec.usePin ? pinData : undefined;
  try {
    const result = await executeWbahWorkflowNodeStep({
      pipeline,
      nodeId: spec.id,
      pinData: nodePin,
      dryRun: true,
    });
    const ok = result.status === "success";
    if (!ok) failed += 1;
    console.log(`\n[${ok ? "PASS" : "FAIL"}] ${spec.label} (${spec.id})`);
    console.log("  status:", result.status);
    if (result.branch) console.log("  branch:", result.branch);
    if (result.error) console.log("  error:", result.error);
    if (result.output?.[0]?.json?._conditionResult != null) {
      console.log("  condition:", result.output[0].json._conditionResult);
    }
  } catch (e) {
    failed += 1;
    console.log(`\n[FAIL] ${spec.label} (${spec.id})`);
    console.log("  thrown:", e instanceof Error ? e.message : String(e));
  }
}

console.log("\n=== Live webhook POST (flat Retell body) ===");
const flatBody = JSON.parse(
  readFileSync(join(process.cwd(), "scripts/test-wbah-voice-webhook-sam.json"), "utf8"),
);
try {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(flatBody),
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text.slice(0, 200);
  }
  const liveOk = res.ok;
  if (!liveOk) failed += 1;
  console.log(`[${liveOk ? "PASS" : "FAIL"}] POST ${webhookUrl}`);
  console.log("  HTTP", res.status, parsed);
} catch (e) {
  failed += 1;
  console.log("[FAIL] POST", webhookUrl);
  console.log("  error:", e instanceof Error ? e.message : String(e));
  console.log("  (Is dev server running? bun run dev -- --port 5003)");
}

console.log("\n=== Webhook node pinData on default graph ===");
const presetPin = webhookNode?.config?.pinData;
console.log("  pinData items:", Array.isArray(presetPin) ? presetPin.length : presetPin ? 1 : 0);
if (Array.isArray(presetPin) && presetPin[0]?.json) {
  const n = normalizeN8nWebhookItem(presetPin[0].json);
  console.log("  pinned agent:", n.body?.call?.agent_id);
  console.log("  pinned webhookUrl:", n.webhookUrl);
}

process.exit(failed > 0 ? 1 : 0);
