/**
 * One-off patch: add digit-by-digit phone readback + confirm gate to Ava.
 *
 * What it does:
 *  1. Resolves the admin workspace's Retell API key from workspace_settings.
 *  2. GETs agent_a7d436bf944aeae0c72a12d5d2 → conversation_flow_id.
 *  3. GETs the conversation flow → reads global_prompt + tools.
 *  4. Appends CONTACT_READBACK_RULE_V1 block to global_prompt (idempotent —
 *     skips if the marker is already present).
 *  5. Strengthens the book_appointment_cal tool description to require
 *     digit-by-digit phone readback in addition to the existing email rule.
 *  6. PATCHes the conversation flow with both changes.
 *  7. POSTs to /publish-agent to cut a new published version.
 *  8. Prints old version → new version.
 *
 * Run:
 *   node scripts/ava-contact-readback-patch.mjs
 *
 * Env vars required (all present as Replit Secrets / shared env vars):
 *   SUPABASE_URL | VITE_SUPABASE_URL   — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY          — service-role key (bypasses RLS)
 *   WEBEE_ADMIN_WORKSPACE_ID           — (optional) hard-pin admin workspace;
 *                                        falls back to owner-role DB lookup
 *
 * The script exits non-zero only on genuine errors; soft idempotency
 * (already-patched) exits 0 with a clear message.
 */

import { createClient } from "@supabase/supabase-js";

// ── Config ────────────────────────────────────────────────────────────────────

const AVA_AGENT_ID = "agent_a7d436bf944aeae0c72a12d5d2";
const RETELL_BASE  = "https://api.retellai.com";

/** Idempotency marker — presence in global_prompt means we've already run. */
const IDEMPOTENCY_MARKER = "## CONTACT READBACK RULE (v1)";

/**
 * The block appended to global_prompt.
 * Tone/format deliberately mirrors the existing CRITICAL BOOKING EMAIL RULE.
 */
const READBACK_RULE_BLOCK = `
## CONTACT READBACK RULE (v1)

After collecting EITHER an email address OR a phone number from the caller, you
MUST read it back in full before proceeding, and explicitly ask the caller to
confirm or correct it. Never call \`book_appointment_cal\` until BOTH have been
confirmed.

### Email readback
Spell the email address character by character using NATO phonetic alphabet or
plain letter names (e.g. "j-o-h-n" not "john"), say "at" for @, and "dot" for
each dot in the domain. Example:
  "Just to confirm your email — that's j-o-h-n, at, g-m-a-i-l, dot, c-o-m.
   Is that right?"
If the caller says no or corrects any character, ask them to repeat the full
address from the start and read it back again before continuing.

### Phone number readback
After the caller gives their phone number, repeat every digit individually —
never group them, never say "double" for repeated digits. Example:
  "Let me read that back — 0, 7, 7, 0, 1, 2, 3, 4, 5, 6. Is that correct?"
If the caller says no or corrects any digit, ask them to repeat the full number
and read every digit back again before continuing.

### Confirmation gate
Only proceed to \`book_appointment_cal\` after the caller has explicitly said
"yes", "correct", "that's right", or an equivalent affirmative for BOTH the
email and the phone number. A lack of objection is NOT confirmation — always
wait for a clear "yes".`.trim();

/**
 * Strengthened tool description appended to book_appointment_cal.
 * The existing autofix rule already adds the email readback fragment; this
 * adds the phone readback requirement so both are enforced at the tool level.
 */
const TOOL_PHONE_READBACK_FRAGMENT =
  "Read the phone number back digit by digit (never grouped) and get an explicit " +
  "\"yes\" from the caller before calling this tool. " +
  "Never call this tool without both a digit-confirmed phone AND a letter-confirmed email.";

const PHONE_READBACK_MARKER = "digit by digit";

// ── Helpers ───────────────────────────────────────────────────────────────────

