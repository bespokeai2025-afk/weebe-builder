/**
 * Builder canvas — how fast each step answers on real calls, and a warning for long prompts.
 *
 * The time is the same one the Latency page reports: from the caller finishing to the agent's first
 * audio (median over the last 14 days). Live calls are used when the agent has any; otherwise test
 * calls, labelled as such. Long step prompts are flagged because every character is sent on every
 * turn of that step and slows the first word.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Timer } from "lucide-react";
import { useBuilderStore } from "@/lib/builder/store";
import { getAgentNodeLatency } from "@/lib/voice/call-latency.functions";
import type { NodeLatency } from "@/lib/voice/call-latency-stats.shared";
import { cn } from "@/lib/utils";

/** A step prompt longer than this gets a warning. */
export const LONG_STEP_PROMPT_CHARS = 3_000;
/** Fewer turns than this and the median is not worth showing. */
const MIN_TURNS = 3;

type NodeLatencyView = NodeLatency & { fromTestCalls: boolean; budgetMs: number };

function useAgentNodeLatency(): Map<string, NodeLatencyView> | null {
  const agentId = useBuilderStore((s) => s.currentAgentRowId);
  const fetchFn = useServerFn(getAgentNodeLatency);
  const q = useQuery({
    queryKey: ["builder-node-latency", agentId],
    queryFn: () => fetchFn({ data: { agentId: agentId! } }),
    enabled: Boolean(agentId),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    throwOnError: false,
    retry: false,
  });
  if (!q.data) return null;
  const fromTestCalls = q.data.live.turns === 0;
  const nodes = fromTestCalls ? q.data.test.nodes : q.data.live.nodes;
  return new Map(nodes.map((n) => [n.nodeId, { ...n, fromTestCalls, budgetMs: q.data!.budgetMs }]));
}

function tone(p50: number, budgetMs: number): string {
  if (p50 <= budgetMs * 1.5) return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 ring-emerald-500/30";
  if (p50 <= budgetMs * 2.5) return "bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-amber-500/30";
  return "bg-red-500/15 text-red-700 dark:text-red-300 ring-red-500/30";
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

export function NodeLatencyBadge({ nodeId, promptText }: { nodeId: string; promptText?: string | null }) {
  const byNode = useAgentNodeLatency();
  const stat = byNode?.get(nodeId);
  const promptChars = (promptText ?? "").length;
  const longPrompt = promptChars > LONG_STEP_PROMPT_CHARS;
  const showTime = stat && stat.turns >= MIN_TURNS;
  if (!showTime && !longPrompt) return null;

  return (
    <div className="pointer-events-auto absolute -top-7 right-0 z-10 flex items-center gap-1">
      {showTime && (
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium tabular-nums ring-1",
            tone(stat.p50, stat.budgetMs),
          )}
          title={[
            `Caller stops → agent starts speaking${stat.fromTestCalls ? " (test calls)" : ""}, last 14 days`,
            `Median ${seconds(stat.p50)} · slowest 10% ${seconds(stat.p90)} · ${stat.turns} turns`,
            `${Math.round(stat.modelRoutedShare * 100)}% of turns needed the model to pick the next step`,
            stat.promptCharsP50 != null ? `Prompt sent ≈ ${stat.promptCharsP50.toLocaleString()} characters` : null,
            `Target: under ${seconds(stat.budgetMs)}`,
          ]
            .filter(Boolean)
            .join("\n")}
        >
          <Timer className="h-3 w-3" />
          {seconds(stat.p50)}
          {stat.fromTestCalls && <span className="opacity-70">test</span>}
        </span>
      )}
      {longPrompt && (
        <span
          className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-amber-500/30 dark:text-amber-300"
          title={`This step's prompt is ${promptChars.toLocaleString()} characters. It is sent on every turn of the step, so it slows the agent's first word — move background detail to the knowledge base, or to the global prompt, which is sent once and cached.`}
        >
          <AlertTriangle className="h-3 w-3" />
          Long prompt
        </span>
      )}
    </div>
  );
}
