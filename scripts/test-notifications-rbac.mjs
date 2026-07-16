// End-to-end sanity test for Task #351: campaign notifications + RBAC tables.
// Uses the service-role key directly (server-side behavior). Read-mostly;
// creates and then deletes its own test rows in a real workspace.
// Run: node scripts/test-notifications-rbac.mjs
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY"); process.exit(1); }
const sb = createClient(url, key);

let failures = 0;
const ok = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
  if (!cond) failures++;
};

// 1. Tables exist and are readable with service role.
for (const t of [
  "workspace_notification_settings",
  "workspace_notifications",
  "workspace_role_permissions",
  "workspace_member_roles",
  "workspace_approval_settings",
  "workspace_access_audit_logs",
]) {
  const { error } = await sb.from(t).select("*", { count: "exact", head: true });
  ok(`table ${t} readable`, !error, error?.message);
}

// 2. workspace_invites has invited_role_key.
{
  const { error } = await sb.from("workspace_invites").select("invited_role_key").limit(1);
  ok("workspace_invites.invited_role_key exists", !error, error?.message);
}

// 3. Pick a real workspace and exercise the notification engine.
const { data: ws } = await sb.from("workspaces").select("id, owner_id, name").limit(1).maybeSingle();
if (!ws) { ok("workspace available", false); process.exit(1); }

const { emitCampaignNotification, processNotificationDigests, loadEventSettings } =
  await import("../src/lib/notifications/notification-engine.shared.ts");

// Defaults when no settings row.
const defaults = await loadEventSettings(sb, ws.id, "failed");
ok("default settings enabled + in-app", defaults.enabled && defaults.inAppEnabled && !defaults.emailEnabled);

// Emit an in-app notification (no email since defaults have email off).
await emitCampaignNotification(sb, {
  workspaceId: ws.id,
  eventKey: "failed",
  campaignName: "__test_campaign__",
  summary: "Test notification from scripts/test-notifications-rbac.mjs",
});
const { data: notifs } = await sb
  .from("workspace_notifications")
  .select("id, channel, severity, delivery_status, recipient_user_id")
  .eq("workspace_id", ws.id)
  .like("title", "%__test_campaign__%");
ok("in-app notification rows created", (notifs ?? []).length > 0, `rows=${notifs?.length}`);
ok("severity critical for 'failed'", (notifs ?? []).every((n) => n.severity === "critical"));
ok("all rows in_app (email disabled by default)", (notifs ?? []).every((n) => n.channel === "in_app"));
ok("recipient scoped to a user", (notifs ?? []).every((n) => !!n.recipient_user_id));

// Digest processor runs without throwing (no digest_queued rows expected).
const digestRes = await processNotificationDigests(sb);
ok("digest processor runs", typeof digestRes.sent === "number");

// 4. Permission model fail-closed behavior.
const { resolvePermissions } = await import("../src/lib/permissions/permissions.server.ts");
const anon = await resolvePermissions(ws.id, "00000000-0000-0000-0000-000000000000");
ok("non-member resolves to NO_ACCESS", !anon.isMember && anon.roleKey === "suspended");
const nully = await resolvePermissions(null, null);
ok("null ids resolve to NO_ACCESS", !nully.isMember);
const owner = await resolvePermissions(ws.id, ws.owner_id);
ok("owner is member with full actions", owner.isMember && owner.actionAccess.user_management === true, `role=${owner.roleKey}`);

// Cross-workspace isolation: owner of ws has no access in a random workspace id.
const foreign = await resolvePermissions("11111111-1111-1111-1111-111111111111", ws.owner_id);
ok("cross-workspace resolves to NO_ACCESS", !foreign.isMember);

// Privilege-escalation regression: a rogue workspace_member_roles row with
// role_key "owner" for a non-owner member must NOT resolve to owner perms.
const { data: nonOwnerMember } = await sb
  .from("workspace_members")
  .select("user_id, role")
  .eq("workspace_id", ws.id)
  .neq("role", "owner")
  .limit(1)
  .maybeSingle();
let escUserId = nonOwnerMember?.user_id ?? null;
let escSynthetic = false;
if (!escUserId) {
  // No non-owner member exists — synthesize one for the test.
  escUserId = "22222222-2222-2222-2222-222222222222";
  escSynthetic = true;
  await sb.from("workspace_members").insert({ workspace_id: ws.id, user_id: escUserId, role: "member" });
}
const { data: priorRoleRow } = await sb
  .from("workspace_member_roles")
  .select("role_key")
  .eq("workspace_id", ws.id)
  .eq("user_id", escUserId)
  .maybeSingle();
await sb.from("workspace_member_roles").upsert(
  { workspace_id: ws.id, user_id: escUserId, role_key: "owner" },
  { onConflict: "workspace_id,user_id" },
);
const escalated = await resolvePermissions(ws.id, escUserId);
ok(
  "rogue role_key=owner does NOT grant owner perms",
  escalated.roleKey !== "owner" && escalated.legacyRole !== "owner",
  `resolved role=${escalated.roleKey}`,
);
// Restore prior state.
if (priorRoleRow) {
  await sb.from("workspace_member_roles").upsert(
    { workspace_id: ws.id, user_id: escUserId, role_key: priorRoleRow.role_key },
    { onConflict: "workspace_id,user_id" },
  );
} else {
  await sb.from("workspace_member_roles").delete().eq("workspace_id", ws.id).eq("user_id", escUserId);
}
if (escSynthetic) {
  await sb.from("workspace_members").delete().eq("workspace_id", ws.id).eq("user_id", escUserId);
}

// 5. Cleanup test rows.
const ids = (notifs ?? []).map((n) => n.id);
if (ids.length) await sb.from("workspace_notifications").delete().in("id", ids);
console.log(`\nCleaned up ${ids.length} test notification rows.`);
console.log(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
