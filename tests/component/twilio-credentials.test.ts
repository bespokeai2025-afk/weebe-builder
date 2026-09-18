import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Fake Twilio Account SIDs/tokens below are not real credentials — they exist
// only to prove the code paths under test, never printed or asserted in a way
// that would matter if leaked, and never touch the real Twilio API.

const mockAccountsCreate = vi.hoisted(() => vi.fn());

vi.mock("twilio", () => ({
  default: vi.fn((_accountSid: string, _authToken: string) => ({
    api: { v2010: { accounts: { create: mockAccountsCreate } } },
  })),
}));

import {
  resolveOrCreateWorkspaceSubaccount,
} from "@/lib/telephony/twilio-credentials.server";
import { resolveMasterTwilioCredentials } from "@/lib/telephony/twilio-env";

type FakeRow = { twilio_subaccount_sid: string; twilio_subaccount_auth_token: string };

/** Minimal fake of the one Supabase table this function touches. */
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
          // ignoreDuplicates semantics: a row already present wins; this call becomes a no-op.
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

describe("resolveOrCreateWorkspaceSubaccount", () => {
  it("returns the existing row without creating a Twilio subaccount", async () => {
    const workspaceId = "ws-existing";
    const store = new Map<string, FakeRow>([
      [workspaceId, { twilio_subaccount_sid: "ACexisting", twilio_subaccount_auth_token: "token_existing" }],
    ]);
    const sb = createFakeSubaccountsClient(store);

    const result = await resolveOrCreateWorkspaceSubaccount(sb as any, workspaceId);

    expect(result).toEqual({ accountSid: "ACexisting", authToken: "token_existing" });
    expect(mockAccountsCreate).not.toHaveBeenCalled();
  });

  it("creates a Twilio subaccount and persists it when no row exists", async () => {
    const workspaceId = "ws-new";
    const store = new Map<string, FakeRow>();
    mockAccountsCreate.mockResolvedValueOnce({
      sid: "ACnewsub",
      authToken: "token_new",
      friendlyName: `WEBEE workspace ${workspaceId}`,
    });
    const sb = createFakeSubaccountsClient(store);

    const result = await resolveOrCreateWorkspaceSubaccount(sb as any, workspaceId);

    expect(mockAccountsCreate).toHaveBeenCalledTimes(1);
    expect(mockAccountsCreate).toHaveBeenCalledWith({ friendlyName: `WEBEE workspace ${workspaceId}` });
    expect(result).toEqual({ accountSid: "ACnewsub", authToken: "token_new" });
    expect(store.get(workspaceId)).toEqual({
      twilio_subaccount_sid: "ACnewsub",
      twilio_subaccount_auth_token: "token_new",
    });
  });

  it("on an insert conflict, returns the row another concurrent call already persisted — not its own", async () => {
    const workspaceId = "ws-race";
    const store = new Map<string, FakeRow>();
    // Simulates a second concurrent caller finishing its own full cycle
    // (create + upsert) while this call is still awaiting its own Twilio
    // create() — by the time this call reaches its own upsert, the row
    // already exists.
    mockAccountsCreate.mockImplementationOnce(async () => {
      store.set(workspaceId, { twilio_subaccount_sid: "ACwinner", twilio_subaccount_auth_token: "token_winner" });
      return { sid: "ACloser", authToken: "token_loser", friendlyName: `WEBEE workspace ${workspaceId}` };
    });
    const sb = createFakeSubaccountsClient(store);

    const result = await resolveOrCreateWorkspaceSubaccount(sb as any, workspaceId);

    // It did attempt its own create (unavoidable without a distributed lock,
    // out of scope for this dormant, not-yet-wired function) — but the
    // re-select after upsert must return the row that actually won, not the
    // credentials this call happened to create itself.
    expect(mockAccountsCreate).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ accountSid: "ACwinner", authToken: "token_winner" });
    expect(store.size).toBe(1);
  });
});

describe("resolveMasterTwilioCredentials", () => {
  it("returns accountSid/authToken when both env vars are set", () => {
    process.env.TWILIO_MASTER_ACCOUNT_SID = "ACmasterfaketest0000000000000000";
    process.env.TWILIO_MASTER_AUTH_TOKEN = "master_fake_token_for_tests_only";

    expect(resolveMasterTwilioCredentials()).toEqual({
      accountSid: "ACmasterfaketest0000000000000000",
      authToken: "master_fake_token_for_tests_only",
    });
  });

  it("throws when TWILIO_MASTER_ACCOUNT_SID is missing", () => {
    delete process.env.TWILIO_MASTER_ACCOUNT_SID;
    expect(() => resolveMasterTwilioCredentials()).toThrow(/master Twilio account is not configured/i);
  });

  it("throws when TWILIO_MASTER_AUTH_TOKEN is missing", () => {
    delete process.env.TWILIO_MASTER_AUTH_TOKEN;
    expect(() => resolveMasterTwilioCredentials()).toThrow(/master Twilio account is not configured/i);
  });

  it("throws when both env vars are unset", () => {
    delete process.env.TWILIO_MASTER_ACCOUNT_SID;
    delete process.env.TWILIO_MASTER_AUTH_TOKEN;
    expect(() => resolveMasterTwilioCredentials()).toThrow(/master Twilio account is not configured/i);
  });

  it("treats whitespace-only env values as unset", () => {
    process.env.TWILIO_MASTER_ACCOUNT_SID = "   ";
    process.env.TWILIO_MASTER_AUTH_TOKEN = "master_fake_token_for_tests_only";
    expect(() => resolveMasterTwilioCredentials()).toThrow(/master Twilio account is not configured/i);
  });
});
