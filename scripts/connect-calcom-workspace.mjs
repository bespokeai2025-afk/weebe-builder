/**
 * Connects Cal.com to one workspace: saves the API key, registers the booking webhook, and syncs
 * calendars + event types.
 *
 * Mirrors saveWorkspaceCalendarSettings + registerCalcomWebhook + syncCalcomConnections, which are
 * what Settings → Calendar calls. Written as a script because the UI path requires being signed in
 * as a member of the target workspace.
 *
 * Two details the UI gets from request context and a script must be told:
 *   • The webhook subscriber URL is built from PUBLIC_SITE_URL, which is NOT set in .env — locally
 *     the origin resolves to "" and Cal.com rejects the relative URL. Pass --origin.
 *   • calendar_connections and calcom_event_types are keyed by user_id, not workspace_id, so the
 *     sync is attributed to the workspace OWNER rather than whoever runs this.
 *
 * Usage:
 *   node scripts/connect-calcom-workspace.mjs --key cal_live_xxx [--workspace <id|slug>]
 *        [--origin https://webeesmartdash.com] [--apply]
 *
 *   --reuse-from <id|slug>   instead of --key, copy the key already saved on another workspace.
 *                            Both workspaces then book into the SAME Cal.com account. The key is
 *                            read and written inside this process and never printed.
 *
 * Without --apply it validates the key against Cal.com and reports what it would write.
 */
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const arg = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};
const APPLY = argv.includes("--apply");
let API_KEY = arg("key");
const REUSE_FROM = arg("reuse-from");
const WORKSPACE = arg("workspace", "webespokeai-sales");
const ORIGIN = (arg("origin", "https://webeesmartdash.com") || "").replace(/\/$/, "");
const CAL_BASE = "https://api.cal.com/v2";

if (!API_KEY && !REUSE_FROM) {
  console.error("Pass --key cal_live_... or --reuse-from <workspace id|slug>.");
  process.exit(1);
}

const env = Object.fromEntries(
  fs
    .readFileSync(path.resolve(".env"), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);
const U = env.SUPABASE_URL;
const SRK = env.SUPABASE_SERVICE_ROLE_KEY;
if (!U || !SRK) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required");
const H = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };

