/**
 * Read `call_turns` for the latency views.
 *
 * Two shapes, because two questions are being asked. `listTestCallLatency`
 * answers "what did the call I just placed actually do, turn by turn" — the
 * loop you need while tuning. `getLatencyOverview` answers "where are we
 * against the budget, and which stage is costing us" across a window.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  percentiles,
  routeMethodShare,
  speculationStat,
  stageBreakdown,
  withinBudget,
  type CallTurnRow,
} from "./call-latency-stats.shared";

const TURN_COLUMNS =
  "call_id, turn_index, speech_to_first_audio_ms, endpoint_to_stt_final_ms, " +
  "stt_to_route_ms, stt_to_first_token_ms, stt_to_first_sentence_ms, " +
  "stt_to_first_audio_ms, edge_route_method, global_route_method, " +
  "speculative_hit, partial_commit, interrupted, node_id, created_at";

/** Recent calls that produced turn data, newest first. */
export const listLatencyCalls = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        testOnly: z.boolean().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      })
      .optional()
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { workspaceId } = context as { workspaceId?: string };
    if (!workspaceId) throw new Error("No active workspace");

    let q = (supabaseAdmin as any)
      .from("call_turns")
      .select("call_id, created_at, is_test_call, speech_to_first_audio_ms, agent_id")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(2000);
    if (data?.testOnly) q = q.eq("is_test_call", true);

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    // Collapse turns into calls in memory. The alternative is a DISTINCT ON
    // view; not worth a migration until the table is large.
    const byCall = new Map<
      string,
      { callId: string; startedAt: string; isTestCall: boolean; turns: number; values: number[]; agentId: string | null }
    >();
    for (const r of (rows ?? []) as Array<Record<string, unknown>>) {
      const id = String(r.call_id);
      const entry =
        byCall.get(id) ??
        {
          callId: id,
          startedAt: String(r.created_at),
          isTestCall: Boolean(r.is_test_call),
          turns: 0,
          values: [] as number[],
          agentId: (r.agent_id as string | null) ?? null,
        };
      entry.turns += 1;
      if (typeof r.speech_to_first_audio_ms === "number") entry.values.push(r.speech_to_first_audio_ms);
      // Rows arrive newest-first, so the last one seen is the call's start.
      entry.startedAt = String(r.created_at);
      byCall.set(id, entry);
    }

    const calls = [...byCall.values()]
      .map((c) => ({
        callId: c.callId,
        startedAt: c.startedAt,
        isTestCall: c.isTestCall,
        agentId: c.agentId,
        turns: c.turns,
        medianMs: percentiles(c.values)?.p50 ?? null,
        worstMs: percentiles(c.values)?.max ?? null,
      }))
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, data?.limit ?? 25);

    return { calls };
  });

/** Every turn of one call, with the derived per-call stats. */
export const getCallLatencyDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ callId: z.string().min(1) }).parse(input))
  .handler(async ({ data, context }) => {
    const { workspaceId } = context as { workspaceId?: string };
    if (!workspaceId) throw new Error("No active workspace");

    const { data: rows, error } = await (supabaseAdmin as any)
      .from("call_turns")
      .select(TURN_COLUMNS)
      .eq("workspace_id", workspaceId)
      .eq("call_id", data.callId)
      .order("turn_index", { ascending: true });
    if (error) throw new Error(error.message);

    const turns = (rows ?? []) as CallTurnRow[];
    return {
      callId: data.callId,
      turns,
      stages: stageBreakdown(turns),
      budget: withinBudget(turns),
      edgeRoutes: routeMethodShare(turns, "edge"),
      speculation: speculationStat(turns),
    };
  });

/** Aggregate over a time window — the "are we Retell-fast yet" view. */
export const getLatencyOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        days: z.number().int().min(1).max(90).optional(),
        testOnly: z.boolean().optional(),
      })
      .optional()
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { workspaceId } = context as { workspaceId?: string };
    if (!workspaceId) throw new Error("No active workspace");

    const days = data?.days ?? 7;
    const since = new Date(Date.now() - days * 86_400_000).toISOString();

    let q = (supabaseAdmin as any)
      .from("call_turns")
      .select(TURN_COLUMNS)
      .eq("workspace_id", workspaceId)
      .gte("created_at", since)
      .limit(20_000);
    // Production percentiles must not be flattered by builder test calls.
    q = data?.testOnly ? q.eq("is_test_call", true) : q.eq("is_test_call", false);

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const turns = (rows ?? []) as CallTurnRow[];
    return {
      days,
      testOnly: Boolean(data?.testOnly),
      turns: turns.length,
      calls: new Set(turns.map((t) => t.call_id)).size,
      stages: stageBreakdown(turns),
      budget: withinBudget(turns),
      edgeRoutes: routeMethodShare(turns, "edge"),
      globalRoutes: routeMethodShare(turns, "global"),
      speculation: speculationStat(turns),
    };
  });
