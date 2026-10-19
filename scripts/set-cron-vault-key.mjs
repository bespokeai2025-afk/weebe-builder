// Store SUPABASE_SERVICE_ROLE_KEY (from .env) in Supabase Vault as `cron_service_role_key`, which
// the pg_cron jobs send as their Bearer token (see migration 20261017010000).
// Creates the secret, or replaces it if it already exists. Never prints the key.
//
//   node scripts/set-cron-vault-key.mjs
//
// Needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ACCESS_TOKEN in .env.
try {
  process.loadEnvFile(".env");
} catch {
  // Fall back to the environment.
}

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!url || !key || !token) {
  console.error("Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ACCESS_TOKEN");
  process.exit(1);
}
if (key.length < 100) {
  console.error(`SUPABASE_SERVICE_ROLE_KEY looks wrong (${key.length} characters) — expected the long service_role key.`);
  process.exit(1);
}

const ref = new URL(url).host.split(".")[0];
const literal = `'${key.replace(/'/g, "''")}'`;
const sql = `
  do $$
  declare v_id uuid;
  begin
    select id into v_id from vault.secrets where name = 'cron_service_role_key';
    if v_id is null then
      perform vault.create_secret(${literal}, 'cron_service_role_key');
    else
      perform vault.update_secret(v_id, ${literal});
    end if;
  end $$;
  select length(decrypted_secret) as length from vault.decrypted_secrets where name = 'cron_service_role_key';
`;

const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: sql }),
});
const text = await res.text();
if (!res.ok) {
  console.error(`Failed (HTTP ${res.status}): ${text.slice(0, 300)}`);
  process.exit(1);
}
const stored = JSON.parse(text)?.[0]?.length;
console.log(
  stored === key.length
    ? `Stored cron_service_role_key (${stored} characters). Cron calls should return 200 within ~5 minutes.`
    : `Stored, but length ${stored} ≠ ${key.length} — check the result.`,
);
