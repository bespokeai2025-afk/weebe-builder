/**
 * E2E workspace-isolation proof for Task #525: the streaming HiveMind chat
 * endpoint (POST /api/hivemind/chat-stream) resolves its workspace via
 * resolveWorkspaceIdForUser(userClient, userId, wb_workspace_id cookie).
 *
 * This test exercises that exact path with a REAL authenticated user JWT and
 * the same RLS-scoped client construction the route uses (publishable key +
 * Authorization: Bearer <jwt>), proving:
 *
 *   • cookie pointing at a workspace the user is NOT a member of → resolver
 *     NEVER returns that workspace; it falls back to a workspace the user IS
 *     a member of (fail closed)
 *   • cookie pointing at the user's own workspace → returned as-is
 *   • garbage / non-existent cookie value → falls back to own workspace
 *   • RLS sanity: the user client cannot even see the foreign workspace's
 *     membership rows
 *
 * Runs against the REAL shared Supabase database using throw-away users and
 * workspaces, and cleans everything up (including any auto-provisioned
 * personal workspaces created for the throw-away users).
 *
 * Run: npx vitest run --config vitest.e2e.config.ts tests/e2e/chat-stream-workspace-isolation.e2e.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { resolveWorkspaceIdForUser } from "@/lib/workspace/resolve-workspace.server";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";

const admin = supabaseAdmin as any;

const RUN = randomUUID().slice(0, 8);
const WS_MINE = randomUUID(); // workspace the test user belongs to
const WS_FOREIGN = randomUUID(); // workspace owned by someone else — never the user's

let USER_ID = ""; // the "attacker-adjacent" signed-in user
let OTHER_USER_ID = ""; // owner of the foreign workspace
let USER_JWT = "";

/** Build the RLS-scoped client exactly the way chat-stream.ts authenticate() does. */
function routeStyleUserClient(token: string): SupabaseClient {
  return createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  }) as unknown as SupabaseClient;
}

async function createConfirmedUser(email: string, password: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data?.user?.id) throw new Error(`createUser(${email}): ${error?.message}`);
  return data.user.id as string;
}

async function deleteUserAndOwnedWorkspaces(userId: string) {
  if (!userId) return;
  const { data: owned } = await admin
    .from("workspaces")
    .select("id")
    .eq("owner_id", userId);
  for (const w of owned ?? []) {
    await admin.from("workspace_members").delete().eq("workspace_id", w.id);
    await admin.from("workspace_settings").delete().eq("workspace_id", w.id);
    await admin.from("telephony_configs").delete().eq("workspace_id", w.id);
    await admin.from("workspace_subscriptions").delete().eq("workspace_id", w.id);
    await admin.from("workspaces").delete().eq("id", w.id);
  }
  await admin.from("workspace_members").delete().eq("user_id", userId);
  await admin.from("profiles").delete().eq("user_id", userId);
  await admin.auth.admin.deleteUser(userId).catch(() => {});
}

beforeAll(async () => {
  if (!SUPABASE_URL || !PUBLISHABLE_KEY) {
    throw new Error("SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY not configured for e2e run");
  }

  const password = `E2e-${randomUUID()}!`;
  USER_ID = await createConfirmedUser(`e2e-stream-user-${RUN}@example.com`, password);
  OTHER_USER_ID = await createConfirmedUser(
    `e2e-stream-other-${RUN}@example.com`,
    `E2e-${randomUUID()}!`,
  );

  // The user's own workspace + membership (deterministic, independent of any
  // auto-provision trigger behavior).
  for (const [id, owner, name] of [
    [WS_MINE, USER_ID, `e2e stream mine ${RUN}`],
    [WS_FOREIGN, OTHER_USER_ID, `e2e stream foreign ${RUN}`],
  ] as const) {
    const { error } = await admin.from("workspaces").insert({
      id,
      name,
      owner_id: owner,
      slug: `e2e-stream-${String(id).slice(0, 8)}`,
    });
    if (error) throw new Error(`workspace fixture: ${error.message}`);
  }
  for (const row of [
    { workspace_id: WS_MINE, user_id: USER_ID, role: "owner" },
    { workspace_id: WS_FOREIGN, user_id: OTHER_USER_ID, role: "owner" },
  ]) {
    const { error } = await admin.from("workspace_members").insert(row);
    if (error) throw new Error(`member fixture: ${error.message}`);
  }
  // Point the user's default at their own workspace so fallback is
  // deterministic. (The auth trigger already created the profile row, so this
  // is an update — an upsert insert-path would trip not-null columns.)
  const { error: profErr } = await admin
    .from("profiles")
    .update({ default_workspace_id: WS_MINE })
    .eq("user_id", USER_ID);
  if (profErr) throw new Error(`profile default fixture: ${profErr.message}`);

  // Real sign-in → real JWT, same as the browser sends the route.
  const anon = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: signIn, error: signInErr } = await anon.auth.signInWithPassword({
    email: `e2e-stream-user-${RUN}@example.com`,
    password,
  });
  if (signInErr || !signIn?.session?.access_token) {
    throw new Error(`sign-in failed: ${signInErr?.message}`);
  }
  USER_JWT = signIn.session.access_token;
}, 60_000);

