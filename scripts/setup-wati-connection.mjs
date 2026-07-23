/**
 * One-shot WATI setup: apply migrations, connect tenant, register webhook, sync templates.
 *
 * Required env (from .env or shell):
 *   SUPABASE_URL / VITE_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   SUPABASE_ACCESS_TOKEN (for migrations)
 *   WATI_API_KEY
 *   WATI_TENANT_ID
 *
 * Optional:
 *   WATI_WORKSPACE_ID — target workspace UUID (auto-detects "avenue"/"elite" name if unset)
 *   PUBLIC_APP_URL / VITE_PUBLIC_APP_URL — webhook base (default https://webeereceptionist.com)
 *
 * Run: node scripts/setup-wati-connection.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { refreshSchemaMap } from "./lib/refresh-schema-map.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = [
  "20260614000000_wati_connector.sql",
  "20260720120000_wati_leads_crm.sql",
];
const WBAH_WORKSPACE_ID = "5cb750b6-fabf-4e84-9b92-740df1cd8d53";
const LOCK = "SET lock_timeout='8s';\n";

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
const MGMT_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const WATI_API_KEY = process.env.WATI_API_KEY?.trim();
const WATI_TENANT_ID = process.env.WATI_TENANT_ID?.trim();
const WORKSPACE_ID = process.env.WATI_WORKSPACE_ID?.trim();
const projectRef = SUPABASE_URL?.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];

function webhookOrigin() {
  const replit = process.env.REPLIT_DEV_DOMAIN?.trim();
  if (replit) return `https://${replit}`;
  return (
    process.env.PUBLIC_APP_URL?.trim() ||
    process.env.VITE_PUBLIC_APP_URL?.trim() ||
    "https://webeereceptionist.com"
  ).replace(/\/$/, "");
}

function watiBase(tenantId) {
  return `https://live-mt-server.wati.io/${tenantId}/api/v1`;
}

async function applyMigration(file) {
  const sql = LOCK + readFileSync(resolve(__dir, "../supabase/migrations", file), "utf8");
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${MGMT_TOKEN}`,
    },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status} ${text.slice(0, 400)}`);
  console.log(`✅ migration applied: ${file}`);
}

async function watiGet(path) {
  const res = await fetch(`${watiBase(WATI_TENANT_ID)}${path}`, {
    headers: {
      Authorization: `Bearer ${WATI_API_KEY}`,
      "Content-Type": "application/json",
    },
  });
  const text = await res.text();
  if (res.status === 401) {
    throw new Error(
      "WATI returned 401 Unauthorized. In WATI → API Docs, copy a fresh Bearer token (must include contacts:read). " +
        "If you changed your WATI password or logged out everywhere, the old token is invalid.",
    );
  }
  if (!res.ok) throw new Error(`WATI ${path} → HTTP ${res.status}: ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function registerWebhook(workspaceId) {
  const webhookUrl = `${webhookOrigin()}/api/webhook/wati-inbound?workspace=${workspaceId}`;
  const res = await fetch(`${watiBase(WATI_TENANT_ID)}/updateWebhook`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WATI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ webhookUrl }),
  });
  const text = await res.text();
  if (!res.ok) {
    console.warn(`⚠️  webhook register failed (${res.status}): ${text.slice(0, 300)}`);
    console.warn(`   Paste manually in WATI → Settings → Webhook:\n   ${webhookUrl}`);
    return { ok: false, webhookUrl };
  }
  console.log(`✅ webhook registered: ${webhookUrl}`);
  return { ok: true, webhookUrl };
}

async function resolveWorkspaceId(sb) {
  if (WORKSPACE_ID) return WORKSPACE_ID;

  const { data, error } = await sb
    .from("workspaces")
    .select("id,name,slug")
    .neq("id", WBAH_WORKSPACE_ID)
    .order("name");

  if (error) throw new Error(`workspaces query failed: ${error.message}`);

  const rows = data ?? [];
  const match = rows.filter((w) => {
    const hay = `${w.name ?? ""} ${w.slug ?? ""}`.toLowerCase();
    return hay.includes("avenue") || hay.includes("elite");
  });

  if (match.length === 1) {
    console.log(`Using workspace: ${match[0].name} (${match[0].id})`);
    return match[0].id;
  }

  if (match.length > 1) {
    console.error("Multiple matching workspaces — set WATI_WORKSPACE_ID:");
    for (const w of match) console.error(`  ${w.id}  ${w.name}  (${w.slug})`);
    process.exit(1);
  }

  if (rows.length === 1) {
    console.log(`Using only non-WBAH workspace: ${rows[0].name} (${rows[0].id})`);
    return rows[0].id;
  }

  console.error("Could not auto-detect workspace. Set WATI_WORKSPACE_ID. Available:");
  for (const w of rows.slice(0, 20)) console.error(`  ${w.id}  ${w.name}  (${w.slug})`);
  process.exit(1);
}

async function syncTemplates(sb, workspaceId) {
  const json = await watiGet("/getMessageTemplates");
  const templates = json?.messageTemplates ?? json?.templates ?? [];
  let count = 0;
  for (const t of templates) {
    const { error } = await sb.from("wati_templates").upsert(
      {
        workspace_id: workspaceId,
        wati_template_id: String(t.id ?? t.elementName ?? t.name),
        name: t.elementName ?? t.name ?? "Untitled",
        status: t.status,
        language: t.language,
        category: t.category,
          body_preview: t.body ?? t.bodyOriginal ?? null,
          rejection_reason: t.rejectedReason ?? t.rejectionReason ?? null,
          quality: t.quality != null ? String(t.quality) : null,
          last_status_at: t.lastModified ?? new Date().toISOString(),
          wati_modified_at: t.lastModified ?? null,
          components: t.components
          ? t.components
          : {
              customParams: t.customParams ?? null,
              body: t.body ?? null,
              bodyOriginal: t.bodyOriginal ?? null,
              header: t.header ?? null,
            },
        synced_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id,wati_template_id" },
    );
    if (error) throw new Error(`template upsert: ${error.message}`);
    count++;
  }
  await sb.from("wati_sync_logs").insert({
    workspace_id: workspaceId,
    sync_type: "templates",
    status: "success",
    records_synced: count,
  });
  console.log(`✅ synced ${count} templates`);
}

async function main() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error("Missing SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
    process.exit(2);
  }
  if (!WATI_API_KEY || !WATI_TENANT_ID) {
    console.error("Missing WATI_API_KEY and WATI_TENANT_ID in .env");
    process.exit(2);
  }

  console.log("Testing WATI API…");
  await watiGet("/getContacts?pageSize=1");
  console.log("✅ WATI API reachable");

  if (MGMT_TOKEN && projectRef) {
    for (const file of MIGRATIONS) {
      try {
        await applyMigration(file);
      } catch (e) {
        if (String(e.message).includes("already exists")) {
          console.log(`⏭️  ${file} (already applied)`);
        } else {
          throw e;
        }
      }
    }
    refreshSchemaMap();
  } else {
    console.warn("⚠️  SUPABASE_ACCESS_TOKEN not set — skipping migrations (apply SQL manually if needed)");
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const workspaceId = await resolveWorkspaceId(sb);

  const now = new Date().toISOString();
  const { error: upsertErr } = await sb.from("wati_connections").upsert(
    {
      workspace_id: workspaceId,
      api_key: WATI_API_KEY,
      tenant_id: WATI_TENANT_ID,
      webhook_secret: null,
      status: "connected",
      last_tested_at: now,
      error_message: null,
      updated_at: now,
    },
    { onConflict: "workspace_id" },
  );
  if (upsertErr) throw new Error(`wati_connections upsert: ${upsertErr.message}`);
  console.log(`✅ WATI connected for workspace ${workspaceId}`);

  await sb.from("wati_sync_logs").insert({
    workspace_id: workspaceId,
    sync_type: "test",
    status: "success",
    records_synced: 0,
  });

  await registerWebhook(workspaceId);
  await syncTemplates(sb, workspaceId);

  console.log("\nDone. Open WhatsApp → Settings → WATI in that workspace to verify.");
}

main().catch((e) => {
  console.error("❌", e.message);
  process.exit(1);
});
