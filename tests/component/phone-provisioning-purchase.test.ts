import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  purchaseVoiceNumberCore,
  type PurchaseVoiceNumberDeps,
  type PurchaseVoiceNumberInput,
} from "@/lib/telephony/phone-provisioning.functions";

// Fake SIDs/tokens below are not real credentials — used only to prove the
// code paths under test. No real Twilio API calls or Stripe charges happen
// anywhere in this file; purchase/credentials/pricing are all mocked deps.

type LockRow = { workspace_id: string; phone_number: string };

/** Minimal fake of phone_number_purchase_locks: insert (unique PK) + delete. */
function createFakeLockClient(store: Map<string, LockRow>) {
  const key = (ws: string, num: string) => `${ws}::${num}`;
  return {
    from(table: string) {
      if (table !== "phone_number_purchase_locks") {
        throw new Error(`unexpected table in test double: ${table}`);
      }
      return {
        async insert(row: LockRow) {
          const k = key(row.workspace_id, row.phone_number);
          if (store.has(k)) {
            return { data: null, error: { code: "23505", message: "duplicate key" } };
          }
          store.set(k, row);
          return { data: null, error: null };
        },
        delete() {
          return {
            eq(_col1: string, ws: string) {
              return {
                async eq(_col2: string, num: string) {
                  store.delete(key(ws, num));
                  return { data: null, error: null };
                },
              };
            },
          };
        },
      };
    },
  };
}

const INPUT: PurchaseVoiceNumberInput = {
  phoneNumber: "+15551234567",
  friendlyName: "Front Desk",
  agentId: "agent-1",
  capabilities: { voice: true, sms: false },
  country: "US",
  tollFree: false,
};
const WORKSPACE_ID = "ws-1";

function buildDeps(overrides: Partial<PurchaseVoiceNumberDeps> = {}): PurchaseVoiceNumberDeps {
  return {
    resolveSubaccount: vi.fn().mockResolvedValue({ accountSid: "ACsub", authToken: "tok_sub" }),
    fetchPrice: vi.fn().mockResolvedValue({
      isoCountry: "US",
      numberType: "local",
      currentPriceUsd: 1.15,
      basePriceUsd: 1.0,
      priceUnit: "USD",
    }),
    resolveMarkup: vi.fn().mockResolvedValue({ markupType: "fixed", markupValue: 150, fxRateUsdToGbp: 0.8 }),
    computePrice: vi.fn().mockReturnValue({ costUsdCents: 115, costGbpPence: 92, priceGbpPence: 242 }),
    purchase: vi.fn().mockResolvedValue({ sid: "PNsid", phoneNumber: "+15551234567", friendlyName: "Front Desk", voiceUrl: "https://x/inbound" }),
    saveRow: vi.fn().mockResolvedValue("row-id-1"),
    ...overrides,
  };
}

let store: Map<string, LockRow>;
let sb: ReturnType<typeof createFakeLockClient>;

beforeEach(() => {
  store = new Map();
  sb = createFakeLockClient(store);
});

