/**
 * Import global agent_templates from legacy Supabase or a JSON export file.
 *
 * Usage:
 *   # From legacy project (full rows including flow_data):
 *   LEGACY_SUPABASE_URL=... LEGACY_SUPABASE_SERVICE_ROLE_KEY=... \\
 *     npx tsx scripts/seed-agent-templates.ts
 *
 *   # From exported JSON array:
 *   npx tsx scripts/seed-agent-templates.ts --file=./agent-templates.global.json
 *
 * Target: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (current merged project)
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const TARGET_URL = process.env.SUPABASE_URL!;
const TARGET_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const LEGACY_URL = process.env.LEGACY_SUPABASE_URL?.trim();
const LEGACY_KEY = process.env.LEGACY_SUPABASE_SERVICE_ROLE_KEY?.trim();

const fileArg = process.argv.find((a) => a.startsWith("--file="));
const jsonPath = fileArg?.slice("--file=".length);

if (!TARGET_URL || !TARGET_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

type TemplateRow = {
  id: string;
  scope: string;
  owner_user_id: string | null;
  name: string;
  description: string;
  flow_data: unknown;
  settings: unknown;
  variables: unknown;
  created_at?: string;
  updated_at?: string;
};

const target = createClient(TARGET_URL, TARGET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function loadRows(): Promise<TemplateRow[]> {
  if (jsonPath) {
    const raw = readFileSync(jsonPath, "utf8");
    const parsed = JSON.parse(raw) as TemplateRow[] | { rows: TemplateRow[] };
    return Array.isArray(parsed) ? parsed : parsed.rows;
  }

  if (!LEGACY_URL || !LEGACY_KEY) {
    console.error(
      "Provide LEGACY_SUPABASE_URL + LEGACY_SUPABASE_SERVICE_ROLE_KEY, or --file=export.json",
    );
    process.exit(1);
  }

  const legacy = createClient(LEGACY_URL, LEGACY_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await legacy
    .from("agent_templates")
    .select(
      "id, scope, owner_user_id, name, description, flow_data, settings, variables, created_at, updated_at",
    )
    .eq("scope", "global")
    .order("created_at", { ascending: true });

  if (error) throw error;
  return (data ?? []) as TemplateRow[];
}

async function main() {
  const rows = await loadRows();
  if (rows.length === 0) {
    console.error("[templates] No global templates to import");
    process.exit(1);
  }

  console.log(`[templates] Upserting ${rows.length} global template(s)...`);
  const retailWs = process.env.RETAIL_WORKSPACE_ID?.trim();

  for (const row of rows) {
    const payload = {
      id: row.id,
      scope: "global" as const,
      owner_user_id: null,
      name: row.name,
      description: row.description ?? "",
      flow_data: row.flow_data ?? {},
      settings: row.settings ?? {},
      variables: row.variables ?? [],
      ...(retailWs ? { workspace_id: retailWs } : {}),
      ...(row.created_at ? { created_at: row.created_at } : {}),
      ...(row.updated_at ? { updated_at: row.updated_at } : {}),
    };

    const { error } = await target.from("agent_templates").upsert(payload, { onConflict: "id" });
    if (error) {
      console.error(`[templates] Failed ${row.id} (${row.name}):`, error.message);
      process.exit(1);
    }
    console.log(`[templates] OK ${row.name}`);
  }

  console.log(`[templates] Done. ${rows.length} global template(s) in target DB.`);
}

main().catch((err) => {
  console.error("[templates] Failed:", err);
  process.exit(1);
});
