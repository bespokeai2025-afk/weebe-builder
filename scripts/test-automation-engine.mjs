#!/usr/bin/env bun
/**
 * Smoke test for automation execution engine (modes, from-node, events).
 * Usage: bun scripts/test-automation-engine.mjs
 */
import { defaultWbahPostCallWorkflowConfig } from "../src/lib/wbah/workflow/wbah-workflow-steps.shared.ts";
import { attachAutomationToWbahPipeline } from "../src/lib/automation-engine/sync-automation.server.ts";
import { ensureAutomationEngineBootstrapped } from "../src/lib/automation-engine/bootstrap.ts";
import { runExecution } from "../src/lib/automation-engine/runtime/execution-runner.ts";
import { executionEventBus } from "../src/lib/automation-engine/runtime/execution-events.ts";

ensureAutomationEngineBootstrapped();

const pipeline = attachAutomationToWbahPipeline(defaultWbahPostCallWorkflowConfig());
const workflow = pipeline.automation;

let failed = 0;
const assert = (label, cond) => {
  console.log(`[${cond ? "PASS" : "FAIL"}] ${label}`);
  if (!cond) failed += 1;
};

const trigger = {
  headers: { "content-type": "application/json" },
  body: {
    event: "call_analyzed",
    call: {
      agent_id: "agent_0440750bb59597eef7352901bf",
      retell_llm_dynamic_variables: { lead_id: "test-lead-001" },
    },
  },
};

// Test mode — filter from node
const execId = crypto.randomUUID();
const { events, unsubscribe } = executionEventBus.collect(execId);

const filterResult = await runExecution({
  workflow,
  mode: "test",
  executionId: execId,
  trigger,
  startNodeId: "filter-lead-1",
  startInput: trigger,
  maxNodes: 1,
});

unsubscribe();
assert("filter-lead-1 test mode success", filterResult.status === "completed");
assert("filter branch true", filterResult.log[0]?.branch === "true");
assert("events captured", events.length >= 2);

// Branch-only — call_analyzed check
const ifResult = await runExecution({
  workflow,
  mode: "test",
  trigger,
  startNodeId: "call-analyzed-dashboard",
  startInput: trigger,
  maxNodes: 1,
});
assert("call-analyzed-dashboard passes", ifResult.log[0]?.status === "success");

console.log("\nEvents sample:", events.slice(0, 3).map((e) => e.type));
process.exit(failed > 0 ? 1 : 0);
