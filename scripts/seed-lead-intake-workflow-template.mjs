/**
 * Seed (or update) the reusable "Lead generation webform intake setup" workflow
 * template so it appears in the platform Workflow Templates library and can be
 * activated per-workspace by HiveMind (action_type "activate_lead_intake_workflow").
 *
 * This is the STANDARD lead-generation intake setup:
 *   trigger: lead_added  → a new lead lands in the leads section
 *   call:    call_lead    → a Client Qualification agent auto-calls the lead
 *                           (shares the platform 3-calls/number/UTC-day cap)
 *   branch:  call_outcome → drives the lead's status:
 *              positive / qualified → qualified
 *              neutral  / interested → interested
 *              callback  → create a callback
 *              no_answer → re-queued as need_to_call for the next run
 *
 * Idempotent: workflow_templates.name has NO unique constraint, so we
 * select-by-name first and update in place, otherwise insert.
 *
 * Usage:   node scripts/seed-lead-intake-workflow-template.mjs
 * Requires: VITE_SUPABASE_URL (or SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const TEMPLATE_NAME = "Lead generation webform intake setup";
const CATEGORY_NAME = "Lead Management";

const FLOW_DEFINITION = {
  steps: [
    { id: "trigger", type: "trigger", trigger_type: "lead_added" },
    { id: "call", type: "call_lead", agent_assignment: "qualification", daily_cap: 3 },
    {
      id: "branch",
      type: "branch",
      conditions: [
        { field: "call_outcome", op: "equals", value: "qualified", next: "move_qualified" },
        { field: "call_outcome", op: "equals", value: "positive", next: "move_qualified" },
        { field: "call_outcome", op: "equals", value: "interested", next: "move_interested" },
        { field: "call_outcome", op: "equals", value: "neutral", next: "move_interested" },
        { field: "call_outcome", op: "equals", value: "callback", next: "create_callback" },
        { field: "call_outcome", op: "equals", value: "no_answer", next: "requeue" },
      ],
    },
    { id: "move_qualified", type: "update_lead_status", status: "qualified" },
    { id: "move_interested", type: "update_lead_status", status: "interested" },
    { id: "create_callback", type: "create_callback", delay_hours: 4 },
    { id: "requeue", type: "update_lead_status", status: "need_to_call" },
    { id: "end", type: "stop_workflow" },
  ],
};

const DESCRIPTION =
  "Standard lead-generation intake: automatically calls every new lead that lands in the leads section with a Client Qualification agent, updates the lead's status from the call outcome (qualified / interested / callback), and re-queues unanswered leads as need_to_call for the next run. Capped at 3 calls per number per day.";

const TAGS = ["lead", "webform", "intake", "auto-call", "qualification"];
const TRIGGER_TYPE = "lead_added";

async function getCategoryId() {
  const { data } = await sb
    .from("workflow_template_categories")
    .select("id")
    .eq("name", CATEGORY_NAME)
    .maybeSingle();
  if (data?.id) return data.id;
  const { data: created, error } = await sb
    .from("workflow_template_categories")
    .insert({
      name: CATEGORY_NAME,
      description: "Automate lead qualification, routing, and follow-up",
      icon: "Users",
      sort_order: 1,
    })
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return created?.id ?? null;
}

async function main() {
  const categoryId = await getCategoryId();

  const { data: existRows, error: selErr } = await sb
    .from("workflow_templates")
    .select("id")
    .eq("name", TEMPLATE_NAME)
    .limit(1);
  if (selErr) throw new Error(selErr.message);
  const existing = (existRows ?? [])[0];

  const payload = {
    category_id: categoryId,
    name: TEMPLATE_NAME,
    description: DESCRIPTION,
    tags: TAGS,
    trigger_type: TRIGGER_TYPE,
    status: "published",
    flow_definition: FLOW_DEFINITION,
    updated_at: new Date().toISOString(),
  };

  if (existing?.id) {
    const { error } = await sb.from("workflow_templates").update(payload).eq("id", existing.id);
    if (error) throw new Error(error.message);
    console.log(`OK  updated template "${TEMPLATE_NAME}" (${existing.id})`);
  } else {
    const { data: row, error } = await sb
      .from("workflow_templates")
      .insert(payload)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    console.log(`OK  inserted template "${TEMPLATE_NAME}" (${row?.id})`);
  }
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
