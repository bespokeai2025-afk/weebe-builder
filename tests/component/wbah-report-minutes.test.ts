/** WBAH report minutes use exact call durations, the same rule as the Credits page. */
import { describe, expect, it } from "vitest";
import { computeWbahRunKpis } from "@/lib/integrations/webespokeEnterprise/wbah-campaign-reporting.server";

describe("computeWbahRunKpis minutes", () => {
  it("uses exact milliseconds when stored, whole seconds otherwise", () => {
    const kpis = computeWbahRunKpis([
      { duration_seconds: 59, meta: { duration_ms: 59_900 } }, // Retell cut 59.9 s to 59 s
      { duration_seconds: 60, meta: { duration_ms: 60_400 } },
      { duration_seconds: 30, meta: {} },
    ]);
    // 59.9 + 60.4 + 30 = 150.3 s = 2.505 min → 2.51 (truncated seconds would give 2.48)
    expect(kpis.minutes_used).toBe(2.51);
  });
});
