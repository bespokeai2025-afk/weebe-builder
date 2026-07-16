/**
 * E2E tests for the workspace email provider dispatch layer (Task #370).
 *
 * Runs against the REAL shared Supabase database (service role) using
 * throw-away random workspaces, and cleans up everything it creates.
 * Custom-provider sends use a bogus API key (Resend rejects with 401) with
 * fallback_to_platform disabled, so no real emails are ever delivered.
 *
 * Run: npx vitest run --config vitest.e2e.config.ts tests/e2e/email-provider-dispatch.e2e.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  encryptEmailProviderConfig,
  decryptEmailProviderConfig,
  resolveWorkspaceEmailProvider,
  sendWorkspaceEmail,
  FAILURE_ALERT_THRESHOLD,
} from "@/lib/email/email-dispatch.server";

const sb = supabaseAdmin as any;
const PARENT = randomUUID();
const CHILD = randomUUID();

let ownerUserId: string;
const clientAccountIds: string[] = [];

beforeAll(async () => {
  const { data: profiles, error: pErr } = await sb
    .from("profiles")
    .select("user_id")
    .limit(1);
  if (pErr) throw new Error(pErr.message);
  if (!profiles?.length) throw new Error("Need an existing user");
  ownerUserId = profiles[0].user_id;

  for (const [id, name] of [
    [PARENT, "E2E email parent (safe to delete)"],
    [CHILD, "E2E email child (safe to delete)"],
  ] as const) {
    const { error } = await sb.from("workspaces").insert({
      id,
      name,
      slug: `e2e-email-${id.slice(0, 8)}`,
      owner_id: ownerUserId,
    });
    if (error) throw new Error(error.message);
    const { error: mErr } = await sb
      .from("workspace_members")
      .insert({ workspace_id: id, user_id: ownerUserId, role: "owner" });
    if (mErr) throw new Error(mErr.message);
  }

  const { error: relErr } = await sb.from("workspace_relationships").insert({
    parent_workspace_id: PARENT,
    child_workspace_id: CHILD,
    status: "active",
  });
  if (relErr) throw new Error(relErr.message);

  const { data: acc, error: accErr } = await sb
    .from("reseller_client_accounts")
    .insert({
      parent_workspace_id: PARENT,
      child_workspace_id: CHILD,
      client_name: "E2E email child",
      client_email: `e2e-email-${CHILD.slice(0, 8)}@example.com`,
      package_key: "business_command",
      branding_mode: "inherit",
      status: "active",
    })
    .select("id")
    .single();
  if (accErr) throw new Error(accErr.message);
  clientAccountIds.push(acc.id);
});

afterAll(async () => {
  await sb.from("workspace_email_provider_settings").delete().in("workspace_id", [PARENT, CHILD]);
  await sb.from("workspace_notifications").delete().in("workspace_id", [PARENT, CHILD]);
  if (clientAccountIds.length) {
    await sb.from("reseller_client_accounts").delete().in("id", clientAccountIds);
  }
  await sb.from("workspace_relationships").delete().eq("child_workspace_id", CHILD);
  await sb.from("workspace_members").delete().in("workspace_id", [PARENT, CHILD]);
  await sb.from("workspaces").delete().in("id", [PARENT, CHILD]);
});

async function upsertSettings(workspaceId: string, patch: Record<string, unknown>) {
  await sb.from("workspace_email_provider_settings").delete().eq("workspace_id", workspaceId);
  const { error } = await sb.from("workspace_email_provider_settings").insert({
    workspace_id: workspaceId,
    provider: "resend",
    sending_mode: "custom",
    is_active: true,
    fallback_to_platform: true,
    encrypted_config: encryptEmailProviderConfig({ api_key: "re_bogus_e2e_key" }),
    from_name: "E2E Sender",
    from_email: "e2e@example.com",
    ...patch,
  });
  if (error) throw new Error(error.message);
}

describe("credential encryption", () => {
  it("round-trips config and never stores plaintext", () => {
    const blob = encryptEmailProviderConfig({ api_key: "re_secret_123" });
    expect(JSON.stringify(blob)).not.toContain("re_secret_123");
    expect(decryptEmailProviderConfig(blob)).toEqual({ api_key: "re_secret_123" });
  });

  it("returns {} for empty/corrupt blobs", () => {
    expect(decryptEmailProviderConfig(null)).toEqual({});
    expect(decryptEmailProviderConfig({})).toEqual({});
    expect(decryptEmailProviderConfig({ _enc: "deadbeef" })).toEqual({});
    expect(decryptEmailProviderConfig({ _enc: "00:zz" })).toEqual({});
  });
});

describe("provider resolution priority", () => {
  it("falls back to platform when no settings row exists", async () => {
    const p = await resolveWorkspaceEmailProvider(sb, CHILD);
    expect(p.source).toBe("platform_default");
  });

  it("uses the workspace's own active custom provider first", async () => {
    await upsertSettings(CHILD, { reply_to_email: "reply@example.com" });
    const p = await resolveWorkspaceEmailProvider(sb, CHILD);
    expect(p.source).toBe("workspace_custom");
    expect(p.apiKey).toBe("re_bogus_e2e_key");
    expect(p.from).toBe("E2E Sender <e2e@example.com>");
    expect(p.replyTo).toBe("reply@example.com");
  });

  it("ignores inactive or platform_default-mode rows", async () => {
    await upsertSettings(CHILD, { is_active: false });
    expect((await resolveWorkspaceEmailProvider(sb, CHILD)).source).toBe("platform_default");
    await upsertSettings(CHILD, { sending_mode: "platform_default" });
    expect((await resolveWorkspaceEmailProvider(sb, CHILD)).source).toBe("platform_default");
  });

  it("inherits the reseller parent's provider when child inherits branding", async () => {
    await sb.from("workspace_email_provider_settings").delete().eq("workspace_id", CHILD);
    await upsertSettings(PARENT, { from_email: "parent@example.com", from_name: null });
    const p = await resolveWorkspaceEmailProvider(sb, CHILD);
    expect(p.source).toBe("parent_custom");
    expect(p.settingsWorkspaceId).toBe(PARENT);
    expect(p.from).toBe("parent@example.com");
  });

  it("does NOT inherit when the child's branding_mode is custom", async () => {
    await sb
      .from("reseller_client_accounts")
      .update({ branding_mode: "custom" })
      .eq("id", clientAccountIds[0]);
    const p = await resolveWorkspaceEmailProvider(sb, CHILD);
    expect(p.source).toBe("platform_default");
    await sb
      .from("reseller_client_accounts")
      .update({ branding_mode: "inherit" })
      .eq("id", clientAccountIds[0]);
  });
});

describe("failure bookkeeping + admin alert", () => {
  it(
    "counts consecutive failures and alerts admins at the threshold (no fallback, no real email)",
    { timeout: 60_000 },
    async () => {
      await sb.from("workspace_email_provider_settings").delete().eq("workspace_id", PARENT);
      await upsertSettings(CHILD, { fallback_to_platform: false });

      let last: Awaited<ReturnType<typeof sendWorkspaceEmail>> | null = null;
      for (let i = 0; i < FAILURE_ALERT_THRESHOLD; i++) {
        last = await sendWorkspaceEmail(sb, {
          workspaceId: CHILD,
          to: "nobody@example.com",
          subject: "e2e failure test",
          html: "<p>e2e</p>",
        });
        expect(last.success).toBe(false);
        expect(last.providerUsed).toBe("workspace_custom");
        expect(last.fellBack).toBe(false);
      }

      const { data: row } = await sb
        .from("workspace_email_provider_settings")
        .select("consecutive_failures, last_send_status, last_send_error")
        .eq("workspace_id", CHILD)
        .maybeSingle();
      expect(row?.consecutive_failures).toBe(FAILURE_ALERT_THRESHOLD);
      expect(row?.last_send_status).toBe("failed");
      // Provider-code errors only — never raw provider response bodies with secrets.
      expect(row?.last_send_error).toMatch(/^resend_http_|^custom_provider_network_error$/);

      const { data: alerts } = await sb
        .from("workspace_notifications")
        .select("id, title, severity, recipient_user_id")
        .eq("workspace_id", CHILD)
        .eq("title", "Custom email provider is failing");
      expect((alerts ?? []).length).toBeGreaterThan(0);
      expect(alerts![0].severity).toBe("critical");
    },
  );
});
