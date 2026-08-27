/**
 * Task #582 acceptance sweep — real Supabase login + real HTTP requests.
 *
 * This is intentionally outside the component suite. It provisions an
 * isolated owner, sales-agent user, workspace, leads and WhatsApp thread,
 * signs both users in with Supabase, then calls every mobile API route
 * introduced by the v1 mobile surface.
 *
 * Start the app first, then run:
 *   npx vitest run --config vitest.e2e.config.ts scripts/acceptance-582-mobile-api.test.ts
 *
 * Set MOBILE_API_E2E_BASE_URL when the app is not on port 5000.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { invalidatePermissionsCache } from "@/lib/permissions/permissions.server";
import { NOTIFICATION_EVENT_KEYS } from "@/lib/notifications/notification-engine.shared";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
const BASE_URL = (
  process.env.MOBILE_API_E2E_BASE_URL || `http://127.0.0.1:${process.env.PORT || "5000"}`
).replace(/\/+$/, "");
const admin = supabaseAdmin as any;
const RUN = randomUUID().slice(0, 8);
const WS = randomUUID();
const OWNER_EMAIL = `e2e-mobile-owner-${RUN}@example.com`;
const AGENT_EMAIL = `e2e-mobile-agent-${RUN}@example.com`;
const PASSWORD = `E2e-Mobile-${randomUUID()}!`;
// WhatsApp conversations are stored as digits-only values by the runtime.
const PHONE = `4470098${Math.floor(1000 + Math.random() * 8999)}`;

let ownerId = "";
let agentId = "";
let assignedLeadId = "";
let unassignedLeadId = "";
let ownerToken = "";
let agentToken = "";

type JsonRecord = Record<string, any>;

async function createConfirmedUser(email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data?.user?.id) {
    throw new Error(`createUser failed: ${error?.message ?? "missing user id"}`);
  }
  return data.user.id;
}

async function signIn(email: string): Promise<string> {
  const anon = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await anon.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (error || !data.session?.access_token) {
    throw new Error(`sign-in failed: ${error?.message ?? "missing access token"}`);
  }
  return data.session.access_token;
}

async function callApi(
  path: string,
  token: string,
  init?: RequestInit,
): Promise<{ response: Response; body: JsonRecord }> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Workspace-Id": WS,
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  let body: JsonRecord;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(
      `${init?.method ?? "GET"} ${path} returned non-JSON (${response.status}): ${text.slice(0, 500)}`,
    );
  }
  return { response, body };
}

function expectOk(
  result: { response: Response; body: JsonRecord },
  path: string,
  status = 200,
): JsonRecord {
  expect(result.response.status, `${path} response: ${JSON.stringify(result.body)}`).toBe(status);
  expect(result.body).toBeTypeOf("object");
  expect(result.body.error, `${path} response: ${JSON.stringify(result.body)}`).toBeUndefined();
  return result.body;
}

async function deleteUserAndOwnedWorkspaces(userId: string) {
  if (!userId) return;
  const { data: owned } = await admin.from("workspaces").select("id").eq("owner_id", userId);
  for (const workspace of owned ?? []) {
    // Most workspace-scoped tables cascade, while these older tables have
    // restrictive foreign keys in some environments.
    for (const table of [
      "workspace_notification_settings",
      "workspace_user_notification_prefs",
      "workspace_subscriptions",
      "workspace_settings",
      "telephony_configs",
      "workspace_members",
    ]) {
      await admin.from(table).delete().eq("workspace_id", workspace.id);
    }
    await admin.from("workspaces").delete().eq("id", workspace.id);
  }
  await admin.from("workspace_members").delete().eq("user_id", userId);
  await admin.from("profiles").delete().eq("user_id", userId);
  await admin.auth.admin.deleteUser(userId).catch(() => {});
}

beforeAll(async () => {
  if (!SUPABASE_URL || !PUBLISHABLE_KEY) {
    throw new Error("SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY not configured for e2e run");
  }

  ownerId = await createConfirmedUser(OWNER_EMAIL);
  agentId = await createConfirmedUser(AGENT_EMAIL);

  const { error: profileError } = await admin
    .from("profiles")
    .update({ full_name: "E2E Mobile Sales Agent" })
    .eq("user_id", agentId);
  if (profileError) throw new Error(`profile fixture failed: ${profileError.message}`);

  const { error: workspaceError } = await admin.from("workspaces").insert({
    id: WS,
    name: `E2E mobile API ${RUN} (safe to delete)`,
    slug: `e2e-mobile-${RUN}`,
    owner_id: ownerId,
  });
  if (workspaceError) throw new Error(`workspace fixture failed: ${workspaceError.message}`);

  const { error: membersError } = await admin.from("workspace_members").insert([
    { workspace_id: WS, user_id: ownerId, role: "owner" },
    { workspace_id: WS, user_id: agentId, role: "sales_agent" },
  ]);
  if (membersError) throw new Error(`member fixture failed: ${membersError.message}`);

  // legacy_full is used only for this disposable workspace so the owner can
  // exercise the assignment write endpoint through the normal package gate.
  const { error: subscriptionError } = await admin.from("workspace_subscriptions").insert({
    workspace_id: WS,
    package_key: "legacy_full",
    subscription_status: "active",
  });
  if (subscriptionError) {
    throw new Error(`subscription fixture failed: ${subscriptionError.message}`);
  }

  const { data: leads, error: leadsError } = await admin
    .from("leads")
    .insert([
      {
        workspace_id: WS,
        full_name: "E2E Mobile Assigned Lead",
        phone: `+4470097${Math.floor(1000 + Math.random() * 8999)}`,
        status: "need_to_call",
        source: "website",
        assigned_to: agentId,
        assigned_at: new Date().toISOString(),
        assigned_by: ownerId,
      },
      {
        workspace_id: WS,
        full_name: "E2E Mobile Unassigned Lead",
        phone: `+4470096${Math.floor(1000 + Math.random() * 8999)}`,
        status: "need_to_call",
        source: "website",
      },
    ])
    .select("id, assigned_to");
  if (leadsError || !leads?.length) {
    throw new Error(`lead fixture failed: ${leadsError?.message ?? "no rows"}`);
  }
  assignedLeadId = leads.find((lead: any) => lead.assigned_to === agentId)?.id ?? "";
  unassignedLeadId = leads.find((lead: any) => !lead.assigned_to)?.id ?? "";
  if (!assignedLeadId || !unassignedLeadId) {
    throw new Error("lead fixture did not create both assigned and unassigned leads");
  }

  const now = new Date().toISOString();
  const { error: conversationError } = await admin.from("whatsapp_conversations").insert({
    workspace_id: WS,
    contact_phone: PHONE,
    contact_name: "E2E Mobile Contact",
    status: "open",
    unread_count: 2,
    last_message_at: now,
    last_direction: "inbound",
    last_message_preview: "E2E mobile message",
  });
  if (conversationError) {
    throw new Error(`WhatsApp conversation fixture failed: ${conversationError.message}`);
  }
  const { error: messageError } = await admin.from("whatsapp_messages").insert({
    workspace_id: WS,
    contact_phone: PHONE,
    contact_name: "E2E Mobile Contact",
    direction: "inbound",
    body: "E2E mobile message",
    status: "delivered",
    sent_at: now,
  });
  if (messageError) throw new Error(`WhatsApp message fixture failed: ${messageError.message}`);

  invalidatePermissionsCache();
  ownerToken = await signIn(OWNER_EMAIL);
  agentToken = await signIn(AGENT_EMAIL);
}, 120_000);

afterAll(async () => {
  await admin.from("whatsapp_messages").delete().eq("workspace_id", WS);
  await admin.from("whatsapp_conversations").delete().eq("workspace_id", WS);
  await admin.from("lead_assignment_audit").delete().eq("workspace_id", WS);
  await admin.from("leads").delete().eq("workspace_id", WS);
  await admin.from("workspace_notification_settings").delete().eq("workspace_id", WS);
  await admin.from("workspace_user_notification_prefs").delete().eq("workspace_id", WS);
  await admin.from("workspace_subscriptions").delete().eq("workspace_id", WS);
  await admin.from("workspace_members").delete().eq("workspace_id", WS);
  await admin.from("workspaces").delete().eq("id", WS);
  await deleteUserAndOwnedWorkspaces(agentId);
  await deleteUserAndOwnedWorkspaces(ownerId);
}, 120_000);

describe("mobile API v1 real-login contract", () => {
  it("returns workspace capabilities and sales-agent access", async () => {
    const body = expectOk(
      await callApi("/api/v1/capabilities", agentToken),
      "/api/v1/capabilities",
    );
    expect(body.object).toBe("capabilities");
    expect(body.workspace_id).toBe(WS);
    expect(body.features).toBeTypeOf("object");
    expect(body.notification_capabilities).toBeTypeOf("object");
    expect(body.applicable_notification_events).toBeInstanceOf(Array);
    expect(body.user_access).toMatchObject({
      role_key: "sales_agent",
      assigned_records_only: true,
    });
  });

  it("returns the notification catalogue and round-trips personal preferences", async () => {
    const catalogue = expectOk(
      await callApi("/api/v1/notifications/catalogue", agentToken),
      "/api/v1/notifications/catalogue",
    );
    expect(catalogue.object).toBe("notification_catalogue");
    expect(catalogue.workspace_id).toBe(WS);
    expect(catalogue.capabilities).toBeTypeOf("object");
    expect(catalogue.events).toBeInstanceOf(Array);
    expect(catalogue.events.length).toBeGreaterThan(0);
    expect(catalogue.events[0]).toEqual(
      expect.objectContaining({
        key: expect.any(String),
        label: expect.any(String),
        category: expect.any(String),
        capability: expect.any(String),
        severity: expect.any(String),
        applicable: expect.any(Boolean),
        policy: expect.objectContaining({
          enabled: expect.any(Boolean),
          email_enabled: expect.any(Boolean),
          in_app_enabled: expect.any(Boolean),
          source: expect.any(String),
        }),
      }),
    );

    const before = expectOk(
      await callApi("/api/v1/notifications/preferences", agentToken),
      "/api/v1/notifications/preferences",
    );
    expect(before).toEqual(
      expect.objectContaining({
        object: "notification_preferences",
        workspace_id: WS,
        muted_event_keys: expect.any(Array),
      }),
    );
    const mutableKey =
      (catalogue.events as JsonRecord[]).find((event) => event.severity !== "critical")?.key ??
      NOTIFICATION_EVENT_KEYS[0];
    const after = expectOk(
      await callApi("/api/v1/notifications/preferences", agentToken, {
        method: "PUT",
        body: JSON.stringify({ muted_event_keys: [mutableKey] }),
      }),
      "/api/v1/notifications/preferences PUT",
    );
    expect(after).toEqual(
      expect.objectContaining({
        object: "notification_preferences",
        workspace_id: WS,
        muted_event_keys: [mutableKey],
        updated_at: expect.any(String),
      }),
    );
  });

  it("filters leads to the sales agent's assigned records only", async () => {
    const result = expectOk(await callApi("/api/v1/leads?limit=50", agentToken), "/api/v1/leads");
    expect(result.object).toBe("list");
    expect(result.data).toBeInstanceOf(Array);
    expect(result.assigned_records_only).toBe(true);
    expect(result.data).toContainEqual(expect.objectContaining({ id: assignedLeadId }));
    expect(result.data).not.toContainEqual(expect.objectContaining({ id: unassignedLeadId }));
    expect(result.data.every((lead: JsonRecord) => lead.assigned_to === agentId)).toBe(true);
  });

  it("covers assignment history, assignable members, and owner assignment", async () => {
    const history = expectOk(
      await callApi(`/api/v1/leads/assign?lead_id=${assignedLeadId}`, agentToken),
      "/api/v1/leads/assign GET",
    );
    expect(history).toEqual(expect.objectContaining({ object: "list", data: expect.any(Array) }));

    const agentMembers = expectOk(
      await callApi("/api/v1/members/assignable", agentToken),
      "/api/v1/members/assignable sales agent",
    );
    expect(agentMembers).toEqual({ object: "list", data: [] });

    const ownerMembers = expectOk(
      await callApi("/api/v1/members/assignable", ownerToken),
      "/api/v1/members/assignable owner",
    );
    expect(ownerMembers.object).toBe("list");
    expect(ownerMembers.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ userId: agentId })]),
    );

    const assigned = expectOk(
      await callApi("/api/v1/leads/assign", ownerToken, {
        method: "POST",
        body: JSON.stringify({ lead_ids: [unassignedLeadId], assigned_to: agentId }),
      }),
      "/api/v1/leads/assign POST",
    );
    expect(assigned).toEqual(
      expect.objectContaining({
        object: "assignment_result",
        updated: 1,
        skipped: 0,
      }),
    );

    const assignedHistory = expectOk(
      await callApi(`/api/v1/leads/assign?lead_id=${unassignedLeadId}`, agentToken),
      "/api/v1/leads/assign GET after POST",
    );
    expect(assignedHistory.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ assignedTo: agentId })]),
    );

    const restored = expectOk(
      await callApi("/api/v1/leads/assign", ownerToken, {
        method: "POST",
        body: JSON.stringify({ lead_ids: [unassignedLeadId], assigned_to: null }),
      }),
      "/api/v1/leads/assign POST restore",
    );
    expect(restored.updated).toBe(1);
  });

  it("returns WhatsApp threads, unread totals, and supports mark-read", async () => {
    const list = expectOk(
      await callApi("/api/v1/whatsapp/conversations?limit=10", agentToken),
      "/api/v1/whatsapp/conversations",
    );
    expect(list.object).toBe("list");
    expect(list.total).toBeTypeOf("number");
    const conversation = (list.data as JsonRecord[]).find((row) => row.contact_phone === PHONE);
    expect(conversation).toEqual(
      expect.objectContaining({
        contact_phone: PHONE,
        unread_count: expect.any(Number),
        lead_id: null,
      }),
    );
    // The live sync trigger may recalculate the seeded count from the
    // inbound message, so assert the endpoint's real positive count.
    expect(conversation.unread_count).toBeGreaterThan(0);

    const thread = expectOk(
      await callApi(
        `/api/v1/whatsapp/conversations?phone=${encodeURIComponent(PHONE)}`,
        agentToken,
      ),
      "/api/v1/whatsapp/conversations?phone",
    );
    expect(thread).toEqual(
      expect.objectContaining({
        object: "whatsapp_thread",
        thread: expect.objectContaining({ contact_phone: PHONE }),
        messages: expect.arrayContaining([
          expect.objectContaining({
            direction: "inbound",
            body: "E2E mobile message",
          }),
        ]),
      }),
    );

    const unread = expectOk(
      await callApi("/api/v1/whatsapp/unread-count", agentToken),
      "/api/v1/whatsapp/unread-count",
    );
    expect(unread).toEqual(
      expect.objectContaining({
        unread_conversations: 1,
        unread_messages: conversation.unread_count,
      }),
    );

    const marked = expectOk(
      await callApi("/api/v1/whatsapp/conversations/mark-read", agentToken, {
        method: "POST",
        body: JSON.stringify({ phone: PHONE }),
      }),
      "/api/v1/whatsapp/conversations/mark-read",
    );
    expect(marked).toEqual(expect.objectContaining({ ok: true, updated: expect.any(Number) }));
    const after = expectOk(
      await callApi("/api/v1/whatsapp/unread-count", agentToken),
      "/api/v1/whatsapp/unread-count after mark-read",
    );
    expect(after).toEqual({ unread_conversations: 0, unread_messages: 0 });
  });
});
