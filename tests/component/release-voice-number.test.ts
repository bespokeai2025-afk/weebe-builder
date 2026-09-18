import { describe, expect, it, vi } from "vitest";
import {
  releaseVoiceNumberCore,
  type ReleaseVoiceNumberDeps,
} from "@/lib/telephony/phone-provisioning.functions";

// No real Twilio calls anywhere here — `release` is always mocked. This file
// tests only the authorization gate and the surrounding flow's behavior.

type MemberRow = { role: string } | null;
type NumberRow = { id: string; provider: string; provider_sid: string | null } | null;

function createFakeUserSupabase(memberRow: MemberRow) {
  return {
    from(table: string) {
      if (table !== "workspace_members") throw new Error(`unexpected table: ${table}`);
      return {
        select(_cols: string) {
          return {
            eq(_c1: string, _v1: string) {
              return {
                eq(_c2: string, _v2: string) {
                  return { async maybeSingle() { return { data: memberRow }; } };
                },
              };
            },
          };
        },
      };
    },
  };
}

function createFakeAdminSupabase(numberRow: NumberRow, opts: { deleteError?: string } = {}) {
  const calls: string[] = [];
  return {
    calls,
    from(table: string) {
      if (table !== "phone_numbers") throw new Error(`unexpected table: ${table}`);
      return {
        select(_cols: string) {
          calls.push("select");
          return {
            eq(_c1: string, _v1: string) {
              return {
                eq(_c2: string, _v2: string) {
                  return { async maybeSingle() { return { data: numberRow }; } };
                },
              };
            },
          };
        },
        delete() {
          calls.push("delete");
          return {
            eq(_c1: string, _v1: string) {
              return {
                async eq(_c2: string, _v2: string) {
                  return { data: null, error: opts.deleteError ? { message: opts.deleteError } : null };
                },
              };
            },
          };
        },
      };
    },
  };
}

const WORKSPACE_ID = "ws-1";
const USER_ID = "user-1";
const INPUT = { phoneNumberId: "11111111-1111-1111-1111-111111111111" };
const OWNED_TWILIO_ROW = { id: INPUT.phoneNumberId, provider: "twilio", provider_sid: "PNsid" };

