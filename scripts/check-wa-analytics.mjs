/**
 * Diagnose WhatsApp / WATI analytics data for a workspace.
 *
 *   node scripts/check-wa-analytics.mjs
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

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

loadDotEnv();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const workspaceId = process.env.WATI_WORKSPACE_ID?.trim() || "9bc09fc9-5841-40d6-94a8-d3074a15f988";

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(2);
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

function countBy(rows, keyFn) {
  const m = {};
  for (const r of rows) {
    const k = keyFn(r);
    m[k] = (m[k] ?? 0) + 1;
  }
  return m;
}

console.log("Workspace:", workspaceId);
console.log("");

const { data: conn } = await sb
  .from("wati_connections")
  .select("status, tenant_id, api_host")
  .eq("workspace_id", workspaceId)
  .maybeSingle();
console.log("WATI connection:", conn ?? "none");

const { data: msgs, error: msgErr } = await sb
  .from("whatsapp_messages")
  .select("id, direction, status, provider, external_id, sent_at, campaign_id")
  .eq("workspace_id", workspaceId)
  .order("sent_at", { ascending: false })
  .limit(500);

if (msgErr) {
  console.error("whatsapp_messages error:", msgErr.message);
} else {
  const all = msgs ?? [];
  const outbound = all.filter((m) => m.direction === "outbound");
  const inbound = all.filter((m) => m.direction === "inbound");
  console.log("\n── whatsapp_messages (latest 500) ──");
  console.log("Total rows (sample):", all.length);
  console.log("Outbound:", outbound.length, "| Inbound:", inbound.length);
  console.log("By status (outbound):", countBy(outbound, (m) => m.status));
  console.log("By provider:", countBy(all, (m) => m.provider ?? "null"));
  console.log("With external_id:", outbound.filter((m) => m.external_id).length);
  console.log("With campaign_id:", outbound.filter((m) => m.campaign_id).length);
  if (outbound[0]) {
    console.log("Latest outbound:", {
      status: outbound[0].status,
      provider: outbound[0].provider,
      external_id: outbound[0].external_id,
      sent_at: outbound[0].sent_at,
    });
  }
}

const { data: campaigns } = await sb
  .from("whatsapp_campaigns")
  .select("id, name, status, provider, stats, updated_at")
  .eq("workspace_id", workspaceId)
  .order("updated_at", { ascending: false })
  .limit(20);

console.log("\n── whatsapp_campaigns ──");
console.log("Count:", campaigns?.length ?? 0);
for (const c of campaigns ?? []) {
  console.log(`  • ${c.name} [${c.status}] provider=${c.provider ?? "?"} stats=`, c.stats);
}

const { data: watiCamps } = await sb
  .from("wati_campaigns")
  .select("name, status, sent, delivered, read_count, failed, synced_at")
  .eq("workspace_id", workspaceId)
  .order("synced_at", { ascending: false })
  .limit(20);

console.log("\n── wati_campaigns (synced from WATI) ──");
console.log("Count:", watiCamps?.length ?? 0);
let wSent = 0,
  wDel = 0,
  wRead = 0;
for (const c of watiCamps ?? []) {
  wSent += c.sent ?? 0;
  wDel += c.delivered ?? 0;
  wRead += c.read_count ?? 0;
  console.log(`  • ${c.name} sent=${c.sent} delivered=${c.delivered} read=${c.read_count} failed=${c.failed}`);
}
console.log("WATI totals (synced):", { sent: wSent, delivered: wDel, read: wRead });

// Simulate getWAAnalytics
const { data: allMsgs } = await sb
  .from("whatsapp_messages")
  .select("direction, status, sent_at")
  .eq("workspace_id", workspaceId);

const outboundAll = (allMsgs ?? []).filter((m) => m.direction === "outbound");
const sent = outboundAll.length;
const delivered = outboundAll.filter((m) => ["delivered", "read"].includes(m.status)).length;
const read = outboundAll.filter((m) => m.status === "read").length;

console.log("\n── getWAAnalytics() would return ──");
console.log({
  total: (allMsgs ?? []).length,
  sent,
  delivered,
  read,
  responses: (allMsgs ?? []).filter((m) => m.direction === "inbound").length,
  convRate: sent > 0 ? Math.round(((allMsgs ?? []).filter((m) => m.direction === "inbound").length / sent) * 100) : 0,
});

console.log("\n── UI issue check ──");
const uiWouldShowEmpty = !allMsgs || allMsgs.length === 0;
console.log("WhatsAppAnalytics empty state?", uiWouldShowEmpty);
if (uiWouldShowEmpty && wSent > 0) {
  console.log("⚠️  BUG: UI shows 'No data yet' but WATI campaign sync has sent=", wSent);
}
if (sent > 0 && delivered === 0) {
  console.log("⚠️  Delivery/read webhooks may not be updating whatsapp_messages.status (all stuck at 'sent')");
}
