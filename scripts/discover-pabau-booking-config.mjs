/**
 * Step 3 — Discover Pabau IDs needed for Dr Nyla / DNR booking config.
 *
 *   node --env-file=.env scripts/discover-pabau-booking-config.mjs
 *
 * Pulls locations, services, staff, sample appointments — maps Castlerock House
 * and consult-related services where possible.
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));

function loadDotEnv() {
  try {
    for (const line of readFileSync(resolve(__dir, "../.env"), "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq < 0) continue;
      const k = t.slice(0, eq).trim();
      let v = t.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (!process.env[k]) process.env[k] = v;
    }
  } catch {
    /* optional */
  }
}

loadDotEnv();

const key = process.env.PABAU_API_KEY?.trim();
if (!key) {
  console.error("Missing PABAU_API_KEY in .env");
  process.exit(1);
}

const base = (process.env.PABAU_API_BASE ?? `https://api.oauth.pabau.com/${key}`).replace(/\/+$/, "");
const headers = { Accept: "application/json" };

const CASTLEROCK_HINTS = ["castlerock", "castle rock", "alderley", "wilmslow", "sk9 7ql", "sk97ql", "medispa cheshire", "cheshire"];

function listItems(json) {
  if (Array.isArray(json)) return json;
  if (!json || typeof json !== "object") return [];
  for (const k of [
    "locations",
    "service_categories",
    "services",
    "staff",
    "users",
    "practitioners",
    "appointments",
    "leads",
    "data",
    "items",
  ]) {
    const v = json[k];
    if (Array.isArray(v)) return v;
  }
  return [];
}

async function get(path) {
  const res = await fetch(`${base}${path}`, { headers });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { _raw: text.slice(0, 500) };
  }
  return { path, status: res.status, json };
}

function pickName(row) {
  if (!row || typeof row !== "object") return "";
  const o = row;
  return String(
    o.name ??
      o.location_name ??
      o.service_name ??
      o.service ??
      o.title ??
      o.full_name ??
      o.practitioner_name ??
      `${o.first_name ?? ""} ${o.last_name ?? ""}`.trim() ??
      o.id ??
      "",
  );
}

function matchesCastlerock(name) {
  const n = name.toLowerCase();
  return CASTLEROCK_HINTS.some((h) => n.includes(h));
}

const PROBE_PATHS = [
  "/locations",
  "/categories/services",
  "/services",
  "/staff",
  "/users",
  "/practitioners",
  "/team",
  "/appointments",
];

console.log("=== Pabau booking discovery (DNR / Dr Nyla) ===\n");
console.log(`Base: ${base.replace(key, "••••")}\n`);

const report = {
  discoveredAt: new Date().toISOString(),
  endpoints: {},
  castlerockCandidates: [],
  consultServiceCandidates: [],
  practitionersFromAppointments: new Map(),
  stillNeedFromClinic: [
    "Which weekday is consult day at Castlerock House?",
    "Which practitioner / booking column should the AI fill?",
    "Exact consult service_id and slot duration (minutes)?",
    "Human escalation phone number during Mon–Sat 10:00–20:00?",
    "How to search existing patients by phone (Pabau UI method)?",
    "Confirm API key has Clients + Appointments WRITE enabled.",
  ],
};

for (const path of PROBE_PATHS) {
  const r = await get(path);
  report.endpoints[path] = { status: r.status, ok: r.status === 200 };
  const items = listItems(r.json);
  console.log(`${r.status} GET ${path} → ${items.length} item(s)`);

  if (r.status !== 200) continue;

  for (const item of items.slice(0, 30)) {
    const name = pickName(item);
    const id = item?.id ?? item?.location_id ?? item?.service_id ?? item?.practitioner_id;
    if (matchesCastlerock(name)) {
      report.castlerockCandidates.push({ source: path, id, name });
      console.log(`  ★ Castlerock match: [${id}] ${name}`);
    }
    if (/consult/i.test(name)) {
      report.consultServiceCandidates.push({ source: path, id, name });
      console.log(`  ★ Consult match: [${id}] ${name}`);
    }
  }

  if (path === "/appointments") {
    for (const appt of items.slice(0, 50)) {
      const details = appt?.details ?? appt;
      const pract = details?.practitioner ?? appt?.practitioner;
      const pid = pract?.practitioner_id ?? pract?.id;
      const pname = pract?.practitioner_name ?? pract?.name;
      if (pid) report.practitionersFromAppointments.set(String(pid), pname ?? String(pid));

      for (const svc of appt?.service ?? []) {
        const sname = svc?.service ?? "";
        if (/consult/i.test(sname)) {
          report.consultServiceCandidates.push({
            source: "appointments.sample",
            id: svc?.service_id,
            name: sname,
          });
        }
      }
    }
  }
}

console.log("\n--- Practitioners seen in recent appointments ---");
for (const [id, name] of report.practitionersFromAppointments) {
  console.log(`  [${id}] ${name}`);
}

console.log("\n--- Still need from clinic (Emma) ---");
for (const q of report.stillNeedFromClinic) console.log(`  • ${q}`);

const outPath = resolve(__dir, "../scripts/output/pabau-booking-discovery.json");
try {
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        ...report,
        practitionersFromAppointments: Object.fromEntries(report.practitionersFromAppointments),
      },
      null,
      2,
    ),
  );
  console.log(`\nWrote ${outPath}`);
} catch (e) {
  console.warn("Could not write JSON report:", e?.message);
}

console.log("\nNext: fill scripts/dnr-pabau-booking-config.template.json and wire Retell tools.");