afterAll(async () => {
  await admin.from("workspace_members").delete().eq("workspace_id", WS_MINE);
  await admin.from("workspace_members").delete().eq("workspace_id", WS_FOREIGN);
  await admin.from("workspaces").delete().in("id", [WS_MINE, WS_FOREIGN]);
  await deleteUserAndOwnedWorkspaces(USER_ID);
  await deleteUserAndOwnedWorkspaces(OTHER_USER_ID);
}, 60_000);

describe("chat-stream workspace isolation (resolveWorkspaceIdForUser, route-style client)", () => {
  it("RLS sanity: user client cannot see the foreign workspace's membership rows", async () => {
    const sb = routeStyleUserClient(USER_JWT);
    const { data, error } = await sb
      .from("workspace_members")
      .select("workspace_id, user_id")
      .eq("workspace_id", WS_FOREIGN);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("cookie pointing at a NON-member workspace never resolves to it (fail closed)", async () => {
    const sb = routeStyleUserClient(USER_JWT);
    const resolved = await resolveWorkspaceIdForUser(sb, USER_ID, WS_FOREIGN);
    expect(resolved).toBeDefined();
    expect(resolved).not.toBe(WS_FOREIGN);
    expect(resolved).toBe(WS_MINE);
    // Belt and braces: whatever was resolved, the user must actually be a member.
    const { data: member } = await admin
      .from("workspace_members")
      .select("workspace_id")
      .eq("workspace_id", resolved!)
      .eq("user_id", USER_ID)
      .maybeSingle();
    expect(member?.workspace_id).toBe(resolved);
  });

  it("cookie pointing at the user's own workspace resolves to it", async () => {
    const sb = routeStyleUserClient(USER_JWT);
    const resolved = await resolveWorkspaceIdForUser(sb, USER_ID, WS_MINE);
    expect(resolved).toBe(WS_MINE);
  });

  it("garbage / non-existent cookie value falls back to the user's own workspace", async () => {
    const sb = routeStyleUserClient(USER_JWT);
    for (const junk of [randomUUID(), "not-a-uuid'; DROP TABLE x;--"]) {
      const resolved = await resolveWorkspaceIdForUser(sb, USER_ID, junk);
      expect(resolved).toBe(WS_MINE);
      expect(resolved).not.toBe(WS_FOREIGN);
    }
  });

  it("a foreign cookie combined with a tampered default_workspace_id still fails closed", async () => {
    // Even if the user's profile default is (maliciously or staleness-wise)
    // pointed at the foreign workspace, membership is re-checked — the
    // resolver must skip it and land on a workspace the user belongs to.
    await admin
      .from("profiles")
      .update({ default_workspace_id: WS_FOREIGN })
      .eq("user_id", USER_ID);
    try {
      const sb = routeStyleUserClient(USER_JWT);
      const resolved = await resolveWorkspaceIdForUser(sb, USER_ID, WS_FOREIGN);
      expect(resolved).toBeDefined();
      expect(resolved).not.toBe(WS_FOREIGN);
      const { data: member } = await admin
        .from("workspace_members")
        .select("workspace_id")
        .eq("workspace_id", resolved!)
        .eq("user_id", USER_ID)
        .maybeSingle();
      expect(member?.workspace_id).toBe(resolved);
    } finally {
      await admin
        .from("profiles")
        .update({ default_workspace_id: WS_MINE })
        .eq("user_id", USER_ID);
    }
  });
});
