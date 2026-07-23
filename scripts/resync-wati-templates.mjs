/**
 * Re-sync WATI templates into wati_templates (fixes missing customParams / body for param mapping).
 *
 *   WATI_WORKSPACE_ID=9bc09fc9-5841-40d6-94a8-d3074a15f988 node scripts/resync-wati-templates.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));

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

function watiTemplateLanguage(raw) {
  if (raw == null) return null;
  if (typeof raw === "string") return raw;
  if (typeof raw === "object") {
    return String(raw.value ?? raw.key ?? raw.text ?? "").trim() || null;
  }
  return String(raw);
}

function watiTemplateRowFromApi(workspaceId, t) {
  const modifiedAt = t.lastModified ?? t.last_modified ?? null;
  const now = new Date().toISOString();
  const body = t.body ?? t.bodyOriginal ?? null;
  return {
    workspace_id: workspaceId,
    wati_template_id: String(t.id ?? t.elementName ?? t.name),
    name: t.elementName ?? t.name ?? "Untitled",
    status: t.status != null ? String(t.status) : null,
    status_code: typeof t.statusCode === "number" ? t.statusCode : null,
    language: watiTemplateLanguage(t.language),
    category: t.category != null ? String(t.category) : null,
    components: {
      customParams: t.customParams ?? null,
      body: t.body ?? null,
      bodyOriginal: t.bodyOriginal ?? null,
      header: t.header ?? null,
    },
    body_preview: typeof body === "string" ? body.trim() : null,
    rejection_reason: t.rejectedReason ?? t.rejectionReason ?? null,
    quality: t.quality != null ? String(t.quality) : null,
    last_status_at: modifiedAt ? String(modifiedAt) : now,
    wati_modified_at: modifiedAt ? String(modifiedAt) : null,
    synced_at: now,
  };
}

loadDotEnv();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const workspaceId = process.env.WATI_WORKSPACE_ID?.trim() || "9bc09fc9-5841-40d6-94a8-d3074a15f988";

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(2);
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const { data: conn, error: connErr } = await sb
  .from("wati_connections")
  .select("api_key, tenant_id, api_host")
  .eq("workspace_id", workspaceId)
  .eq("status", "connected")
  .maybeSingle();

if (connErr || !conn?.api_key) {
  console.error("No connected WATI row for workspace", workspaceId);
  process.exit(1);
}

const host = (conn.api_host || "eu-api.wati.io").replace(/^https?:\/\//, "").split("/")[0];
const url = `https://${host}/${conn.tenant_id}/api/v1/getMessageTemplates`;
const res = await fetch(url, {
  headers: {
    Authorization: `Bearer ${conn.api_key.replace(/^Bearer\s+/i, "")}`,
    "Content-Type": "application/json",
  },
});

if (!res.ok) {
  console.error(`WATI getMessageTemplates HTTP ${res.status}`);
  process.exit(1);
}

const json = await res.json();
const templates = json?.messageTemplates ?? json?.templates ?? [];
let count = 0;

for (const t of templates) {
  const row = watiTemplateRowFromApi(workspaceId, t);
  const { error } = await sb.from("wati_templates").upsert(row, {
    onConflict: "workspace_id,wati_template_id",
  });
  if (error) throw new Error(error.message);
  count++;
  const params = row.components?.customParams?.map((p) => p.paramName).filter(Boolean) ?? [];
  console.log(`  ${row.name}: ${row.status} params=[${params.join(", ")}]`);
}

console.log(`\n✅ synced ${count} templates for workspace ${workspaceId}`);
