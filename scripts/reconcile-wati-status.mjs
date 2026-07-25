/**
 * Backfill WATI delivery/read status via WATI V3 conversation API (webhook fallback).
 *
 *   node scripts/reconcile-wati-status.mjs
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
const workspaceId =
  process.env.WATI_WORKSPACE_ID?.trim() || "9bc09fc9-5841-40d6-94a8-d3074a15f988";

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(2);
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

function mapStatus(raw) {
  const s = String(raw ?? "").toLowerCase();
  if (s.includes("read")) return "read";
  if (s.includes("deliver")) return "delivered";
  if (s.includes("fail")) return "failed";
  if (s.includes("sent")) return "sent";
  return null;
}

const order = { failed: -1, queued: 0, sent: 1, delivered: 2, read: 3 };
function shouldApply(cur, next) {
  if (next === "failed") return cur !== "read" && cur !== "delivered";
  return (order[next] ?? 0) > (order[cur] ?? 0);
}

const { data: conn } = await sb
  .from("wati_connections")
  .select("api_key, tenant_id, api_host")
  .eq("workspace_id", workspaceId)
  .eq("status", "connected")
  .maybeSingle();

if (!conn?.api_key) {
  console.error("No connected WATI connection for workspace");
  process.exit(1);
}

const host = (conn.api_host || "eu-api.wati.io").replace(/^https?:\/\//, "").split("/")[0];
const headers = {
  Authorization: `Bearer ${conn.api_key.replace(/^Bearer\s+/i, "")}`,
  "Content-Type": "application/json",
};

const { data: msgs } = await sb
  .from("whatsapp_messages")
  .select("id, contact_phone, status, campaign_id, external_id")
  .eq("workspace_id", workspaceId)
  .eq("direction", "outbound")
  .eq("provider", "wati")
  .in("status", ["sent", "delivered"])
  .order("sent_at", { ascending: false })
  .limit(100);

let updated = 0;

for (const msg of msgs ?? []) {
  const phone = String(msg.contact_phone ?? "").replace(/\D/g, "");
  if (!phone) continue;

  const variants = [phone];
  if (phone.startsWith("44") && phone.length > 10) variants.push(phone.slice(2));
  if (!phone.startsWith("44") && phone.length >= 10) variants.push(`44${phone}`);

  let applied = false;
  for (const variant of variants) {
    const url = `https://${host}/${conn.tenant_id}/api/ext/v3/conversations/${encodeURIComponent(variant)}/messages?page_number=1&page_size=20`;
    const res = await fetch(url, { headers });
    if (!res.ok) continue;

    const json = await res.json();
    const list = json.message_list ?? json.messages ?? [];
    const outbound = list.filter((m) => m.owner !== false && String(m.type ?? "").toLowerCase() !== "ticket");
    const localId = String(msg.external_id ?? "");
    const match =
      (localId
        ? outbound.find(
            (m) =>
              String(m.local_message_id ?? m.localMessageId ?? "") === localId ||
              String(m.local_message_id ?? m.localMessageId ?? "").endsWith(localId),
          )
        : null) ?? outbound[0];

    if (!match) continue;

    const newStatus = mapStatus(match.statusString ?? match.status);
    if (!newStatus || !shouldApply(msg.status, newStatus)) {
      applied = true;
      break;
    }

    const patch = { status: newStatus };
    const wamid = String(match.whatsapp_message_id ?? match.whatsappMessageId ?? "").trim();
    if (wamid) patch.whatsapp_message_id = wamid;

    await sb.from("whatsapp_messages").update(patch).eq("id", msg.id);

    if (msg.campaign_id) {
      const { data: campaignMsgs } = await sb
        .from("whatsapp_messages")
        .select("status")
        .eq("campaign_id", msg.campaign_id)
        .eq("direction", "outbound");
      const outboundRows = campaignMsgs ?? [];
      await sb
        .from("whatsapp_campaigns")
        .update({
          stats: {
            sent: outboundRows.length,
            delivered: outboundRows.filter((m) => ["delivered", "read"].includes(m.status)).length,
            read: outboundRows.filter((m) => m.status === "read").length,
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", msg.campaign_id);
    }

    updated++;
    applied = true;
    break;
  }

  if (!applied) {
    console.warn("No V3 match for", msg.contact_phone, msg.external_id);
  }
}

console.log("Updated rows:", updated);

const { data: all } = await sb
  .from("whatsapp_messages")
  .select("direction, status")
  .eq("workspace_id", workspaceId);

const outbound = (all ?? []).filter((m) => m.direction === "outbound");
const inbound = (all ?? []).filter((m) => m.direction === "inbound");
console.log("Outbound status:", {
  sent: outbound.filter((m) => m.status === "sent").length,
  delivered: outbound.filter((m) => m.status === "delivered").length,
  read: outbound.filter((m) => m.status === "read").length,
});
console.log("Inbound messages:", inbound.length);
