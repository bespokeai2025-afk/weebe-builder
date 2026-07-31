/**
 * Add JVC-style dummy property fields to YOUR Arjav test contact only.
 *
 *   node scripts/seed-buzzchat-test-contacts.mjs
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
      const key = t.slice(0, i).trim();
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

function parseNotesToMeta(notes) {
  const out = {};
  if (!notes?.trim()) return out;
  for (const part of notes.split(" · ")) {
    const i = part.indexOf(": ");
    if (i > 0) {
      const k = part.slice(0, i).trim();
      const v = part.slice(i + 2).trim();
      if (k && v) out[k] = v;
    }
  }
  return out;
}

/** Dummy JVC property row — notes match CSV import format. */
function dummyNotesForContact(phone, name) {
  const mobile2 = phone.replace(/\D/g, "").length >= 10 ? "971501234567" : "";
  const parts = [
    `Mobile 1: ${phone}`,
    mobile2 ? `Mobile 2: ${mobile2}` : null,
    "Project: Jumeirah Village Circle (JVC)",
    "Building: Diamond Views 1 Block A",
    "Date: 1-Apr-2024",
    "Master Location: Jumeirah Village Circle (JVC)",
    "Master Project: JVC District 14",
    "property_number: 319A",
    "UnitNumber: 319A",
    "Completion Status: ready",
    "Property Type: Apartments",
    "Usage: Residential",
    "beds: 2",
    "Sub Type: flat",
    "Transaction Amount: 380,000",
    "Size: 37.35",
    "Municipality No: 681",
    "Municipality Sub No: 7166",
    "LandNumber: 471",
    `Owner Name: ${name}`,
  ].filter(Boolean);
  return parts.join(" · ");
}

/** Phones from the old bulk seed — remove if present. */
const REMOVE_PHONES = [
  "971552100217",
  "971501112233",
  "971529998877",
  "971567778899",
  "971544433221",
];

loadDotEnv();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const workspaceId =
  process.env.WATI_WORKSPACE_ID?.trim() || "9bc09fc9-5841-40d6-94a8-d3074a15f988";

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(2);
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const now = new Date().toISOString();

// Remove bulk test contacts (not Arjav)
for (const phone of REMOVE_PHONES) {
  await sb.from("whatsapp_contacts").delete().eq("workspace_id", workspaceId).eq("phone", phone);
  await sb.from("leads").delete().eq("workspace_id", workspaceId).eq("phone", phone);
}

const { data: arjavRows, error: findErr } = await sb
  .from("whatsapp_contacts")
  .select("id, name, phone")
  .eq("workspace_id", workspaceId)
  .ilike("name", "%arjav%");

if (findErr) {
  console.error("Could not find contacts:", findErr.message);
  process.exit(1);
}

if (!arjavRows?.length) {
  console.error('No contact with name containing "Arjav" in this workspace.');
  console.error("Add your test contact in Buzzchat → Contacts first, then re-run.");
  process.exit(1);
}

for (const row of arjavRows) {
  const name = row.name?.trim() || "Arjav";
  const phone = String(row.phone ?? "").trim();
  const notes = dummyNotesForContact(phone, name);
  const import_meta = parseNotesToMeta(notes);

  const { error: cErr } = await sb
    .from("whatsapp_contacts")
    .update({
      notes,
      source: "import",
      updated_at: now,
    })
    .eq("id", row.id);

  if (cErr) {
    console.error(`Contact update failed (${phone}):`, cErr.message);
    continue;
  }

  const { data: lead } = await sb
    .from("leads")
    .select("id, meta")
    .eq("workspace_id", workspaceId)
    .eq("phone", phone)
    .maybeSingle();

  const leadPayload = {
    full_name: name,
    notes,
    whatsapp_opt_in: true,
    meta: {
      ...(typeof lead?.meta === "object" && lead.meta ? lead.meta : {}),
      ...import_meta,
    },
    updated_at: now,
  };

  if (lead?.id) {
    await sb.from("leads").update(leadPayload).eq("id", lead.id);
  } else {
    await sb.from("leads").insert({
      workspace_id: workspaceId,
      phone,
      source: "import",
      ...leadPayload,
    });
  }

  console.log(`✓ Updated ${name} (${phone}) with dummy JVC property data`);
}

console.log("\nRefresh Buzzchat → Contacts. Use Campaign → Contacts to test sport_city mapping.");