async function rest(p, init) {
  const r = await fetch(`${U}/rest/v1/${p}`, { ...init, headers: { ...H, ...(init?.headers ?? {}) } });
  const t = await r.text();
  if (!r.ok) throw new Error(`supabase ${r.status}: ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : null;
}
async function cal(p, init) {
  const r = await fetch(`${CAL_BASE}${p}`, {
    ...init,
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
  });
  const t = await r.text();
  let body = t;
  try { body = t ? JSON.parse(t) : null; } catch { /* keep text */ }
  return { status: r.status, body };
}

// A reused key is fetched here so the caller never has to handle the secret.
if (REUSE_FROM) {
  const srcById = /^[0-9a-f-]{36}$/i.test(REUSE_FROM);
  const src = await rest(
    `workspaces?select=id,name&${srcById ? `id=eq.${REUSE_FROM}` : `slug=eq.${encodeURIComponent(REUSE_FROM)}`}`,
  );
  if (src.length !== 1) throw new Error(`--reuse-from matched ${src.length} workspaces`);
  const [row] = await rest(
    `workspace_settings?select=calcom_api_key&workspace_id=eq.${src[0].id}`,
  );
  if (!row?.calcom_api_key) throw new Error(`"${src[0].name}" has no Cal.com key to reuse`);
  API_KEY = String(row.calcom_api_key).trim();
  console.log(`Reusing the Cal.com key already saved on "${src[0].name}".`);
}

// ── Resolve the workspace and its owner ──────────────────────────────────────
const byId = /^[0-9a-f-]{36}$/i.test(WORKSPACE);
const wsRows = await rest(
  `workspaces?select=id,name,slug&${byId ? `id=eq.${WORKSPACE}` : `slug=eq.${encodeURIComponent(WORKSPACE)}`}`,
);
if (wsRows.length !== 1) throw new Error(`Expected exactly 1 workspace for "${WORKSPACE}", got ${wsRows.length}`);
const ws = wsRows[0];

const owners = await rest(`workspace_members?select=user_id&workspace_id=eq.${ws.id}&role=eq.owner`);
if (owners.length === 0) throw new Error(`Workspace "${ws.name}" has no owner`);
const ownerId = owners[0].user_id;
const [ownerProfile] = await rest(`profiles?select=email&user_id=eq.${ownerId}`);

console.log(`Workspace : ${ws.name}  (${ws.slug})`);
console.log(`            ${ws.id}`);
console.log(`Owner     : ${ownerProfile?.email ?? ownerId}`);
console.log(`Origin    : ${ORIGIN || "(none — webhook registration will fail)"}`);

// ── Validate the key BEFORE writing it, so a bad key never lands in settings ─
const me = await cal("/me", { method: "GET" });
if (me.status !== 200) {
  console.error(`\nCal.com /me -> ${me.status}. Key rejected; nothing written.`);
  console.error(JSON.stringify(me.body).slice(0, 300));
  process.exit(1);
}
const acct = me.body?.data ?? {};
console.log(`\nCal.com account verified: ${acct.email} ("${acct.name}") tz=${acct.timeZone}`);

const etRes = await cal("/event-types", { method: "GET" });
const groups = etRes.body?.data?.eventTypeGroups ?? [];
const eventTypes = groups.flatMap((g) => g.eventTypes ?? []);
console.log(`Event types visible to this key: ${eventTypes.length}`);
for (const e of eventTypes.slice(0, 15)) console.log(`   - ${e.title} · ${e.length ?? e.lengthInMinutes ?? "?"}min  id=${e.id}`);

// Warn if this key is already wired to a different workspace — reusing one key
// means both workspaces book into the same Cal.com account.
const existingKeys = await rest("workspace_settings?select=workspace_id,calcom_api_key");
const sharedWith = existingKeys.filter(
  (r) => r.calcom_api_key && r.calcom_api_key === API_KEY && r.workspace_id !== ws.id,
);
if (sharedWith.length > 0) {
  const names = sharedWith.map((r) => wsRows.find((w) => w.id === r.workspace_id)?.name ?? r.workspace_id);
  console.log(`\n! This exact key is already saved on ${sharedWith.length} other workspace(s). Bookings will share one Cal.com account.`);
  void names;
}

if (!APPLY) {
  console.log(`\nDry run — key is valid. Re-run with --apply to:`);
  console.log(`  1. save calcom_api_key + timezone on workspace_settings`);
  console.log(`  2. register the webhook at ${ORIGIN}/api/public/calcom-webhook/${ws.id}`);
  console.log(`  3. sync ${eventTypes.length} event type(s) under user ${ownerProfile?.email ?? ownerId}`);
  process.exit(0);
}

// ── 1. Save the key ──────────────────────────────────────────────────────────
await rest("workspace_settings?on_conflict=workspace_id", {
  method: "POST",
  headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
  body: JSON.stringify({
    workspace_id: ws.id,
    calcom_api_key: API_KEY,
    timezone: acct.timeZone || "Europe/London",
    updated_at: new Date().toISOString(),
  }),
});
console.log("\n[1/3] API key saved.");

// ── 2. Register the webhook (idempotent, same triggers as the app) ───────────
const subscriberUrl = `${ORIGIN}/api/public/calcom-webhook/${ws.id}`;
if (!ORIGIN) {
  console.warn("[2/3] Skipped webhook registration — no --origin given.");
} else {
  const [cur] = await rest(`workspace_settings?select=calcom_webhook_secret&workspace_id=eq.${ws.id}`);
  let secret = (cur?.calcom_webhook_secret ?? "").trim();
  if (!secret) {
    secret = `whsec_${[...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
    await rest(`workspace_settings?workspace_id=eq.${ws.id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ calcom_webhook_secret: secret }),
    });
  }
  const list = await cal("/webhooks", { method: "GET" });
  const already = (list.body?.data ?? []).find((w) => String(w.subscriberUrl ?? "") === subscriberUrl);
  if (already) {
    console.log(`[2/3] Webhook already registered (id=${already.id}).`);
  } else {
    const created = await cal("/webhooks", {
      method: "POST",
      body: JSON.stringify({
        subscriberUrl,
        triggers: ["BOOKING_CREATED", "BOOKING_RESCHEDULED", "BOOKING_CANCELLED"],
        active: true,
        secret,
        payloadTemplate: null,
      }),
    });
    if (created.status >= 200 && created.status < 300) {
      console.log(`[2/3] Webhook registered -> ${subscriberUrl}`);
    } else {
      console.warn(`[2/3] Webhook create FAILED (${created.status}): ${JSON.stringify(created.body).slice(0, 250)}`);
      console.warn("      Bookings will still be created, but cancellations/reschedules will not sync back.");
    }
  }
}

// ── 3. Sync event types, attributed to the workspace owner ───────────────────
if (eventTypes.length > 0) {
  const now = new Date().toISOString();
  await rest("calcom_event_types?on_conflict=user_id,calcom_event_type_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(
      eventTypes.map((e) => ({
        user_id: ownerId,
        workspace_id: ws.id, // the app leaves this null; set it so the row is attributable
        calcom_event_type_id: e.id,
        title: e.title,
        slug: e.slug ?? null,
        length_minutes: e.length ?? e.lengthInMinutes ?? 30,
        last_synced_at: now,
      })),
    ),
  });
  const [cur] = await rest(`workspace_settings?select=default_event_type_id&workspace_id=eq.${ws.id}`);
  const patch = { last_synced_at: now };
  if (!cur?.default_event_type_id) patch.default_event_type_id = eventTypes[0].id;
  await rest(`workspace_settings?workspace_id=eq.${ws.id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(patch),
  });
  console.log(`[3/3] Synced ${eventTypes.length} event type(s). Default = ${patch.default_event_type_id ?? cur.default_event_type_id}`);
} else {
  console.warn("[3/3] No event types on this Cal.com account — create one before agents can book.");
}

console.log("\nDone. Next: Builder -> the agent -> Booking -> enable and pick an event type.");
