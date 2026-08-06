/**
 * Enable HiveMind + SystemMind for DNR Medical Services workspace.
 * Usage: node scripts/provision-dnr-ai-modules.mjs [ownerEmail]
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dir = dirname(fileURLToPath(import.meta.url));

function loadDotenv() {
  try {
    for (const line of readFileSync(resolve(__dir, "../.env"), "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq < 0) continue;
      const k = t.slice(0, eq).trim();
      let v = t.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (!process.env[k]) process.env[k] = v;
    }
  } catch {
    /* optional */
  }
}

loadDotenv();

const OWNER_EMAIL_HINT =
  process.argv[2]?.trim().toLowerCase() || "admin@dnrmedicalservices.com";

const PACKAGE_KEY = "business_command";
const PLAN_TIER = "business_command";

const MODULES_TO_ENSURE = [
  "builder",
  "hivemind",
  "systemmind",
  "lead_generation",
  "receptionist",
];

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

async function findOwnerUser() {
  const { data: list, error } = await sb.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw new Error(error.message);
  const users = list?.users ?? [];
  const exact = users.find((u) => (u.email ?? "").toLowerCase() === OWNER_EMAIL_HINT);
  if (exact) return exact;
  const partial = users.find((u) =>
    (u.email ?? "").toLowerCase().includes("dnrmedical"),
  );
  return partial ?? null;
}

async function findWorkspaceForOwner(ownerId, ownerEmail) {
  const { data: memberRows } = await sb
    .from("workspace_members")
    .select("workspace_id, role, workspaces(id, name, slug, owner_id)")
    .eq("user_id", ownerId);

  if (memberRows?.length) {
    const ownerWs =
      memberRows.find((r) => r.role === "owner") ??
      memberRows.find((r) => {
        const n = (r.workspaces?.name ?? "").toLowerCase();
        return n.includes("dnr") || n.includes("medical");
      }) ??
      memberRows[0];
    if (ownerWs?.workspaces) return ownerWs.workspaces;
  }

  const { data: byName } = await sb
    .from("workspaces")
    .select("id, name, slug, owner_id")
    .or("name.ilike.%DNR%,name.ilike.%Medical Services%,slug.ilike.%dnr%")
    .order("created_at", { ascending: false })
    .limit(5);

  if (byName?.length) return byName[0];

  const { data: profile } = await sb
    .from("profiles")
    .select("default_workspace_id")
    .eq("user_id", ownerId)
    .maybeSingle();

  if (profile?.default_workspace_id) {
    const { data: ws } = await sb
      .from("workspaces")
      .select("id, name, slug, owner_id")
      .eq("id", profile.default_workspace_id)
      .maybeSingle();
    if (ws) return ws;
  }

  console.warn(`No workspace found for ${ownerEmail} — will create one.`);
  return null;
}

async function createWorkspace(owner, name = "DNR Medical Services") {
  const baseSlug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  let slug = baseSlug || "dnr-medical-services";
  for (let i = 0; i < 10; i++) {
    const trySlug = i === 0 ? slug : `${baseSlug}-${i}`;
    const { data: existing } = await sb.from("workspaces").select("id").eq("slug", trySlug).maybeSingle();
    if (!existing) {
      slug = trySlug;
      break;
    }
  }

  const { data: ws, error } = await sb
    .from("workspaces")
    .insert({ name, slug, owner_id: owner.id })
    .select("id, name, slug, owner_id")
    .single();
  if (error) throw new Error(`create workspace: ${error.message}`);

  await sb.from("workspace_members").insert({
    workspace_id: ws.id,
    user_id: owner.id,
    role: "owner",
  });

  await sb.from("profiles").update({ default_workspace_id: ws.id }).eq("user_id", owner.id);

  return ws;
}

async function main() {
  console.log("=== DNR HiveMind + SystemMind provision ===\n");
  console.log("Looking for owner:", OWNER_EMAIL_HINT);

  const owner = await findOwnerUser();
  if (!owner) {
    console.error("User not found. Create the account first in Admin → Users.");
    process.exit(1);
  }
  console.log("Owner:", owner.email, owner.id);

  let ws = await findWorkspaceForOwner(owner.id, owner.email ?? "");
  if (!ws) {
    ws = await createWorkspace(owner);
    console.log("Created workspace:", ws.name, ws.id);
  } else {
    console.log("Workspace:", ws.name, ws.id);
  }

  const { data: settings } = await sb
    .from("workspace_settings")
    .select("active_modules, plan_tier")
    .eq("workspace_id", ws.id)
    .maybeSingle();

  const currentModules = new Set((settings?.active_modules ?? []) );
  for (const m of MODULES_TO_ENSURE) currentModules.add(m);
  const mergedModules = [...currentModules];

  const { error: settingsErr } = await sb.from("workspace_settings").upsert(
    {
      workspace_id: ws.id,
      active_modules: mergedModules,
      plan_tier: PLAN_TIER,
      modules_updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id" },
  );
  if (settingsErr) throw new Error(`workspace_settings: ${settingsErr.message}`);

  const { error: subErr } = await sb.from("workspace_subscriptions").upsert(
    {
      workspace_id: ws.id,
      package_key: PACKAGE_KEY,
      subscription_status: "active",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id" },
  );
  if (subErr) throw new Error(`workspace_subscriptions: ${subErr.message}`);

  await sb.from("profiles").update({ default_workspace_id: ws.id }).eq("user_id", owner.id);

  console.log("\n✅ Done");
  console.log("  Workspace:", ws.name, `(${ws.id})`);
  console.log("  Owner:", owner.email);
  console.log("  Package:", PACKAGE_KEY);
  console.log("  Plan tier:", PLAN_TIER);
  console.log("  Modules:", mergedModules.join(", "));
  console.log("\nAsk the client to log out and back in to refresh the sidebar.");
}

main().catch((e) => {
  console.error("Failed:", e.message ?? e);
  process.exit(1);
});
