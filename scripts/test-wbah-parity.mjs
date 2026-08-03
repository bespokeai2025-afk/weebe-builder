#!/usr/bin/env bun
/**
 * Parity tests — merge combine, calendly slot IF, dashboard raw body, n8n conditions.
 */
import { combineMergeOutputs } from "../src/lib/automation-engine/runtime/merge-runtime.ts";
import { evaluateN8nConditions } from "../src/lib/automation-engine/expressions/n8n-conditions.ts";
import {
  buildWbahDashboardRawPostBody,
  buildWbahDashboardAnalyzedPostBody,
} from "../src/lib/wbah/post-call/wbah-dashboard-post-body.shared.ts";
import { wbahWebhookHasCalendlySlot } from "../src/lib/wbah/post-call/wbah-format-data.shared.ts";
import { defaultWbahPostCallWorkflowConfig } from "../src/lib/wbah/workflow/wbah-workflow-steps.shared.ts";
import { attachAutomationToWbahPipeline } from "../src/lib/automation-engine/sync-automation.server.ts";
import { ensureAutomationEngineBootstrapped } from "../src/lib/automation-engine/bootstrap.ts";
import { runExecution } from "../src/lib/automation-engine/runtime/execution-runner.ts";

ensureAutomationEngineBootstrapped();

let failed = 0;
const assert = (label, cond) => {
  console.log(`[${cond ? "PASS" : "FAIL"}] ${label}`);
  if (!cond) failed += 1;
};

// Merge — cartesian combine
const merged = combineMergeOutputs(
  { mergeMode: "Combine", combineBy: "all" },
  [[{ event: "call_analyzed", lead_id: "L1" }], [{ booking_url: "https://calendly.com/x" }]],
);
assert("merge combine merges both inputs", merged[0]?.event === "call_analyzed" && merged[0]?.booking_url?.includes("calendly"));

// Calendly slot detection
const withSlot = {
  body: {
    event: "call_analyzed",
    call: {
      call_analysis: {
        custom_analysis_data: {
          calendly_slot: '{"preferred_slot":{"date":"2025-12-30","time":"09:10"}}',
        },
      },
    },
  },
};
const noSlot = { body: { event: "call_analyzed", call: { call_analysis: { custom_analysis_data: {} } } } };
assert("calendly slot not empty", wbahWebhookHasCalendlySlot(withSlot));
assert("calendly slot empty", !wbahWebhookHasCalendlySlot(noSlot));

// n8n conditions — nodes 21 & 5
const ctx = { nodeOutputs: {}, variables: {}, env: {}, execution: { id: "t", workflowId: "w" } };
const passAnalyzedSlot = evaluateN8nConditions(
  [
    { field: "{{ $json.body.event }}", operator: "equals", value: "call_analyzed" },
    { field: "{{ $json }}", operator: "wbah:calendly_slot_not_empty" },
  ],
  "and",
  ctx,
  withSlot,
);
assert("IF call_analyzed + calendly slot", passAnalyzedSlot);
assert("IF fails without slot", !evaluateN8nConditions(
  [
    { field: "{{ $json.body.event }}", operator: "equals", value: "call_analyzed" },
    { field: "{{ $json }}", operator: "wbah:calendly_slot_not_empty" },
  ],
  "and",
  ctx,
  noSlot,
));

// POST DASHBOARD1 raw body
const rawBody = buildWbahDashboardRawPostBody(withSlot);
assert("raw body has empty slot fields", rawBody.calendly_booking_url === "" && rawBody.booking_status === "");
assert("raw body has lead_id", rawBody.lead_id !== undefined);

// POST DASHBOARD analyzed with slot node output
const analyzedBody = buildWbahDashboardAnalyzedPostBody(withSlot, {
  booking_url: "https://calendly.com/s/abc",
  appointment_date: "2025-12-30",
  appointment_time: "2025-12-30T09:10:00.000Z",
});
assert("analyzed body booking_url", analyzedBody.calendly_booking_url.includes("calendly"));

// merge2 must map to core.merge (not WBAH dashboard executor)
const pipeline = attachAutomationToWbahPipeline(defaultWbahPostCallWorkflowConfig());
const workflow = pipeline.automation;
const merge2Node = (workflow.nodes ?? []).find((n) => n.id === "merge2");
assert("merge2 is core.merge", merge2Node?.type === "core.merge");

const mergeExec = await runExecution({
  workflow,
  mode: "test",
  trigger: withSlot,
  startNodeId: "merge2",
  startInput: {},
  maxNodes: 1,
});
assert("merge2 execute-step completes", mergeExec.status === "completed" && mergeExec.log[0]?.status === "success");

console.log(failed ? `\n${failed} failed` : "\nAll parity checks passed");
process.exit(failed > 0 ? 1 : 0);
