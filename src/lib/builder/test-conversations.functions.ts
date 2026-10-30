/**
 * Run the builder's saved test conversations against the flow currently on screen.
 *
 * The flow is the same export a builder test call sends, and each test gets a fresh engine
 * (buildGraphRuntime + replayThroughVm, as shadow testing uses), so a run sees exactly what a live
 * call on this draft would do. Text only; each agent turn is one model call.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  evaluateTestConversation,
  normalizeTestConversations,
  type TestConversationResult,
} from "./test-conversations.shared";

/** Tests run this many at a time. */
const CONCURRENCY = 3;

export const runTestConversations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        flow: z.record(z.unknown()),
        settings: z.record(z.unknown()).optional(),
        tests: z.array(z.unknown()).max(50),
        nodeLabels: z.record(z.string()).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ results: TestConversationResult[] }> => {
    const { workspaceId } = context as { workspaceId?: string };
    if (!workspaceId) throw new Error("No active workspace");
    const tests = normalizeTestConversations(data.tests);
    if (!tests.length) return { results: [] };

    const { buildGraphRuntime } = await import("@/lib/voice/gateway/graph-agent");
    const { replayThroughVm } = await import("@/lib/voice/shadow/replay");
    const { resolveVoiceLlmApiKey } = await import("@/lib/voice/llm/gpt");
    const { resolveWebeeLlmProvider } = await import("@/lib/voice/webee-native.shared");
    const apiKey = resolveVoiceLlmApiKey(undefined, resolveWebeeLlmProvider(data.settings ?? null));
    const label = (id: string) => data.nodeLabels?.[id] ?? id;

    const runOne = async (test: (typeof tests)[number]): Promise<TestConversationResult> => {
      try {
        const runtime = await buildGraphRuntime({
          apiKey,
          logPrefix: `[test-conversation ${test.id}]`,
          flow: data.flow,
          settings: data.settings ?? null,
          startSpeaker: "agent",
        });
        if (!runtime) throw new Error("This flow has no runnable steps");
        const replay = await replayThroughVm(runtime.vm, test.callerTurns, { transferSucceeds: true });
        return evaluateTestConversation(
          test,
          {
            agentLines: replay.turns.filter((t) => t.role === "agent").map((t) => t.text),
            nodePath: replay.nodePath,
            endReason: replay.endReason ?? (replay.transferredTo ? "transferred" : null),
            errors: replay.errors,
          },
          label,
        );
      } catch (e) {
        return evaluateTestConversation(
          test,
          { agentLines: [], nodePath: [], endReason: null, errors: [e instanceof Error ? e.message : String(e)] },
          label,
        );
      }
    };

    const results: TestConversationResult[] = new Array(tests.length);
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, tests.length) }, async () => {
        while (next < tests.length) {
          const i = next++;
          results[i] = await runOne(tests[i]!);
        }
      }),
    );
    return { results };
  });
