/**
 * Grants every platform feature to sales@webespokeai.com.
 *
 * Mechanism: assign the `enterprise` package, whose feature list is literally `[...FEATURE_KEYS]`
 * — all 56. Deliberately NOT by editing the `trial` package in the admin matrix: 69 of 141
 * workspaces have no subscription row and fail closed to trial, so widening trial would re-govern
 * all of them (that is what happened on 2026-09-17 and was then reverted).
 *
 * That account owns three workspaces, all currently unsubscribed, and module approvals have
 * already landed on the wrong one more than once — so all three are granted, and whichever one
 * they open has full access.
 *
 * Mirrors adminSetWorkspacePackage: same upsert, same audit row, same cache-signal bump, so a
 * running instance picks the change up within ~5s instead of serving stale entitlements.
 *
 * Usage: node scripts/grant-full-access-sales.mjs [--apply] [--revert]
 * Without --apply it only reports.
 */
import fs from "node:fs";
import path from "node:path";

const APPLY = process.argv.includes("--apply");
const REVERT = process.argv.includes("--revert");
const TARGET_EMAIL = "sales@webespokeai.com";
const PACKAGE_KEY = "enterprise";
/** Attributed to the platform admin this change was requested under. */
const ACTING_EMAIL = "admin@webespokeai.com";

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
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!U || !KEY) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required");

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
async function rest(p, init) {
  const r = await fetch(`${U}/rest/v1/${p}`, { ...init, headers: { ...H, ...(init?.headers ?? {}) } });
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : null;
}

const workspaces = await rest("workspaces?select=id,name");
const wsName = (id) => workspaces.find((w) => w.id === id)?.name ?? id;

const [target] = await rest(
  `profiles?select=user_id,email&email=eq.${encodeURIComponent(TARGET_EMAIL)}`,
);
if (!target) throw new Error(`No profile for ${TARGET_EMAIL}`);
const [acting] = await rest(
  `profiles?select=user_id&email=eq.${encodeURIComponent(ACTING_EMAIL)}`,
);

// Only workspaces this account actually OWNS — never widen access to a
// workspace it merely belongs to, which would grant on someone else's account.
const memberships = await rest(
  `workspace_members?select=workspace_id,role&user_id=eq.${target.user_id}`,
);
const owned = memberships.filter((m) => m.role === "owner");
if (owned.length === 0) throw new Error(`${TARGET_EMAIL} owns no workspaces`);

// The catalog must not be overridden, or "enterprise" may not mean all features.
const defs = await rest("package_definitions?select=package_key,features_json");
const overridden = defs.find((d) => d.package_key === PACKAGE_KEY);
if (overridden) {
  const on = Object.entries(overridden.features_json ?? {}).filter(([, v]) => v === true).length;
  console.warn(
    `! "${PACKAGE_KEY}" has a DB override in the matrix (${on} features on). ` +
      `It no longer necessarily means all features — check the matrix before relying on this.`,
  );
}

console.log(`${REVERT ? "REVERT" : "GRANT"} — ${TARGET_EMAIL} (${target.user_id})`);
console.log(`owns ${owned.length} workspace(s):\n`);

for (const m of owned) {
  const [before] = await rest(
    `workspace_subscriptions?select=package_key,subscription_status&workspace_id=eq.${m.workspace_id}`,
  );
  const now = before ? `${before.package_key}/${before.subscription_status}` : "no row → trial";

  if (REVERT) {
    // Undo: only remove a row we put there, so a genuine paid subscription is
    // never deleted by a careless re-run.
    if (!before || before.package_key !== PACKAGE_KEY) {
      console.log(`  ${wsName(m.workspace_id)}: ${now} — not granted by this script, leaving alone`);
      continue;
    }
    console.log(`  ${wsName(m.workspace_id)}: ${now} -> removing (back to trial fallback)`);
    if (APPLY) {
      await rest(`workspace_subscriptions?workspace_id=eq.${m.workspace_id}`, {
        method: "DELETE",
        headers: { Prefer: "return=minimal" },
      });
      await rest("workspace_access_audit_logs", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          workspace_id: m.workspace_id,
          acting_user_id: acting?.user_id ?? null,
          object_type: "package",
          object_id: PACKAGE_KEY,
          action_type: "admin_package_change",
          before_state: before,
          after_state: { packageKey: null, note: "reverted grant-full-access-sales script" },
          risk_level: "high",
        }),
      });
    }
    continue;
  }

  console.log(`  ${wsName(m.workspace_id)}: ${now} -> ${PACKAGE_KEY}/active`);
  if (APPLY) {
    await rest("workspace_subscriptions?on_conflict=workspace_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        workspace_id: m.workspace_id,
        package_key: PACKAGE_KEY,
        subscription_status: "active",
        updated_at: new Date().toISOString(),
      }),
    });
    await rest("workspace_access_audit_logs", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        workspace_id: m.workspace_id,
        acting_user_id: acting?.user_id ?? null,
        object_type: "package",
        object_id: PACKAGE_KEY,
        action_type: "admin_package_change",
        before_state: before ?? null,
        after_state: {
          packageKey: PACKAGE_KEY,
          status: "active",
          note: `full feature access for ${TARGET_EMAIL} via grant-full-access-sales script`,
        },
        risk_level: "high",
      }),
    });
  }
}

if (APPLY) {
  // Entitlements are cached per instance behind a DB-backed signal; without this
  // bump a running server serves the old package until its TTL lapses.
  await rest("platform_cache_signals?on_conflict=signal_key", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      signal_key: "entitlements",
      version: Date.now(),
      updated_at: new Date().toISOString(),
    }),
  });
  console.log("\nApplied. Entitlements cache signal bumped.");
} else {
  console.log(`\nDry run. Re-run with --apply${REVERT ? " --revert" : ""} to write.`);
}
