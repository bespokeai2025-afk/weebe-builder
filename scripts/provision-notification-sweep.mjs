#!/usr/bin/env node
/**
 * Insert-only notification-settings sweep.
 *
 * Materializes catalogue-default workspace_notification_settings rows for
 * every (workspace × event key) pair that does not already have one.
 * Idempotent and NEVER overwrites existing rows (ON CONFLICT DO NOTHING) —
 * safe to re-run at any time, e.g. after adding new catalogue event keys.
 *
 * Defaults mirror notification-engine.shared.ts:
 *   enabled=true (except DEFAULT_OFF_EVENTS), in_app on, email off,
 *   owner+admins recipients, immediate frequency.
 *
 * Usage: SUPABASE_ACCESS_TOKEN=... node scripts/provision-notification-sweep.mjs
 * (Uses the Supabase Management API SQL endpoint, like refresh-supabase-types.mjs.)
 */
import { readFileSync } from "node:fs";

try {
  process.loadEnvFile(".env");
} catch {
  // Fall back to the environment.
}
// The project to sweep: SUPABASE_URL's ref, else supabase/config.toml's project_id.
const PROJECT_REF = (() => {
  const url = [process.env.SUPABASE_URL, process.env.VITE_SUPABASE_URL].find((v) =>
    /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(String(v ?? "").trim()),
  );
  if (url) return new URL(url.trim()).host.split(".")[0];
  try {
    return readFileSync("supabase/config.toml", "utf8").match(/^\s*project_id\s*=\s*"([a-z0-9-]+)"/m)?.[1];
  } catch {
    return undefined;
  }
})();
if (!PROJECT_REF) {
  console.error("Set SUPABASE_URL (or supabase/config.toml project_id) to the project to sweep");
  process.exit(1);
}
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error("SUPABASE_ACCESS_TOKEN is required");
  process.exit(1);
}

// Keep in lockstep with NOTIFICATION_EVENT_KEYS / DEFAULT_OFF_EVENTS in
// src/lib/notifications/notification-engine.shared.ts (the component test
// tests/component/notification-catalogue.test.tsx guards the engine side).
const { NOTIFICATION_EVENT_KEYS, DEFAULT_OFF_EVENTS } = await import(
  "../src/lib/notifications/notification-engine.shared.ts"
).catch(async () => {
  // Fallback when TS can't be imported directly: parse the source.
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/lib/notifications/notification-engine.shared.ts", import.meta.url), "utf8");
  const grab = (name) => {
    const m = src.match(new RegExp(`${name}[^=]*=\\s*(\\[[\\s\\S]*?\\]|new Set[\\s\\S]*?\\))`));
    if (!m) throw new Error(`cannot find ${name}`);
    return [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
  };
  return {
    NOTIFICATION_EVENT_KEYS: grab("NOTIFICATION_EVENT_KEYS"),
    DEFAULT_OFF_EVENTS: new Set(grab("DEFAULT_OFF_EVENTS")),
  };
});

const keys = [...NOTIFICATION_EVENT_KEYS];
const offKeys = [...DEFAULT_OFF_EVENTS];
if (keys.length < 25) throw new Error("suspiciously few event keys parsed");

const valuesSql = keys.map((k) => `('${k}')`).join(",");
const offSql = offKeys.map((k) => `'${k}'`).join(",") || "''";

const sql = `
WITH keys(event_key) AS (VALUES ${valuesSql}), ins AS (
  INSERT INTO workspace_notification_settings
    (workspace_id, event_key, enabled, email_enabled, in_app_enabled, recipients, frequency)
  SELECT w.id, k.event_key,
    k.event_key NOT IN (${offSql}),
    false, true,
    '{"owner":true,"admins":true,"userIds":[],"roleKeys":[],"customEmails":[],"campaignOwner":false}'::jsonb,
    'immediate'
  FROM workspaces w CROSS JOIN keys k
  ON CONFLICT (workspace_id, event_key) DO NOTHING
  RETURNING 1
) SELECT count(*) AS inserted FROM ins;`;

const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: sql }),
});
const body = await res.text();
if (!res.ok) {
  console.error(`Sweep failed (${res.status}): ${body}`);
  process.exit(1);
}
console.log(`Sweep OK (${keys.length} event keys, ${offKeys.length} default-off): ${body}`);
