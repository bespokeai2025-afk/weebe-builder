#!/usr/bin/env bun
/**
 * Test $('Node Name') expressions + POST dashboard body builder (Sam Martin fixture).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { attachAutomationToWbahPipeline } from "../src/lib/automation-engine/sync-automation.server.ts";
import { defaultWbahPostCallWorkflowConfig } from "../src/lib/wbah/workflow/wbah-workflow-steps.shared.ts";
import { ensureAutomationEngineBootstrapped } from "../src/lib/automation-engine/bootstrap.ts";
import { runExecution } from "../src/lib/automation-engine/runtime/execution-runner.ts";
import {
  buildWbahDashboardAnalyzedPostBody,
} from "../src/lib/wbah/post-call/wbah-dashboard-post-body.shared.ts";
import {
  evaluateExpression,
  buildNodeIdByLabelMap,
} from "../src/lib/automation-engine/expressions/resolve-expression.ts";
import { unwrapPinDataToJson } from "../src/lib/wbah/workflow/wbah-test-trigger-fixture.shared.ts";

ensureAutomationEngineBootstrapped();

const pinRaw = JSON.parse(
  readFileSync(join(process.cwd(), "scripts/test-wbah-voice-webhook-n8n.json"), "utf8"),
);
const trigger = unwrapPinDataToJson(pinRaw);

const pipeline = attachAutomationToWbahPipeline(defaultWbahPostCallWorkflowConfig());
const workflow = pipeline.automation ?? {};

let failed = 0;
const assert = (label, cond) => {
  console.log(`[${cond ? "PASS" : "FAIL"}] ${label}`);
  if (!cond) failed += 1;
};

// $('Build Slot URL') expression lookup
const parsed = await import("../src/lib/automation-engine/parser/parse-workflow.ts").then((m) =>
  m.parseWorkflowDocument(workflow),
);
if (!parsed.ok) throw new Error("invalid workflow");

const nodeIdByLabel = buildNodeIdByLabelMap(parsed.workflow.nodes.values());
const slotOut = {
  booking_url: "https://calendly.com/x/abc/2025-12-30T09:10:00.000Z",
  appointment_date: "2025-12-30",
  appointment_time: "2025-12-30T09:10:00.000Z",
};
const exprCtx = {
  nodeOutputs: {
    "build-slot-url": [{ json: slotOut }],
  },
  nodeIdByLabel,
  variables: {},
  globalVariables: {},
  env: {},
  execution: { id: "test", workflowId: parsed.workflow.id },
};

const slotUrl = evaluateExpression("$('Build Slot URL').item.json.booking_url", exprCtx, trigger);
assert("$('Build Slot URL').item.json.booking_url", slotUrl === slotOut.booking_url);

const body = buildWbahDashboardAnalyzedPostBody(trigger, slotOut);
assert("body.lead_id", body.lead_id === "5e2c7b3e-e2df-f011-8543-7ced8d4a8921");
assert("body.booking_status", body.booking_status === "success");
assert("body.calendly_booking_url", body.calendly_booking_url === slotOut.booking_url);
assert("body.raw_data has no transcript_object", !body.raw_data?.call?.transcript_object);

// Execute POST dashboard (dry-run) — slot empty when run in isolation
const result = await runExecution({
  workflow,
  mode: "test",
  trigger,
  startNodeId: "post-dashboard-analyzed",
  startInput: trigger,
  maxNodes: 1,
});

const step = result.log[0];
const dryBody = step?.output?._requestBody;
assert("execute POST dashboard dry-run", step?.status === "success");
assert("dry-run request body lead_id", dryBody?.lead_id === body.lead_id);
assert("dry-run booking_status success", dryBody?.booking_status === "success");

process.exit(failed > 0 ? 1 : 0);
