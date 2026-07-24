import { describe, it, expect } from "vitest";
import { runDbHealthWatchdogTick, getDbHealthWatchdogSnapshot } from "@/lib/maintenance/db-health-watchdog.server";

describe("db health watchdog", () => {
  it("probes health and records a healthy snapshot", async () => {
    const res = await runDbHealthWatchdogTick();
    expect(res.ran).toBe(true);
    expect(res.status).toBe("healthy");
    expect(res.alerted).toBe(false);
    const snap = getDbHealthWatchdogSnapshot();
    expect(snap.status).toBe("healthy");
    expect(snap.source).toBe("management_api");
    expect(snap.services.length).toBeGreaterThanOrEqual(3);
    expect(snap.consecutiveFailures).toBe(0);
    expect(snap.outageStartedAt).toBeNull();
  }, 30000);
});
