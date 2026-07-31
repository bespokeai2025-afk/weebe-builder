/**
 * Seed WBAH n8n workflow into SystemMind (DB rows only).
 * For full build session, use Admin → Webuyanyhouse → "Create Build Session"
 * or run via the app server function createWbahNewLeadsBuildSessionFn.
 *
 *   node scripts/seed-wbah-n8n-systemmind.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));

const WBAH_N8N_WORKFLOW_ID = "yR3vAIdZNLovD8jx";
const WBAH_N8N_WEBHOOK_URL =
  "https://bespoke.app.n8n.cloud/webhook/392d5d13-7ee2-4fa0-ad46-7736ba4603bf";
const WBAH_WORKSPACE_ID = "5cb750b6-fabf-4e84-9b92-740df1cd8d53";
const TEMPLATE_NAME = "WBAH New Leads — Retell Post-Call (n8n)";

function loadDotEnv() {
  try {
    const raw = readFileSync(resolve(__dir, "../.env"), "utf8");
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i < 1) continue;
      const key = t.slice(0, i);
      let val = t.slice(i + 1).trim();
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

loadDotEnv();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(2);
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const now = new Date().toISOString();

const understanding = {
  purpose: "WBAH Retell post-call → WeeBespoke + Calendly + Dynamics via n8n",
  business_summary: "Production New Leads pipeline (lead_id required in dynamic vars).",
  confidence: 95,
};

const structure = {
  nodes: [
    { id: "webhook", name: "Webhook", type: "n8n-nodes-base.webhook" },
    { id: "post_dashboard", name: "POST TO DASHBOARD", type: "n8n-nodes-base.httpRequest" },
    { id: "allens_logic", name: "Apply Allens Logic", type: "n8n-nodes-base.code" },
    { id: "patch_dynamics", name: "POST SUMMARY TO 365", type: "n8n-nodes-base.httpRequest" },
    { id: "webee_ingest", name: "WEBEE Live Ingest", type: "n8n-nodes-base.httpRequest" },
  ],
  edges: [],
  order: ["webhook", "post_dashboard", "allens_logic", "patch_dynamics", "webee_ingest"],
};

const { data: n8nRow, error: n8nErr } = await sb
  .from("systemmind_n8n_workflows")
  .upsert(
    {
      workspace_id: WBAH_WORKSPACE_ID,
      n8n_workflow_id: WBAH_N8N_WORKFLOW_ID,
      name: "WBAH Retell Post-Call (CALLBACK SUPPORT)",
      active: true,
      trigger_types: ["webhook"],
      has_webhook: true,
      metadata: { webhook_url: WBAH_N8N_WEBHOOK_URL, source: "seed_script" },
      raw_snapshot: { structure, seeded: true },
      understanding,
      confidence: 95,
      template_type: "customer_specific",
      workflow_category: "Client Qualification",
      updated_at: now,
    },
    { onConflict: "workspace_id,n8n_workflow_id" },
  )
  .select("id")
  .single();

if (n8nErr) {
  console.error("n8n workflow upsert failed:", n8nErr.message);
  process.exit(1);
}

const { data: existingTpl } = await sb
  .from("systemmind_workflow_templates")
  .select("id")
  .eq("workspace_id", WBAH_WORKSPACE_ID)
  .eq("name", TEMPLATE_NAME)
  .maybeSingle();

const tplPayload = {
  workspace_id: WBAH_WORKSPACE_ID,
  name: TEMPLATE_NAME,
  description: understanding.business_summary,
  business_purpose: understanding.purpose,
  category: "Client Qualification",
  template_type: "customer_specific",
  status: "approved",
  is_trusted: true,
  confidence: 95,
  readiness: "ready",
  linked_n8n_workflow_ids: [n8nRow.id],
  linked_retell_agent_ids: [
    "agent_a03162ee94d003c298817e727c",
    "agent_698b8e07acac970aefaf0a52b6",
  ],
  structure,
  tags: ["wbah", "new-leads", "n8n"],
  source_kind: "manual",
  updated_at: now,
  approved_at: now,
};

let tplId;
if (existingTpl?.id) {
  const { data, error } = await sb
    .from("systemmind_workflow_templates")
    .update(tplPayload)
    .eq("id", existingTpl.id)
    .select("id")
    .single();
  if (error) {
    console.error("template update failed:", error.message);
    process.exit(1);
  }
  tplId = data.id;
} else {
  const { data, error } = await sb
    .from("systemmind_workflow_templates")
    .insert({ ...tplPayload, current_version: 1 })
    .select("id")
    .single();
  if (error) {
    console.error("template insert failed:", error.message);
    process.exit(1);
  }
  tplId = data.id;
}

console.log("✅ WBAH n8n SystemMind integration seeded");
console.log("   n8n workflow row:", n8nRow.id);
console.log("   template:", tplId);
console.log("\nNext: Admin → Webuyanyhouse → Create Build Session");
console.log("Or open /systemmind/template-library in the WBAH workspace");
