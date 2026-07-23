/**
 * Enable Buzzchat for a client workspace (no WATI API calls).
 *
 * - Links client user as workspace owner
 * - Sets default_workspace_id on their profile
 * - Adds "whatsapp" module to workspace_settings.active_modules
 * - Sets workspace_subscriptions to a package that includes whatsapp
 *
 * Usage:
 *   node scripts/enable-buzzchat-client.mjs
 *
 * Optional env (or add to .env):
 *   CLIENT_EMAIL=info@avenueeliteproperties.com
 *   WORKSPACE_ID=<uuid>           # skip name search if set
 *   WORKSPACE_SEARCH=avenue       # name/slug filter (default: avenue)
 *   PACKAGE_KEY=legacy_full       # default: legacy_full (includes whatsapp)
 *   PLAN_TIER=executive_suite     # workspace_settings.plan_tier
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const WBAH_WORKSPACE_ID = "5cb750b6-fabf-4e84-9b92-740df1cd8d53";

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
const CLIENT_EMAIL = (process.env.CLIENT_EMAIL || "info@avenueeliteproperties.com")
  .trim()
  .toLowerCase();
const WORKSPACE_ID = process.env.WORKSPACE_ID?.trim();
const WORKSPACE_SEARCH = (process.env.WORKSPACE_SEARCH || "avenue").trim().toLowerCase();
const PACKAGE_KEY = process.env.PACKAGE_KEY || "legacy_full";
const PLAN_TIER = process.env.PLAN_TIER || "executive_suite";

function uniqModules(list) {
  return [...new Set(list.filter(Boolean))];
}

async function findAuthUserId(sb, email) {
  // listUsers pagination — fine for small projects
  let page = 1;
  while (page <= 20) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`auth listUsers: ${error.message}`);
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return hit.id;
    if (data.users.length < 200) break;
    page++;
  }
  return null;
}

async function resolveWorkspaceId(sb) {
  if (WORKSPACE_ID) {
    const { data, error } = await sb
      .from("workspaces")
      .select("id,name,slug")
      .eq("id", WORKSPACE_ID)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error(`WORKSPACE_ID not found: ${WORKSPACE_ID}`);
    return data;
  }

  const { data, error } = await sb
    .from("workspaces")
    .select("id,name,slug")
    .neq("id", WBAH_WORKSPACE_ID)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  const matches = (data ?? []).filter((w) => {
    const hay = `${w.name ?? ""} ${w.slug ?? ""}`.toLowerCase();
    return hay.includes(WORKSPACE_SEARCH);
  });

  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    console.error("Multiple workspaces match — set WORKSPACE_ID:");
    for (const w of matches) console.error(`  ${w.id}  ${w.name} (${w.slug})`);
    process.exit(1);
  }

  console.error(`No workspace matching "${WORKSPACE_SEARCH}". All non-WBAH workspaces:`);
  for (const w of data ?? []) console.error(`  ${w.id}  ${w.name} (${w.slug})`);
  process.exit(1);
}

async function main() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error("Missing SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env");
    process.exit(2);
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const ws = await resolveWorkspaceId(sb);
  console.log(`Workspace: ${ws.name} (${ws.id})`);

  const userId = await findAuthUserId(sb, CLIENT_EMAIL);
  if (!userId) {
    console.error(
      `No Supabase auth user for ${CLIENT_EMAIL}. Create the account in Webee first (sign up), then re-run.`,
    );
    process.exit(1);
  }
  console.log(`Client user: ${CLIENT_EMAIL} (${userId})`);

  const { data: existingMember } = await sb
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", ws.id)
    .eq("user_id", userId)
    .maybeSingle();

  if (!existingMember) {
    const { error } = await sb.from("workspace_members").insert({
      workspace_id: ws.id,
      user_id: userId,
      role: "owner",
    });
    if (error) throw new Error(`workspace_members insert: ${error.message}`);
    console.log("✅ Added as workspace owner");
  } else {
    console.log(`✅ Already a member (role: ${existingMember.role})`);
  }

  const { error: profileErr } = await sb
    .from("profiles")
    .update({ default_workspace_id: ws.id })
    .eq("user_id", userId);
  if (profileErr) throw new Error(`profiles update: ${profileErr.message}`);
  console.log("✅ Set default_workspace_id for client");

  const { data: settings } = await sb
    .from("workspace_settings")
    .select("active_modules, plan_tier")
    .eq("workspace_id", ws.id)
    .maybeSingle();

  const currentModules = (settings?.active_modules ?? []) ;
  const nextModules = uniqModules([...(Array.isArray(currentModules) ? currentModules : []), "whatsapp"]);

  const { error: settingsErr } = await sb.from("workspace_settings").upsert(
    {
      workspace_id: ws.id,
      active_modules: nextModules,
      plan_tier: PLAN_TIER,
      modules_updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id" },
  );
  if (settingsErr) throw new Error(`workspace_settings: ${settingsErr.message}`);
  console.log(`✅ Modules: ${nextModules.join(", ")}`);
  console.log(`✅ Plan tier: ${PLAN_TIER}`);

  const { error: subErr } = await sb.from("workspace_subscriptions").upsert(
    {
      workspace_id: ws.id,
      package_key: PACKAGE_KEY,
      subscription_status: "active",
      trial_ends_at: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id" },
  );
  if (subErr) throw new Error(`workspace_subscriptions: ${subErr.message}`);
  console.log(`✅ Package: ${PACKAGE_KEY} (active)`);

  console.log("\nDone. Client should log out/in, then open Buzzchat at /whatsapp");
  console.log(`Workspace ID (for WATI webhook later): ${ws.id}`);
}

main().catch((e) => {
  console.error("❌", e.message);
  process.exit(1);
});