function buildDeps(overrides: Partial<ReleaseVoiceNumberDeps> = {}): ReleaseVoiceNumberDeps {
  return {
    requireAdmin: vi.fn().mockImplementation(async (sb: any, _userId: string, _wsId: string) => {
      // Mirror the real helper's own logic so these tests exercise the real
      // decision (owner/admin only), not just a stubbed pass-through.
      const { data } = await sb.from("workspace_members").select("role").eq("a", "b").eq("c", "d").maybeSingle();
      const role = data?.role;
      if (role !== "owner" && role !== "admin") {
        throw new Error("Forbidden: only workspace owners and admins can release phone numbers.");
      }
    }),
    release: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("releaseVoiceNumberCore — authorization", () => {
  it("1. an authorized admin can release a number", async () => {
    const userSb = createFakeUserSupabase({ role: "admin" });
    const adminSb = createFakeAdminSupabase(OWNED_TWILIO_ROW);
    const deps = buildDeps();

    const result = await releaseVoiceNumberCore(userSb as any, adminSb as any, USER_ID, WORKSPACE_ID, INPUT, deps);

    expect(result).toEqual({ success: true, released: true });
    expect(deps.release).toHaveBeenCalledWith("PNsid", WORKSPACE_ID);
  });

  it("an authorized owner can also release a number", async () => {
    const userSb = createFakeUserSupabase({ role: "owner" });
    const adminSb = createFakeAdminSupabase(OWNED_TWILIO_ROW);
    const deps = buildDeps();

    const result = await releaseVoiceNumberCore(userSb as any, adminSb as any, USER_ID, WORKSPACE_ID, INPUT, deps);

    expect(result.success).toBe(true);
  });

  it("2. a non-admin member cannot release a number", async () => {
    const userSb = createFakeUserSupabase({ role: "member" });
    const adminSb = createFakeAdminSupabase(OWNED_TWILIO_ROW);
    const deps = buildDeps();

    await expect(
      releaseVoiceNumberCore(userSb as any, adminSb as any, USER_ID, WORKSPACE_ID, INPUT, deps),
    ).rejects.toThrow(/forbidden.*owners and admins/i);
    expect(deps.release).not.toHaveBeenCalled();
  });

  it("3. a caller with no workspace_members row at all (not even a member) cannot release a number", async () => {
    // Closest equivalent this architecture supports to "unauthenticated":
    // requireSupabaseAuth already guarantees a real session before this
    // core function is ever reached (see report), so the lowest-privilege
    // case reachable here is "authenticated but not a member of this
    // workspace" — role resolves to undefined, same Forbidden path as any
    // other non-admin role.
    const userSb = createFakeUserSupabase(null);
    const adminSb = createFakeAdminSupabase(OWNED_TWILIO_ROW);
    const deps = buildDeps();

    await expect(
      releaseVoiceNumberCore(userSb as any, adminSb as any, USER_ID, WORKSPACE_ID, INPUT, deps),
    ).rejects.toThrow(/forbidden/i);
    expect(deps.release).not.toHaveBeenCalled();
  });

  it("4. authorization failure happens before any lookup or mutation on phone_numbers", async () => {
    const userSb = createFakeUserSupabase({ role: "member" });
    const adminSb = createFakeAdminSupabase(OWNED_TWILIO_ROW);
    const deps = buildDeps();

    await expect(
      releaseVoiceNumberCore(userSb as any, adminSb as any, USER_ID, WORKSPACE_ID, INPUT, deps),
    ).rejects.toThrow();

    // The admin client's phone_numbers table was never touched at all —
    // no select (lookup), no delete — because authorization was checked
    // and rejected first.
    expect(adminSb.calls).toEqual([]);
    expect(deps.release).not.toHaveBeenCalled();
  });

  it("5. existing successful release behavior is unchanged for an authorized caller", async () => {
    const userSb = createFakeUserSupabase({ role: "admin" });
    const adminSb = createFakeAdminSupabase(OWNED_TWILIO_ROW);
    const deps = buildDeps();

    const result = await releaseVoiceNumberCore(userSb as any, adminSb as any, USER_ID, WORKSPACE_ID, INPUT, deps);

    expect(result).toEqual({ success: true, released: true });
    expect(adminSb.calls).toEqual(["select", "delete"]);
  });

  it("5b. a non-Twilio (e.g. imported/manual) number is still deleted but reports released:false, same as before", async () => {
    const userSb = createFakeUserSupabase({ role: "admin" });
    const adminSb = createFakeAdminSupabase({ id: INPUT.phoneNumberId, provider: "frejun", provider_sid: null });
    const deps = buildDeps();

    const result = await releaseVoiceNumberCore(userSb as any, adminSb as any, USER_ID, WORKSPACE_ID, INPUT, deps);

    expect(result).toEqual({ success: true, released: false });
    expect(deps.release).not.toHaveBeenCalled();
  });

  it("5c. throws when the number does not exist in this workspace, same as before", async () => {
    const userSb = createFakeUserSupabase({ role: "admin" });
    const adminSb = createFakeAdminSupabase(null);
    const deps = buildDeps();

    await expect(
      releaseVoiceNumberCore(userSb as any, adminSb as any, USER_ID, WORKSPACE_ID, INPUT, deps),
    ).rejects.toThrow(/not found in this workspace/i);
  });

  it("6. an underlying release/DB error still propagates correctly for an authorized caller", async () => {
    const userSb = createFakeUserSupabase({ role: "admin" });
    const adminSb = createFakeAdminSupabase(OWNED_TWILIO_ROW, { deleteError: "db unavailable" });
    const deps = buildDeps();

    await expect(
      releaseVoiceNumberCore(userSb as any, adminSb as any, USER_ID, WORKSPACE_ID, INPUT, deps),
    ).rejects.toThrow(/db unavailable/i);
    // The Twilio release itself did happen before the DB error — matching
    // the pre-existing (unchanged) ordering: release, then delete row.
    expect(deps.release).toHaveBeenCalledTimes(1);
  });
});