async function retellFetch(path, body, method = "POST", key) {
  const res = await fetch(`${RETELL_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed = text;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* keep text */ }
  if (!res.ok) {
    const msg =
      parsed?.message ?? parsed?.error_message ?? text.slice(0, 300) ?? res.statusText;
    throw new Error(`Retell ${path} (${res.status}): ${msg}`);
  }
  return parsed;
}

// ── Main ──────────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL) { console.error("ERROR: SUPABASE_URL / VITE_SUPABASE_URL not set"); process.exit(1); }
if (!SERVICE_KEY)  { console.error("ERROR: SUPABASE_SERVICE_ROLE_KEY not set");         process.exit(1); }

const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// 1. Resolve admin workspace ID ───────────────────────────────────────────────
let adminWorkspaceId = process.env.WEBEE_ADMIN_WORKSPACE_ID?.trim() || null;
if (!adminWorkspaceId) {
  console.log("[1/8] WEBEE_ADMIN_WORKSPACE_ID not set — looking up owner in DB...");
  // Find the workspace where the owner email matches the platform admin address
  // or just pick the first workspace that has a retell_workspace_id key set.
  // We look for workspaces where retell_workspace_id starts with "key_" to find
  // the admin workspace (it's the one that holds the live Ava Retell key).
  const { data: rows, error } = await sb
    .from("workspace_settings")
    .select("workspace_id, retell_workspace_id")
    .like("retell_workspace_id", "key_%")
    .limit(20);
  if (error) { console.error("ERROR: workspace_settings query failed:", error.message); process.exit(1); }
  if (!rows || rows.length === 0) {
    console.error("ERROR: No workspace with a retell_workspace_id (key_...) found.");
    process.exit(1);
  }
  if (rows.length > 1) {
    console.log(`  Found ${rows.length} workspaces with Retell keys — picking the first.`);
    console.log("  Set WEBEE_ADMIN_WORKSPACE_ID to pin the correct one if this is wrong.");
  }
  adminWorkspaceId = rows[0].workspace_id;
  console.log(`  Resolved admin workspace: ${adminWorkspaceId}`);
}

// 2. Load admin workspace Retell key ──────────────────────────────────────────
console.log("[2/8] Loading admin workspace Retell key...");
const { data: wsCfg, error: wsErr } = await sb
  .from("workspace_settings")
  .select("retell_workspace_id")
  .eq("workspace_id", adminWorkspaceId)
  .maybeSingle();
if (wsErr) { console.error("ERROR: workspace_settings read failed:", wsErr.message); process.exit(1); }
const retellKey = wsCfg?.retell_workspace_id?.trim() || process.env.RETELL_API_KEY?.trim();
if (!retellKey) { console.error("ERROR: No Retell API key found for admin workspace."); process.exit(1); }
console.log(`  Using key: ${retellKey.slice(0, 8)}...${retellKey.slice(-4)}`);

// 3. GET agent ────────────────────────────────────────────────────────────────
console.log(`[3/8] Fetching agent ${AVA_AGENT_ID}...`);
const agent = await retellFetch(`/get-agent/${AVA_AGENT_ID}`, undefined, "GET", retellKey);
const oldVersion = agent.version ?? agent.published_version ?? "unknown";
const conversationFlowId = agent.response_engine?.conversation_flow_id;
if (!conversationFlowId) {
  console.error("ERROR: Agent has no conversation_flow_id — is this a conversation-flow agent?");
  process.exit(1);
}
console.log(`  Agent version (draft): ${oldVersion}`);
console.log(`  Conversation flow ID:  ${conversationFlowId}`);

// 4. GET conversation flow ─────────────────────────────────────────────────────
console.log("[4/8] Fetching conversation flow...");
const flow = await retellFetch(`/get-conversation-flow/${conversationFlowId}`, undefined, "GET", retellKey);
const originalPrompt = typeof flow.global_prompt === "string" ? flow.global_prompt : "";

// Tools can live in flow.tools or flow.general_tools
const originalTools      = Array.isArray(flow.tools)         ? flow.tools         : [];
const originalGenTools   = Array.isArray(flow.general_tools) ? flow.general_tools : [];

console.log(`  global_prompt length: ${originalPrompt.length} chars`);
console.log(`  tools: ${originalTools.length}, general_tools: ${originalGenTools.length}`);

// 5. Idempotency check ─────────────────────────────────────────────────────────
if (originalPrompt.includes(IDEMPOTENCY_MARKER)) {
  console.log("\n✅ ALREADY PATCHED — idempotency marker found in global_prompt. Nothing to do.");
  console.log(`   Current agent version: ${oldVersion}`);
  process.exit(0);
}

// 6. Build patched global_prompt ──────────────────────────────────────────────
console.log("[5/8] Building patched global_prompt...");
const newPrompt = originalPrompt
  ? `${originalPrompt}\n\n${READBACK_RULE_BLOCK}`
  : READBACK_RULE_BLOCK;
console.log(`  New global_prompt length: ${newPrompt.length} chars (+${newPrompt.length - originalPrompt.length})`);

// 7. Strengthen book_appointment_cal tool description ─────────────────────────
console.log("[6/8] Strengthening book_appointment_cal tool description...");

function patchCalTools(tools) {
  return tools.map((t) => {
    if (!t || typeof t !== "object") return t;
    const type = String(t.type ?? "").toLowerCase();
    const isCalTool =
      type === "book_appointment_cal" || type === "book_appointment" || type.includes("calcom");
    if (!isCalTool) return t;

    const existingDesc = typeof t.description === "string" ? t.description.trim() : "";
    // Only append if the phone digit-by-digit marker isn't already there
    if (existingDesc.includes(PHONE_READBACK_MARKER)) {
      console.log(`  Tool "${t.name ?? t.type}": phone readback rule already present.`);
      return t;
    }
    const newDesc = existingDesc
      ? `${existingDesc}\n${TOOL_PHONE_READBACK_FRAGMENT}`
      : TOOL_PHONE_READBACK_FRAGMENT;
    console.log(`  Tool "${t.name ?? t.type}": appended phone readback requirement.`);
    return { ...t, description: newDesc };
  });
}

const patchedTools    = patchCalTools(originalTools);
const patchedGenTools = patchCalTools(originalGenTools);

// 8. PATCH conversation flow ───────────────────────────────────────────────────
console.log("[7/8] PATCHing conversation flow...");

// Only include fields Retell accepts on PATCH — strip read-only keys
const READONLY_KEYS = new Set([
  "conversation_flow_id", "last_modification_timestamp",
]);

const patchBody = {};
for (const [k, v] of Object.entries(flow)) {
  if (READONLY_KEYS.has(k)) continue;
  if (v === null || v === undefined) continue;
  patchBody[k] = v;
}
patchBody.global_prompt = newPrompt;
if (originalTools.length > 0)    patchBody.tools         = patchedTools;
if (originalGenTools.length > 0) patchBody.general_tools = patchedGenTools;

await retellFetch(
  `/update-conversation-flow/${conversationFlowId}`,
  patchBody,
  "PATCH",
  retellKey,
);
console.log("  Conversation flow PATCHed successfully.");

// 9. Publish new agent version ─────────────────────────────────────────────────
// POST /publish-agent returns HTTP 200 with an EMPTY body — this is expected.
// We read the agent back after a short delay; Retell increments `base_version`
// to the just-published version number and creates a new draft (version + 1).
console.log("[8/8] Publishing new agent version...");
let newVersion = null;
try {
  const publishRes = await fetch(`${RETELL_BASE}/publish-agent/${AVA_AGENT_ID}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${retellKey}`, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!publishRes.ok) {
    const errBody = await publishRes.text();
    throw new Error(`HTTP ${publishRes.status}: ${errBody.slice(0, 300)}`);
  }
  // 200 OK with empty body — wait briefly then read back the published version.
  await new Promise((r) => setTimeout(r, 1200));
  const updatedAgent = await retellFetch(`/get-agent/${AVA_AGENT_ID}`, undefined, "GET", retellKey);
  // base_version = just-published version; version = new draft built on top
  newVersion = updatedAgent.base_version ?? updatedAgent.version ?? null;
  console.log("  Published successfully.");
  console.log("  Published version (base_version):", updatedAgent.base_version);
  console.log("  New draft version:", updatedAgent.version);
} catch (publishErr) {
  console.warn(`  publish-agent failed: ${publishErr.message}`);
  console.warn("  Attempting to read back agent state for version info...");
  try {
    const updatedAgent = await retellFetch(`/get-agent/${AVA_AGENT_ID}`, undefined, "GET", retellKey);
    newVersion = updatedAgent.base_version ?? updatedAgent.version ?? null;
    console.log("  Agent state:", JSON.stringify({
      version: updatedAgent.version,
      base_version: updatedAgent.base_version,
      is_published: updatedAgent.is_published,
    }, null, 2));
  } catch (readErr) {
    console.warn("  Could not re-read agent:", readErr.message);
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log("\n════════════════════════════════════════════════════════");
console.log("  AVA CONTACT READBACK PATCH — COMPLETE");
console.log("════════════════════════════════════════════════════════");
console.log(`  Agent:              ${AVA_AGENT_ID}`);
console.log(`  Conversation flow:  ${conversationFlowId}`);
console.log(`  Old version:        ${oldVersion}`);
console.log(`  New version:        ${newVersion ?? "(unknown — check Retell dashboard)"}`);
console.log("");
console.log("  Changes applied:");
console.log("  ✓ CONTACT READBACK RULE (v1) appended to global_prompt");
console.log("  ✓ book_appointment_cal tool description strengthened");
console.log("");
if (newVersion !== null && newVersion !== oldVersion) {
  console.log(`  ⚠️  Next step: set AVA_AGENT_VERSION=${newVersion} in shared env vars`);
  console.log("      then REPUBLISH the Replit deployment for the change to take effect.");
} else {
  console.log("  ⚠️  Next step: check the Retell dashboard → publish a new version manually,");
  console.log("      then set AVA_AGENT_VERSION to the new version and REPUBLISH.");
}
console.log("════════════════════════════════════════════════════════");
