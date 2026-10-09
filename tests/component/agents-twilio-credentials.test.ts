import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Fake Twilio Account SIDs/tokens below are not real credentials — they exist
// only to prove the code paths under test and are never asserted in a way
// that would matter if leaked. No real Twilio API calls are made.

const mockAccountsCreate = vi.hoisted(() => vi.fn());

vi.mock("twilio", () => ({
  default: vi.fn((_accountSid: string, _authToken: string) => ({
    api: { v2010: { accounts: { create: mockAccountsCreate } } },
  })),
}));

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));

// agents.functions.ts imports a lot of unrelated server modules at module
// scope (voice provider factory, go-live service, etc.); stub the ones that
// would otherwise pull in real server/env dependencies just to import the
// file under test.
vi.mock("@/lib/providers/voice/factory", () => ({ createVoiceProviderWithFallback: vi.fn() }));
vi.mock("@/lib/agents/agent-golive.server", () => ({
  goLiveAgentService: vi.fn(),
  saveAgentPhoneNumberService: vi.fn(),
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: { server: (fn: unknown) => fn },
}));

import {
  resolveWorkspaceTwilioCredentials,
  tryResolveWorkspaceTwilioCredentials,
} from "@/lib/agents/agents.functions";

type FakeRow = { twilio_subaccount_sid: string; twilio_subaccount_auth_token: string };

/** Same minimal fake of workspace_twilio_subaccounts used in twilio-credentials.test.ts. */
function createFakeSubaccountsClient(store: Map<string, FakeRow>) {
  return {
    from(table: string) {
      if (table !== "workspace_twilio_subaccounts") {
        throw new Error(`unexpected table in test double: ${table}`);
      }
      return {
        select(_cols: string) {
          return {
            eq(_col: string, workspaceId: string) {
              return {
                async maybeSingle() {
                  return { data: store.get(workspaceId) ?? null };
                },
              };
            },
          };
        },
        async upsert(
          row: { workspace_id: string; twilio_subaccount_sid: string; twilio_subaccount_auth_token: string },
          _opts: { onConflict: string; ignoreDuplicates: boolean },
        ) {
          if (!store.has(row.workspace_id)) {
            store.set(row.workspace_id, {
              twilio_subaccount_sid: row.twilio_subaccount_sid,
              twilio_subaccount_auth_token: row.twilio_subaccount_auth_token,
            });
          }
          return { data: null, error: null };
        },
      };
    },
  };
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  mockAccountsCreate.mockReset();
  process.env.TWILIO_MASTER_ACCOUNT_SID = "ACmasterfaketest0000000000000000";
  process.env.TWILIO_MASTER_AUTH_TOKEN = "master_fake_token_for_tests_only";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("resolveWorkspaceTwilioCredentials", () => {
  it("returns the workspace's existing subaccount credentials", async () => {
    const workspaceId = "ws-1";
    const store = new Map<string, FakeRow>([
      [workspaceId, { twilio_subaccount_sid: "ACexisting", twilio_subaccount_auth_token: "token_existing" }],
    ]);
    const sb = createFakeSubaccountsClient(store);

    const result = await resolveWorkspaceTwilioCredentials(sb as any, workspaceId);

    expect(result).toEqual({ accountSid: "ACexisting", authToken: "token_existing" });
    expect(mockAccountsCreate).not.toHaveBeenCalled();
  });

  it("throws when no workspace context is available", async () => {
    const sb = createFakeSubaccountsClient(new Map());
    await expect(resolveWorkspaceTwilioCredentials(sb as any, null)).rejects.toThrow(
      /no workspace context available/i,
    );
    await expect(resolveWorkspaceTwilioCredentials(sb as any, undefined)).rejects.toThrow(
      /no workspace context available/i,
    );
    await expect(resolveWorkspaceTwilioCredentials(sb as any, "")).rejects.toThrow(
      /no workspace context available/i,
    );
    expect(mockAccountsCreate).not.toHaveBeenCalled();
  });

  it("propagates a subaccount-creation failure (e.g. master credentials missing)", async () => {
    delete process.env.TWILIO_MASTER_ACCOUNT_SID;
    const sb = createFakeSubaccountsClient(new Map());
    await expect(resolveWorkspaceTwilioCredentials(sb as any, "ws-2")).rejects.toThrow(
      /master Twilio account is not configured/i,
    );
  });
});

describe("tryResolveWorkspaceTwilioCredentials", () => {
  it("returns ok:true with credentials on success", async () => {
    const workspaceId = "ws-3";
    const store = new Map<string, FakeRow>([
      [workspaceId, { twilio_subaccount_sid: "ACok", twilio_subaccount_auth_token: "token_ok" }],
    ]);
    const sb = createFakeSubaccountsClient(store);

    const result = await tryResolveWorkspaceTwilioCredentials(sb as any, workspaceId);

    expect(result).toEqual({ ok: true, accountSid: "ACok", authToken: "token_ok" });
  });

  it("returns ok:false instead of throwing when no workspace context is available", async () => {
    const sb = createFakeSubaccountsClient(new Map());
    const result = await tryResolveWorkspaceTwilioCredentials(sb as any, null);
    expect(result).toEqual({ ok: false });
    expect(mockAccountsCreate).not.toHaveBeenCalled();
  });

  it("returns ok:false instead of throwing when subaccount resolution fails", async () => {
    delete process.env.TWILIO_MASTER_AUTH_TOKEN;
    const sb = createFakeSubaccountsClient(new Map());
    const result = await tryResolveWorkspaceTwilioCredentials(sb as any, "ws-4");
    expect(result).toEqual({ ok: false });
  });
});
