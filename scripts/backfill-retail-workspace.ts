/**
 * Provision (or find) the shared retail Supabase workspace and add all users as members.
 *
 * Usage:
 *   RETAIL_WORKSPACE_ID=<uuid> npx tsx scripts/backfill-retail-workspace.ts
 *   # or omit RETAIL_WORKSPACE_ID to create/find workspace slug "retail"
 *
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Optional: SEED_ADMIN_EMAIL — used as workspace owner when creating a new retail workspace
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const rawRetailId = process.env.RETAIL_WORKSPACE_ID?.trim();
const RETAIL_WORKSPACE_ID =
  rawRetailId && UUID_RE.test(rawRetailId) ? rawRetailId : undefined;
if (rawRetailId && !RETAIL_WORKSPACE_ID) {
  console.warn(`[retail] Ignoring invalid RETAIL_WORKSPACE_ID (expected UUID): ${rawRetailId}`);
}
const SEED_ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL?.trim();

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function findOrCreateRetailWorkspace(): Promise<string> {
  if (RETAIL_WORKSPACE_ID) {
    const { data, error } = await admin
      .from("workspaces")
      .select("id, name, slug")
      .eq("id", RETAIL_WORKSPACE_ID)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error(`RETAIL_WORKSPACE_ID not found: ${RETAIL_WORKSPACE_ID}`);
    console.log(`[retail] Using existing workspace: ${data.name} (${data.id})`);
    return data.id;
  }

  const { data: existing } = await admin
    .from("workspaces")
    .select("id, name, slug")
    .eq("slug", "retail")
    .maybeSingle();

  if (existing) {
    console.log(`[retail] Found workspace slug=retail: ${existing.id}`);
    return existing.id;
  }

  let ownerId: string | null = null;
  if (SEED_ADMIN_EMAIL) {
    const { data: prof } = await admin
      .from("profiles")
      .select("user_id")
      .eq("email", SEED_ADMIN_EMAIL)
      .maybeSingle();
    ownerId = prof?.user_id ?? null;
  }
  if (!ownerId) {
    const { data: anyOwner } = await admin
      .from("profiles")
      .select("user_id")
      .eq("user_type", "admin")
      .limit(1)
      .maybeSingle();
    ownerId = anyOwner?.user_id ?? null;
  }
  if (!ownerId) {
    const { data: first } = await admin.from("profiles").select("user_id").limit(1).maybeSingle();
    ownerId = first?.user_id ?? null;
  }
  if (!ownerId) throw new Error("No user found to own retail workspace. Create a user first.");

  const { data: created, error } = await admin
    .from("workspaces")
    .insert({ name: "Retail", slug: "retail", owner_id: ownerId })
    .select("id")
    .single();
  if (error) throw error;
  console.log(`[retail] Created workspace: ${created.id}`);
  return created.id;
}

async function main() {
  const workspaceId = await findOrCreateRetailWorkspace();

  const { data: profiles, error: profErr } = await admin.from("profiles").select("user_id");
  if (profErr) throw profErr;
  const userIds = (profiles ?? []).map((p) => p.user_id).filter(Boolean);
  console.log(`[retail] Backfilling ${userIds.length} users into workspace ${workspaceId}`);

  let added = 0;
  for (const userId of userIds) {
    const { data: existing } = await admin
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId)
      .maybeSingle();
    if (existing) continue;

    const { error } = await admin.from("workspace_members").insert({
      workspace_id: workspaceId,
      user_id: userId,
      role: "member",
    });
    if (error) {
      console.warn(`[retail] Skip ${userId}: ${error.message}`);
      continue;
    }
    added++;
  }

  console.log(`[retail] Added ${added} new memberships`);
  console.log(`[retail] Set in .env: RETAIL_WORKSPACE_ID="${workspaceId}"`);
}

main().catch((err) => {
  console.error("[retail] Failed:", err);
  process.exit(1);
});
