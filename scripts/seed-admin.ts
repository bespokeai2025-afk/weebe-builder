/**
 * Seed admin user script.
 *
 * Usage: SEED_ADMIN_EMAIL=admin@webespokeai.com npx tsx scripts/seed-admin.ts
 *
 * Reads SEED_ADMIN_EMAIL from env. If the user already exists in auth.users,
 * promotes their profile to user_type=admin. If not, creates the auth user
 * and the trigger auto-provisions profile + workspace.
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SEED_ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SEED_ADMIN_EMAIL) {
  console.error("Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or SEED_ADMIN_EMAIL");
  process.exit(1);
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  const { data: existing } = await supabaseAdmin
    .from("profiles")
    .select("id, user_id, email, user_type")
    .eq("email", SEED_ADMIN_EMAIL)
    .maybeSingle();

  if (existing) {
    if (existing.user_type === "admin") {
      console.log(`[seed] ${SEED_ADMIN_EMAIL} is already admin`);
      return;
    }
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ user_type: "admin" })
      .eq("id", existing.id);
    if (error) throw error;
    console.log(`[seed] ${SEED_ADMIN_EMAIL} promoted to admin`);
    return;
  }

  const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
    email: SEED_ADMIN_EMAIL,
    password: crypto.randomUUID() + "Ab1!",
    email_confirm: true,
  });
  if (error) throw error;
  if (!created.user) throw new Error("User creation returned no user");

  const { error: updateErr } = await supabaseAdmin
    .from("profiles")
    .update({ user_type: "admin" })
    .eq("user_id", created.user.id);
  if (updateErr) throw updateErr;

  console.log(`[seed] ${SEED_ADMIN_EMAIL} created and promoted to admin`);
  console.log(`[seed]   User ID: ${created.user.id}`);
  console.log(`[seed]   Set a password via Supabase dashboard or "Forgot password" flow`);
}

main().catch((err) => {
  console.error("[seed] Failed:", err);
  process.exit(1);
});
