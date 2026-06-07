/**
 * Verification helper for agent workflow plan.
 * Usage: npx tsx scripts/verify-agent-workflow.ts
 */
import { createClient } from "@supabase/supabase-js";
import { getDeployMode, getRetailWorkspaceId, getRetailRetellApiKey } from "../src/lib/deploy/config.server";

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  console.log("deploy_mode:", getDeployMode());
  console.log("retail_workspace_id_valid:", getRetailWorkspaceId() ?? "(none)");
  console.log("retail_retell_key_set:", getRetailRetellApiKey() ? "yes" : "no");

  const c = createClient(url, key, { auth: { persistSession: false } });
  const { count, error } = await c
    .from("agent_templates")
    .select("*", { count: "exact", head: true })
    .eq("scope", "global");
  if (error) throw error;
  console.log("global_templates_count:", count);

  const { data: ws } = await c.from("workspaces").select("id,slug,name").eq("slug", "retail").maybeSingle();
  if (ws) {
    const { count: m } = await c
      .from("workspace_members")
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", ws.id);
    console.log("retail_workspace:", ws.id, ws.name);
    console.log("retail_member_count:", m);
  } else {
    console.log("retail_workspace: none");
  }

  const legacyIds = [
    "6b37e1a3-1d00-4e9d-ace6-febd9c386d06",
    "a2c5d862-d784-4513-a245-6432ef1f024f",
  ];
  const { data: sample } = await c
    .from("agent_templates")
    .select("id,name")
    .in("id", legacyIds);
  console.log("legacy_id_samples_found:", (sample ?? []).length, "of 2 checked");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
