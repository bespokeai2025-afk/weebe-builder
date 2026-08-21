#!/usr/bin/env bun
/**
 * Inspect WBAH post-call job execution for a Retell call_id (no secrets printed).
 *
 * Usage:
 *   bun scripts/probe-wbah-call-execution.mjs call_cdd5c71e98eb32aec4db87f4e95
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

const callId = process.argv[2];
if (!callId) {
  console.error("Usage: bun scripts/probe-wbah-call-execution.mjs <retell_call_id>");
  process.exit(1);
}

const sbUrl = process.env.SUPABASE_URL;
const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!sbUrl || !sbKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

async function sbGet(path) {
  const res = await fetch(`${sbUrl}/rest/v1/${path}`, {
    headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} ${res.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text);
}

const jobs = await sbGet(
  `wbah_post_call_jobs?retell_call_id=eq.${callId}&select=id,event,status,branches,errors,last_error,attempt_count,lead_id,agent_id,created_at,updated_at,payload&order=created_at.asc`,
);

console.log("=== wbah_post_call_jobs ===");
for (const job of jobs) {
  console.log(JSON.stringify({
    id: job.id,
    event: job.event,
    status: job.status,
    branches: job.branches,
    errors: job.errors,
    last_error: job.last_error,
    attempt_count: job.attempt_count,
    lead_id: job.lead_id,
    agent_id: job.agent_id,
    created_at: job.created_at,
    updated_at: job.updated_at,
  }, null, 2));

  if (job.event === "call_analyzed" && job.payload) {
    const call = job.payload.call ?? {};
    const custom = call.call_analysis?.custom_analysis_data ?? {};
    const dyn = call.retell_llm_dynamic_variables ?? {};
    console.log("\n--- call_analyzed payload (callback-relevant) ---");
    console.log(JSON.stringify({
      callback_datetime: custom.callback_datetime ?? null,
      human_callback_datetime: custom.human_callback_datetime ?? null,
      callback_type: custom.callback_type ?? null,
      user_sentiment: call.call_analysis?.user_sentiment ?? null,
      lead_id: dyn.lead_id ?? null,
      call_source: dyn.call_source ?? null,
      agent_id: call.agent_id ?? null,
    }, null, 2));

    const { formatWbahRetellCallData } = await import(
      "../src/lib/wbah/post-call/wbah-format-data.shared.ts"
    );
    const { applyAllensLogicV5 } = await import(
      "../src/lib/wbah/post-call/wbah-allens-logic.shared.ts"
    );
    const { buildWbahAllensCrmPayload } = await import(
      "../src/lib/wbah/post-call/wbah-crm-payload.shared.ts"
    );

    const formatted = formatWbahRetellCallData({
      dynVars: dyn,
      custom,
      callAnalysis: call.call_analysis,
    });
    const allens = applyAllensLogicV5({
      userSentiment: formatted.userSentiment,
      callbackDatetime: formatted.callbackDatetime,
      callbackDatetimeUtc: formatted.callbackDatetimeUtc,
      callbackType: formatted.callbackType,
      calendlyBookingUrl: null,
      appointmentBooked: formatted.appointmentConfirmed,
      callSummary: formatted.callSummary,
      detailedCallSummary: custom.detailed_call_summary as string | undefined,
    });
    const patch = buildWbahAllensCrmPayload({
      formatted,
      allens,
      calendlyBookingUrl: null,
      callbackUtc: formatted.callbackDatetimeUtc,
    });

    console.log("\n--- Simulated Allen + CRM patch ---");
    console.log(JSON.stringify({
      isCallbackRequest: formatted.isCallbackRequest,
      callbackDatetime: formatted.callbackDatetime,
      callbackDatetimeUtc: formatted.callbackDatetimeUtc,
      allensRule: allens.rule,
      allenLogicResult: allens.allenLogicResult,
      patchFields: Object.keys(patch),
      patch,
    }, null, 2));
  }
}

// Automation trace if present
for (const job of jobs.filter((j) => j.event === "call_analyzed")) {
  try {
    const traces = await sbGet(
      `automation_execution_steps?metadata->>wbah_job_id=eq.${job.id}&select=node_id,node_name,node_type,status,branch,error,started_at,completed_at&order=started_at.asc`,
    );
    if (traces.length) {
      console.log("\n=== automation_execution_steps ===");
      console.log(JSON.stringify(traces, null, 2));
    }
  } catch {
    /* table/column may not exist */
  }
}
