/**
 * Work out who is really bookable at Castlerock House, and when.
 *
 *   node --env-file=.env scripts/discover-pabau-shifts.mjs
 *
 * check_availability builds slots from location opening hours only, so it offers
 * times no clinician is rostered for and /appointments/create rejects them with
 * "There is no shift for this timeslot". Pabau's shift/rota endpoints all return
 * 403 on this API key, so the rota has to be inferred from real appointments:
 * whoever already has bookings at a given weekday/time demonstrably has a shift.
 *
 * Read-only — nothing here writes to Pabau.
 */
import { readFileSync } from "fs";
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
const CHESHIRE = 3526;

async function get(path) {
  const res = await fetch(`${base}${path}`, { headers });
  const text = await res.text();
  try {
    return { status: res.status, json: text ? JSON.parse(text) : null, text };
  } catch {
    return { status: res.status, json: null, text };
  }
}

// ── Pull as many appointments as the API will give us ─────────────────────────
const PAGING = [
  "/appointments?page_size=200",
  "/appointments?limit=200",
  "/appointments?per_page=200",
  "/appointments",
];

let appts = [];
let usedPath = "";
for (const path of PAGING) {
  const r = await get(path);
  const rows = r.json?.appointments ?? (Array.isArray(r.json) ? r.json : []);
  console.log(`${r.status} GET ${path} → ${rows.length} row(s) (total field: ${r.json?.total ?? "?"})`);
  if (rows.length > appts.length) {
    appts = rows;
    usedPath = path;
  }
}
console.log(`\nUsing ${usedPath} with ${appts.length} appointment(s)\n`);

// Dates live under a `dates` object, not on `details`.
function readAppt(row) {
  const d = row.details ?? {};
  const dates = row.dates ?? {};
  return {
    locationId: Number(d.location?.id ?? NaN),
    locationName: d.location?.name ?? "",
    practitionerId: d.practitioner?.practitioner_id ?? null,
    practitionerName: d.practitioner?.practitioner_name ?? "",
    startDate: String(dates.start_date ?? "").slice(0, 10),
    startTime: String(dates.start_time ?? "").slice(0, 5),
    status: d.appointment_status ?? "",
    service: row.service?.[0]?.service ?? "",
  };
}

if (appts[0]) {
  console.log("Sample parsed row:", JSON.stringify(readAppt(appts[0]), null, 2), "\n");
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const perPractitioner = new Map();

for (const row of appts) {
  const a = readAppt(row);
  if (a.locationId && a.locationId !== CHESHIRE) continue;
  if (!a.practitionerId) continue;
  const key2 = `${a.practitionerId}`;
  if (!perPractitioner.has(key2)) {
    perPractitioner.set(key2, { name: a.practitionerName, byDay: new Map(), dates: [] });
  }
  const entry = perPractitioner.get(key2);
  if (!a.startDate) continue;
  const parsed = Date.parse(`${a.startDate}T12:00:00Z`);
  const dow = Number.isNaN(parsed) ? "?" : DOW[new Date(parsed).getUTCDay()];
  if (!entry.byDay.has(dow)) entry.byDay.set(dow, []);
  entry.byDay.get(dow).push(a.startTime);
  entry.dates.push(`${a.startDate} ${a.startTime}`);
}

console.log("=== Cheshire practitioners with real bookings (proxy for shifts) ===");
if (perPractitioner.size === 0) {
  console.log("  none found — the appointment feed may not reach Cheshire rows");
}
for (const [id, { name, byDay, dates }] of perPractitioner) {
  console.log(`\n  [${id}] ${name} — ${dates.length} appointment(s)`);
  for (const [dow, times] of byDay) {
    const sorted = [...times].filter(Boolean).sort();
    console.log(`      ${dow}: ${sorted[0] ?? "?"}–${sorted[sorted.length - 1] ?? "?"} (${times.length})`);
  }
  const recent = dates.sort().slice(-4);
  console.log(`      latest: ${recent.join(", ")}`);
}
