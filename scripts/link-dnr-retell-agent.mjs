/**
 * Link Retell agent agent_b2afcd65c127f79126ea57deb2 → DNR workspace in WEBEE.
 *
 *   node --env-file=.env scripts/link-dnr-retell-agent.mjs [ownerEmail]
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __dir = dirname(fileURLToPath(import.meta.url));
const RETELL_AGENT_ID = "agent_b2afcd65c127f79126ea57deb2";
const OWNER_HINT = process.argv[2]?.trim().toLowerCase() || "admin@dnrmedicalservices.com";

function loadDotEnv() {
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

loadDotEnv();

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

const { data: users } = await sb.auth.admin.listUsers({ perPage: 1000 });
const owner = users?.users?.find(
  (u) =>
    (u.email ?? "").toLowerCase() === OWNER_HINT ||
    (u.email ?? "").toLowerCase().includes("dnrmedical"),
);
if (!owner) {
  console.error("Owner user not found:", OWNER_HINT);
  process.exit(1);
}

const { data: members } = await sb
  .from("workspace_members")
  .select("workspace_id, workspaces(id, name, slug)")
  .eq("user_id", owner.id);

const ws =
  members?.find((m) => (m.workspaces?.name ?? "").toLowerCase().includes("dnr"))?.workspaces ??
  members?.find((m) => (m.workspaces?.name ?? "").toLowerCase().includes("nyla"))?.workspaces ??
  members?.[0]?.workspaces;

if (!ws) {
  console.error("No workspace for owner");
  process.exit(1);
}

const { data: existing } = await sb
  .from("agents")
  .select("id, name, retell_agent_id")
  .eq("workspace_id", ws.id)
  .eq("retell_agent_id", RETELL_AGENT_ID)
  .maybeSingle();

async function syncWorkspaceRetellKey(workspaceId) {
  const retellKey = (process.env.RETELL_API_KEY_DNR || process.env.RETELL_API_KEY)?.trim();
  if (!retellKey?.startsWith("key_")) return;
  const { error } = await sb
    .from("workspace_settings")
    .upsert(
      { workspace_id: workspaceId, retell_workspace_id: retellKey },
      { onConflict: "workspace_id" },
    );
  if (error) console.warn("  ⚠ workspace_settings retell key:", error.message);
  else console.log("  retell_workspace_id synced from RETELL_API_KEY_DNR");
}

if (existing) {
  await syncWorkspaceRetellKey(ws.id);
  console.log("✅ Already linked");
  console.log("  Workspace:", ws.name, ws.id);
  console.log("  Agent row:", existing.id, existing.name);
  process.exit(0);
}

const { data: row, error } = await sb
  .from("agents")
  .insert({
    user_id: owner.id,
    workspace_id: ws.id,
    name: "Dr Nyla Medispa — Cheshire Reception",
    agent_type: "receptionist",
    voice_provider: "RETELL",
    retell_agent_id: RETELL_AGENT_ID,
    deployment_mode: "RETELL",
    settings: {
      deployedRetellAgentId: RETELL_AGENT_ID,
      isLive: true,
      dashboardAgentType: "receptionist",
      booking: { enabled: true, provider: "pabau" },
      transferPhone: "+448081892587",
    },
  })
  .select("id")
  .single();

if (error) {
  console.error("Insert failed:", error.message);
  process.exit(1);
}

await syncWorkspaceRetellKey(ws.id);

console.log("✅ Linked Retell agent to WEBEE");
console.log("  Workspace:", ws.name, ws.id);
console.log("  WEBEE agents.id:", row.id);
console.log("  retell_agent_id:", RETELL_AGENT_ID);