describe("purchaseVoiceNumberCore", () => {
  it("1. succeeds end-to-end with dry-run-style mocked deps", async () => {
    const deps = buildDeps();
    const result = await purchaseVoiceNumberCore(sb as any, WORKSPACE_ID, INPUT, deps);

    expect(result).toEqual({ id: "row-id-1", phoneNumber: "+15551234567", sid: "PNsid", priceGbpPence: 242 });
    expect(store.size).toBe(0); // lock released
  });

  it("2. resolves the workspace's WEBEE-managed subaccount, not BYOK", async () => {
    const deps = buildDeps();
    await purchaseVoiceNumberCore(sb as any, WORKSPACE_ID, INPUT, deps);

    expect(deps.resolveSubaccount).toHaveBeenCalledWith(sb, WORKSPACE_ID);
    // The purchase call must receive exactly those resolved credentials.
    expect(deps.purchase).toHaveBeenCalledWith(
      expect.objectContaining({ credentials: { accountSid: "ACsub", authToken: "tok_sub" } }),
    );
  });

  it("3. fetches Twilio's real price and applies the markup rule for local vs toll-free", async () => {
    const deps = buildDeps();
    await purchaseVoiceNumberCore(sb as any, WORKSPACE_ID, { ...INPUT, tollFree: true }, deps);

    expect(deps.fetchPrice).toHaveBeenCalledWith(sb, { isoCountry: "US", numberType: "toll free" });
    expect(deps.resolveMarkup).toHaveBeenCalledWith(sb, WORKSPACE_ID);
    expect(deps.computePrice).toHaveBeenCalledWith(1.15, { markupType: "fixed", markupValue: 150, fxRateUsdToGbp: 0.8 });
  });

  it("4. snapshots the computed price and subaccount onto the saved row", async () => {
    const deps = buildDeps();
    await purchaseVoiceNumberCore(sb as any, WORKSPACE_ID, INPUT, deps);

    expect(deps.saveRow).toHaveBeenCalledWith(
      expect.objectContaining({
        twilioSubaccountSid: "ACsub",
        costUsdCentsMonthly: 115,
        priceGbpPenceMonthly: 242,
      }),
    );
    // Changing what the markup rule WOULD compute now must not be able to
    // reach back and alter what was already saved — there is no recompute
    // path; the snapshot is whatever was true at call time.
  });

  it("5. idempotency: a second purchase attempt for the same (workspace, number) is rejected before touching Twilio", async () => {
    const deps = buildDeps();
    // Simulate the first call being "in flight" by pre-occupying the lock.
    store.set(`${WORKSPACE_ID}::${INPUT.phoneNumber}`, { workspace_id: WORKSPACE_ID, phone_number: INPUT.phoneNumber });

    await expect(purchaseVoiceNumberCore(sb as any, WORKSPACE_ID, INPUT, deps)).rejects.toThrow(
      /already in progress/i,
    );
    expect(deps.resolveSubaccount).not.toHaveBeenCalled();
    expect(deps.purchase).not.toHaveBeenCalled();
    // The pre-existing lock (simulating the other in-flight request) is left alone.
    expect(store.size).toBe(1);
  });

  it("6. failure before purchase (subaccount resolution fails) never calls Twilio, and releases the lock", async () => {
    const deps = buildDeps({ resolveSubaccount: vi.fn().mockRejectedValue(new Error("master account not configured")) });

    await expect(purchaseVoiceNumberCore(sb as any, WORKSPACE_ID, INPUT, deps)).rejects.toThrow(
      /master account not configured/i,
    );
    expect(deps.purchase).not.toHaveBeenCalled();
    expect(deps.saveRow).not.toHaveBeenCalled();
    expect(store.size).toBe(0); // lock still released despite the failure
  });

  it("7. failure after the Twilio purchase (DB save fails): logs loudly and still releases the lock", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const deps = buildDeps({ saveRow: vi.fn().mockRejectedValue(new Error("db unavailable")) });

    await expect(purchaseVoiceNumberCore(sb as any, WORKSPACE_ID, INPUT, deps)).rejects.toThrow(/db unavailable/i);

    expect(deps.purchase).toHaveBeenCalledTimes(1); // the real (mocked) purchase DID happen
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("CRITICAL"),
      expect.anything(),
    );
    expect(store.size).toBe(0); // lock released even on this failure path

    consoleError.mockRestore();
  });

  it("releases the lock on an unexpected (non-conflict) lock-insert error too, by never having acquired one", async () => {
    const deps = buildDeps();
    const brokenSb = {
      from(table: string) {
        if (table !== "phone_number_purchase_locks") throw new Error("unexpected table");
        return { insert: async () => ({ data: null, error: { code: "OTHER", message: "connection refused" } }) };
      },
    };

    await expect(purchaseVoiceNumberCore(brokenSb as any, WORKSPACE_ID, INPUT, deps)).rejects.toThrow(
      /could not acquire purchase lock/i,
    );
    expect(deps.resolveSubaccount).not.toHaveBeenCalled();
  });
});
