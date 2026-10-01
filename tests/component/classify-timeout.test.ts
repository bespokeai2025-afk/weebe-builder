/**
 * classify() and extract() must fail fast, not inherit gpt.ts's 25s default timeout. Both sit on
 * the critical path of every turn (before the agent can speak or route) and both already degrade
 * gracefully on failure — a slow response should hit that fallback quickly, not hold the caller in
 * dead air. Observed on a real call: a single classify request took 12.3s, well under the old 25s
 * ceiling, so it never errored — it just went silent mid-turn while the caller was mid-email.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/voice/llm/gpt", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/voice/llm/gpt")>();
  return { ...actual, gptComplete: vi.fn(async () => '{"transition": 1}') };
});

describe("createOpenAiVmLlm — background call timeouts", () => {
  it("classify() requests a short timeout, not gpt.ts's 25s default", async () => {
    const { createOpenAiVmLlm } = await import("@/lib/voice/graph/llm");
    const { gptComplete } = await import("@/lib/voice/llm/gpt");
    const llm = createOpenAiVmLlm({ apiKey: "sk-test", provider: "openai" });

    await llm.classify([{ role: "user", content: "yes" }], ["a", "b"]);

    expect(gptComplete).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ timeoutMs: 4_000 }),
    );
  });

  it("extract() requests a short timeout too", async () => {
    const { createOpenAiVmLlm } = await import("@/lib/voice/graph/llm");
    const { gptComplete } = await import("@/lib/voice/llm/gpt");
    vi.mocked(gptComplete).mockResolvedValueOnce("{}");
    const llm = createOpenAiVmLlm({ apiKey: "sk-test", provider: "openai" });

    await llm.extract([{ role: "user", content: "four bedrooms" }], [
      { name: "bedrooms", description: "count", type: "number" },
    ]);

    expect(gptComplete).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ timeoutMs: 4_000 }),
    );
  });
});
