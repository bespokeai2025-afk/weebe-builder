/**
 * Rerun resets the job before replaying it. `next_retry_at` is NOT NULL in wbah_post_call_jobs, so
 * resetting it to null failed every rerun ("null value in column next_retry_at violates not-null
 * constraint"). It is set ahead instead, which also keeps the retry poller off the job meanwhile.
 */
import { describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ updates: [] as Array<Record<string, unknown>> }));

vi.mock("@/integrations/supabase/client.server", () => {
  const row = {
    id: "job-1",
    workspace_id: "ws",
    status: "completed",
    payload: { call: { call_id: "call_1" } },
    attempt_count: 1,
  };
  const chain = (result: unknown): any => {
    const c: any = {
      eq: () => c,
      or: () => c,
      in: () => c,
      select: () => chain({ data: [], error: null }),
      maybeSingle: async () => ({ data: row, error: null }),
      then: (resolve: (v: unknown) => unknown) => resolve(result),
    };
    return c;
  };
  return {
    supabaseAdmin: {
      from: () => ({
        select: () => chain({ data: row, error: null }),
        update: (values: Record<string, unknown>) => {
          db.updates.push(values);
          // The NOT NULL constraint, as Postgres enforces it.
          const error =
            "next_retry_at" in values && values.next_retry_at == null
              ? { message: 'null value in column "next_retry_at" violates not-null constraint' }
              : null;
          return chain({ data: [], error });
        },
      }),
    },
  };
});

import { rerunWbahPostCallJob } from "@/lib/wbah/post-call/wbah-post-call-queue.server";

describe("rerun", () => {
  it("resets the job with a due time, never null, set ahead of now", async () => {
    const before = Date.now();
    await rerunWbahPostCallJob("ws", "job-1");
    const reset = db.updates[0]!;
    expect(reset.status).toBe("pending");
    expect(reset.next_retry_at).toEqual(expect.any(String));
    expect(new Date(String(reset.next_retry_at)).getTime()).toBeGreaterThan(before + 60_000);
  });
});
