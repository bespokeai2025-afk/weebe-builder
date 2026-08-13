/**
 * emitCampaignNotification event-level dedup — a second identical emit
 * (same workspace + event + dedupeKey) must produce NO delivery work:
 * no executive mirror, no settings read, no in-app rows, no emails.
 */
import { describe, it, expect } from "vitest";
import { emitCampaignNotification } from "@/lib/notifications/notification-engine.shared";

const WS = "00000000-0000-0000-0000-000000000001";

/** Fake supabase client: in-memory ledger with real conflict semantics. */
function makeFakeSb() {
  const ledger = new Set<string>();
  const touchedTables: string[] = [];
  const sb: any = {
    from(table: string) {
      touchedTables.push(table);
      if (table === "notification_event_ledger") {
        return {
          upsert(row: any, opts: any) {
            return {
              select: async () => {
                const key = `${row.workspace_id}|${row.event_key}|${row.dedupe_key}`;
                if (opts?.ignoreDuplicates && ledger.has(key)) return { data: [], error: null };
                ledger.add(key);
                return { data: [{ id: "led-1" }], error: null };
              },
            };
          },
        };
      }
      // Any other table read: return empty results so the winner's path
      // terminates quickly (no settings row → defaults, no members → no
      // recipients) without ever throwing.
      const chain: any = {
        select: () => chain, eq: () => chain, in: () => chain, limit: () => chain,
        order: () => chain, insert: async () => ({ data: null, error: null }),
        upsert: () => chain,
        maybeSingle: async () => ({ data: null, error: null }),
        single: async () => ({ data: null, error: null }),
        then: (res: any) => res({ data: [], error: null }),
      };
      return chain;
    },
  };
  return { sb, touchedTables, ledger };
}

describe("emitCampaignNotification dedup", () => {
  it("second identical emit is fully suppressed after the ledger check", async () => {
    const { sb, touchedTables } = makeFakeSb();
    const input = {
      workspaceId: WS,
      eventKey: "appointments_booked",
      summary: "Booked",
      dedupeKey: "appointments_booked:call:call_123",
    };

    await emitCampaignNotification(sb, input as any); // winner
    const tablesAfterFirst = [...touchedTables];
    expect(tablesAfterFirst[0]).toBe("notification_event_ledger");
    expect(tablesAfterFirst.length).toBeGreaterThan(1); // winner proceeded

    touchedTables.length = 0;
    await emitCampaignNotification(sb, input as any); // duplicate
    // Loser must touch ONLY the ledger — nothing else (no mirror, no
    // settings read, no in-app inserts, no email).
    expect(touchedTables).toEqual(["notification_event_ledger"]);
  });

  it("different dedupeKey is not suppressed", async () => {
    const { sb, touchedTables } = makeFakeSb();
    await emitCampaignNotification(sb, {
      workspaceId: WS, eventKey: "appointments_booked", dedupeKey: "k1",
    } as any);
    touchedTables.length = 0;
    await emitCampaignNotification(sb, {
      workspaceId: WS, eventKey: "appointments_booked", dedupeKey: "k2",
    } as any);
    expect(touchedTables.length).toBeGreaterThan(1);
  });

  it("ledger error fails OPEN (notification still processed)", async () => {
    const touched: string[] = [];
    const sb: any = {
      from(table: string) {
        touched.push(table);
        if (table === "notification_event_ledger") {
          return { upsert: () => ({ select: async () => ({ data: null, error: { message: "down" } }) }) };
        }
        const chain: any = {
          select: () => chain, eq: () => chain, in: () => chain, limit: () => chain,
          order: () => chain, insert: async () => ({ data: null, error: null }),
          maybeSingle: async () => ({ data: null, error: null }),
          then: (res: any) => res({ data: [], error: null }),
        };
        return chain;
      },
    };
    await emitCampaignNotification(sb, {
      workspaceId: WS, eventKey: "appointments_booked", dedupeKey: "k1",
    } as any);
    expect(touched.length).toBeGreaterThan(1); // proceeded past broken ledger
  });
});
