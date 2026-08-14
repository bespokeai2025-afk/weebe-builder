/**
 * Find the earliest timeslot Pabau will actually accept, and for which employee.
 *
 *   ALLOW_WRITE=1 TEST_CONTACT_ID=42108668 \
 *     node --env-file=.env scripts/probe-pabau-booking-employee.mjs
 *
 * Pabau refuses a booking outside the assigned employee's rostered shift
 * ("There is no shift for this timeslot") and exposes no shift/rota endpoint on
 * this API key, so the rota can only be mapped by asking /appointments/create and
 * reading the refusals.
 *
 * A refused attempt creates nothing, so this walks candidates in chronological
 * order and STOPS at the first acceptance — the first accepted slot is therefore
 * the earliest bookable one. At most ONE real appointment is created, against a
 * throwaway test client, and its ids are printed for deletion.
 *
 * Candidate days per employee come from observed real bookings at Cheshire
 * (see scripts/discover-pabau-shifts.mjs).
 *
 * ALLOW_WRITE=1 is required so this cannot be run by accident.
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
if (process.env.ALLOW_WRITE !== "1") {
  console.error(
    "Refusing to run without ALLOW_WRITE=1 — this can create a real appointment in the live clinic calendar.",
  );
  process.exit(1);
}

const base = (process.env.PABAU_API_BASE ?? `https://api.oauth.pabau.com/${key}`).replace(/\/+$/, "");
const LOCATION = 3526;
const SERVICE_NAME = process.env.SERVICE_NAME ?? "Filler LG";
const HORIZON_DAYS = Number(process.env.HORIZON_DAYS ?? 120);

// Weekday + time windows each employee demonstrably works at Cheshire, taken
// from their existing appointments. Times are the ones actually seen.
const ALL_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Every half hour the clinic is open, for a fine-grained shift search. */
function openingGrid() {
  const times = [];
  for (let m = 10 * 60; m <= 19 * 60 + 30; m += 30) {
    times.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  }
  return times;
}

// EMPLOYEE_IDS / TIMES narrow the sweep to one employee across the full opening
// grid, which is what you want when checking whether a specific user has a rota.
const CANDIDATES = process.env.EMPLOYEE_IDS
  ? process.env.EMPLOYEE_IDS.split(",")
      .map((s) => Number(s.trim()))
      .filter(Number.isFinite)
      .map((employeeId) => ({
        employeeId,
        name: `employee ${employeeId}`,
        days: ALL_DAYS,
        times: process.env.TIMES ? process.env.TIMES.split(",").map((t) => t.trim()) : openingGrid(),
      }))
  : [
      { employeeId: 152257, name: "AI Receptionist", days: ALL_DAYS, times: ["11:00", "14:00"] },
      { employeeId: 142159, name: "Nurse Antonia", days: ["Wed", "Thu"], times: ["11:00", "14:00"] },
      { employeeId: 151801, name: "Therapist Anna", days: ["Tue", "Wed", "Thu", "Fri"], times: ["11:00", "14:00"] },
      { employeeId: 85515, name: "Therapist Ellie", days: ["Mon", "Tue"], times: ["11:00"] },
      { employeeId: 151940, name: "Therapist Kayleigh", days: ["Mon"], times: ["10:00"] },
    ];

async function api(path, init) {
  const res = await fetch(`${base}${path}`, init);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { _raw: text.slice(0, 300) };
  }
  return { status: res.status, json, text };
}

const jsonPost = (body) => ({
  method: "POST",
  headers: { Accept: "application/json", "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

// ── Service ──────────────────────────────────────────────────────────────────
const svcRes = await api("/services", { headers: { Accept: "application/json" } });
const service = (svcRes.json?.services ?? []).find(
  (s) => String(s.service_name ?? "").toLowerCase() === SERVICE_NAME.toLowerCase(),
);
if (!service) {
  console.error(`Service "${SERVICE_NAME}" not found`);
  process.exit(1);
}
console.log(`Service: [${service.id}] ${service.service_name} (${service.duration})`);

// ── Test client — reuse one if given, so we stop littering the client list ────
let contactId = process.env.TEST_CONTACT_ID?.trim();
if (!contactId) {
  const stamp = Date.now().toString().slice(-6);
  const r = await api(
    "/clients/create",
    jsonPost({
      first_name: "WEBEE",
      last_name: `APITest${stamp}`,
      mobile: `+4470000${stamp}`,
      email: `webee.apitest.${stamp}@example.com`,
      gender: "Other",
      salutation: "None",
      preferred_language: "English",
    }),
  );
  contactId = r.json?.contact_id ?? r.json?.client_id ?? r.json?.id ?? null;
  if (!contactId) {
    console.error("Could not create test client:", r.status, r.text.slice(0, 300));
    process.exit(1);
  }
  console.log(`Test client created: contact_id=${contactId}`);
} else {
  console.log(`Reusing test client contact_id=${contactId}`);
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ymd = (d) => d.toISOString().slice(0, 10);
const today = new Date();

// Build every (date, employee, time) candidate, ordered by date so the first
// acceptance is the earliest bookable slot.
const attempts = [];
for (let offset = 1; offset <= HORIZON_DAYS; offset += 1) {
  const date = new Date(today.getTime() + offset * 86400000);
  const dow = DOW[date.getUTCDay()];
  for (const c of CANDIDATES) {
    if (!c.days.includes(dow)) continue;
    for (const time of c.times) {
      attempts.push({ date: ymd(date), dow, ...c, time });
    }
  }
}
console.log(`Sweeping ${attempts.length} candidate slot(s) over ${HORIZON_DAYS} days\n`);

const messages = new Map();
let accepted = null;
let firstRefusalDate = null;
let lastRefusalDate = null;

for (const a of attempts) {
  const body = {
    contact_id: contactId,
    customer_id: String(contactId),
    service_id: service.id,
    start_date: a.date,
    start_time: `${a.time}:00`,
    location_id: LOCATION,
    employee_id: a.employeeId,
    notes: "WEBEE API probe — safe to delete",
  };

  const r = await api("/appointments/create", jsonPost(body));
  const message = r.json?.message ?? r.text.slice(0, 120);
  const ok = r.status >= 200 && r.status < 300 && r.json?.success !== false;

  if (ok) {
    accepted = { ...a, response: r.json };
    console.log(`✓ ACCEPTED ${a.dow} ${a.date} ${a.time} — ${a.name} (${a.employeeId})`);
    break;
  }

  messages.set(message, (messages.get(message) ?? 0) + 1);
  if (!firstRefusalDate) firstRefusalDate = a.date;
  lastRefusalDate = a.date;
}

console.log("\n=== Result ===");
if (accepted) {
  console.log(
    `Earliest bookable slot: ${accepted.dow} ${accepted.date} at ${accepted.time} ` +
      `with ${accepted.name} (employee_id=${accepted.employeeId})`,
  );
  console.log(JSON.stringify(accepted.response, null, 2).slice(0, 600));
  console.log(`\n⚠️  DELETE IN PABAU: the appointment above, and test client ${contactId}.`);
} else {
  console.log(`Refused every slot from ${firstRefusalDate} to ${lastRefusalDate}. Messages seen:`);
  for (const [m, count] of messages) console.log(`  ${count}× ${m}`);
  console.log("\nNo appointment was created.");
}
