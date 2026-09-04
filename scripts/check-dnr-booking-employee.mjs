/**
 * Read-only check: does AI Receptionist (152257) exist, sit on Cheshire, and
 * appear on any live rota/appointment feed?
 *
 *   node --env-file=.env scripts/check-dnr-booking-employee.mjs
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const TARGET = Number(process.env.EMPLOYEE_ID ?? 152257);
const CHESHIRE = 3526;

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
  console.error("Missing PABAU_API_KEY");
  process.exit(1);
}

const base = (process.env.PABAU_API_BASE ?? `https://api.oauth.pabau.com/${key}`).replace(/\/+$/, "");

async function get(path) {
  const res = await fetch(`${base}${path}`, { headers: { Accept: "application/json" } });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text: text.slice(0, 180) };
}

function items(json) {
  if (!json) return [];
  if (Array.isArray(json)) return json;
  for (const k of ["users", "employees", "staff", "locations", "appointments", "data", "shifts"]) {
    if (Array.isArray(json[k])) return json[k];
  }
  return [];
}

function mentionsTarget(value) {
  return JSON.stringify(value).includes(String(TARGET));
}

const usersRes = await get("/users");
const users = items(usersRes.json);
const user = users.find((u) => Number(u.id) === TARGET);
console.log(`users HTTP ${usersRes.status} count=${users.length}`);
if (user) {
  console.log("user_found:", {
    id: user.id,
    name: user.full_name ?? user.username ?? user.name,
    job: user.job_title ?? user.role ?? null,
    active: user.active ?? user.is_active ?? user.status ?? null,
  });
} else {
  console.log("user_found: NO — 152257 is not in /users");
  const ai = users.filter((u) => /ai|reception/i.test(String(u.full_name ?? u.username ?? "")));
  console.log(
    "ai_or_reception_users:",
    ai.map((u) => ({ id: u.id, name: u.full_name ?? u.username })),
  );
}

const locRes = await get("/locations");
const locations = items(locRes.json);
const cheshire = locations.find((l) => Number(l.id) === CHESHIRE);
console.log(`locations HTTP ${locRes.status} count=${locations.length}`);
if (cheshire) {
  const assigned = Array.isArray(cheshire.assigned_employees)
    ? cheshire.assigned_employees.map(Number)
    : [];
  console.log("cheshire:", {
    id: cheshire.id,
    name: cheshire.location_name ?? cheshire.name,
    assigned_count: assigned.length,
    assigned_includes_152257: assigned.includes(TARGET),
  });
  const hours = cheshire.working_hours;
  if (Array.isArray(hours)) {
    const today = new Date().toLocaleDateString("en-GB", { weekday: "long", timeZone: "Europe/London" });
    console.log("cheshire_hours_today_name:", today);
    console.log(
      "cheshire_hours:",
      hours.map((h) => ({
        day: h.day ?? h.weekday ?? h.day_name,
        open: h.open ?? h.start ?? h.from,
        close: h.close ?? h.end ?? h.to,
      })),
    );
  }
} else {
  console.log("cheshire: NOT FOUND");
}

const shiftPaths = [
  "/shifts",
  "/rotas",
  "/rota",
  `/users/${TARGET}`,
  `/employees/${TARGET}`,
  `/users/${TARGET}/shifts`,
];
for (const path of shiftPaths) {
  const r = await get(path);
  const hit = mentionsTarget(r.json);
  console.log(`probe ${path} HTTP ${r.status} mentions_152257=${hit} body=${r.text.replace(/\s+/g, " ").slice(0, 120)}`);
}

const apptRes = await get("/appointments?per_page=200");
const appts = items(apptRes.json);
let targetAppts = 0;
const practitioners = new Map();
for (const row of appts) {
  const d = row.details ?? {};
  const dates = row.dates ?? {};
  const locId = Number(d.location?.id ?? NaN);
  const pid = d.practitioner?.practitioner_id ?? d.employee_id ?? d.user_id;
  const pname = d.practitioner?.practitioner_name ?? "";
  if (locId && locId !== CHESHIRE) continue;
  if (pid != null) {
    const id = String(pid);
    if (!practitioners.has(id)) practitioners.set(id, { name: pname, n: 0 });
    practitioners.get(id).n += 1;
  }
  if (mentionsTarget(row)) targetAppts += 1;
}
console.log(`appointments HTTP ${apptRes.status} rows=${appts.length} mentioning_152257=${targetAppts}`);
console.log(
  "cheshire_practitioners_in_feed:",
  [...practitioners.entries()].map(([id, v]) => ({ id, name: v.name, count: v.n })),
);

const todayLondon = new Date().toLocaleString("en-GB", { timeZone: "Europe/London", weekday: "long", day: "numeric", month: "short" });
console.log("today_london:", todayLondon);
console.log(
  "verdict:",
  user
    ? assignedIncludes(cheshire, TARGET)
      ? targetAppts > 0
        ? "USER EXISTS + ASSIGNED TO CHESHIRE + HAS APPOINTMENTS (rota likely published)"
        : "USER EXISTS + ASSIGNED TO CHESHIRE but NO appointments in feed — rota still unproven"
      : "USER EXISTS but NOT in Cheshire assigned_employees — bookings can still fail"
    : "USER 152257 NOT IN /users — bookings will fail until this user exists",
);

function assignedIncludes(loc, id) {
  const assigned = Array.isArray(loc?.assigned_employees) ? loc.assigned_employees.map(Number) : [];
  return assigned.includes(id);
}
