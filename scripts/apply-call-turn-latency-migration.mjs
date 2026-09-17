/**
 * One-time migration: per-turn voice latency.
 *   public.call_turns          — one row per assistant turn
 *   public.calls.is_test_call  — keeps builder test calls out of percentiles
 *
 * Run: node scripts/apply-call-turn-latency-migration.mjs
 *
 * Unlike the older apply-* scripts this exits non-zero on failure. It is not
 * wired into any hook, so a silent exit 0 would only mean reporting a success
 * that did not happen. The SQL is additive and idempotent throughout
 * (add column / create table / create index — all "if not exists"), so a
 * re-run is harmless.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));

// .env first: Vite dev leaves non-VITE_* vars out of process.env.
function envFromFile() {
  try {
    const text = readFileSync(resolve(__dir, "../.env"), "utf8");
    const out = {};
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq < 0) continue;
      let v = t.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      out[t.slice(0, eq).trim()] = v;
    }
    return out;
  } catch {
    return {};
  }
}

const fileEnv = envFromFile();
const pick = (name) => process.env[name]?.trim() || fileEnv[name]?.trim() || "";

const SQL = readFileSync(
  resolve(__dir, "../supabase/migrations/20261003000000_call_turn_latency.sql"),
  "utf8",
);

const SUPABASE_URL = pick("SUPABASE_URL") || pick("VITE_SUPABASE_URL");
const SERVICE_KEY = pick("SUPABASE_SERVICE_ROLE_KEY");
const mgmtToken = pick("SUPABASE_ACCESS_TOKEN");
const projectRef = SUPABASE_URL.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];

async function columnExists(supabase, table, column) {
  const { error } = await supabase.from(table).select(column).limit(1);
  return !error;
}

if (!projectRef || !mgmtToken) {
  console.error("❌ Missing SUPABASE_ACCESS_TOKEN or project ref — cannot apply.");
  process.exit(1);
}

const supabase =
  SUPABASE_URL && SERVICE_KEY
    ? createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
    : null;

if (supabase) {
  const hasTurns = await columnExists(supabase, "call_turns", "id");
  const hasFlag = await columnExists(supabase, "calls", "is_test_call");
  if (hasTurns && hasFlag) {
    console.log("✅ Already applied — call_turns and calls.is_test_call both present.");
    process.exit(0);
  }
  console.log(
    `Applying… (call_turns: ${hasTurns ? "present" : "missing"}, calls.is_test_call: ${hasFlag ? "present" : "missing"})`,
  );
}

const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${mgmtToken}` },
  body: JSON.stringify({ query: SQL }),
});
const body = await res.text();

if (!res.ok) {
  console.error(`❌ Management API ${res.status}: ${body.slice(0, 600)}`);
  process.exit(1);
}

// PostgREST caches the schema, so a brand-new table is invisible over REST
// until it reloads — which looks exactly like a failed migration. Nudge it
// before verifying.
await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${mgmtToken}` },
  body: JSON.stringify({ query: "notify pgrst, 'reload schema'" }),
}).catch(() => {});
await new Promise((r) => setTimeout(r, 3000));

// Verify rather than trust the status code.
if (supabase) {
  const hasTurns = await columnExists(supabase, "call_turns", "id");
  const hasFlag = await columnExists(supabase, "calls", "is_test_call");
  if (!hasTurns || !hasFlag) {
    console.error(
      `❌ API reported success but verification failed (call_turns: ${hasTurns}, calls.is_test_call: ${hasFlag}).`,
    );
    process.exit(1);
  }
}

console.log("✅ call_turns + calls.is_test_call applied and verified.");
process.exit(0);
