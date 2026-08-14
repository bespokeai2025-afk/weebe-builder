/**
 * Shadow testing and cutover gating for the WEBEE native voice engine.
 *
 * `runShadowComparison` replays an agent's real Retell calls through the native
 * conversation graph VM and stores a turn-by-turn diff. `getCutoverReadiness`
 * turns that history, plus the configuration the engine needs, into a per-agent
 * checklist — the plan's "keep Retell fallback until parity proven", expressed as
 * something the UI can refuse to proceed on.
 *
 * Replays cost LLM calls (one generation per agent turn, one classification per
 * edge), so the call count is capped and the caller chooses how many to run.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { buildGraphRuntime } from "@/lib/voice/gateway/graph-agent";
import { resolveDeploymentMode } from "@/lib/runtime/adapter";
import { replayThroughVm } from "./replay";
import {
  diffTranscripts,
  formatShadowTranscript,
  parseTranscriptText,
  type TranscriptDiff,
} from "./transcript-diff";

/** Enough turns to exercise routing; below this a call proves nothing. */
const MIN_USER_TURNS = 2;

export interface ShadowRunSummary {
  id: string | null;
  referenceCallId: string | null;
  userTurnCount: number;
  referenceAgentTurns: number;
  candidateAgentTurns: number;
  averageSimilarity: number;
  divergedAtTurn: number | null;
  verdict: TranscriptDiff["verdict"];
  nodePath: string[];
  error: string | null;
}

async function loadAgentForWorkspace(agentId: string, workspaceId: string) {
  const { data, error } = await supabaseAdmin
    .from("agents")
    .select("id, name, workspace_id, settings")
    .eq("id", agentId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Agent not found in this workspace");
  return data;
}

/**
 * Replay recent reference calls and store the comparison.
 *
 * Reference calls come from `calls`, which is where the Retell webhook processor
 * writes transcripts. Calls with too few caller turns are skipped rather than
 * counted as passes: a voicemail or an immediate hangup would otherwise report
 * perfect parity.
 */
export const runShadowComparison = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        agentId: z.string().uuid(),
        /** Replay one specific call instead of the most recent ones. */
        callId: z.string().optional(),
        limit: z.number().int().min(1).max(10).default(3),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ context, data }) => {
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No active workspace");

    const apiKey = process.env.OPENAI_API_KEY ?? "";
    if (!apiKey) throw new Error("OPENAI_API_KEY is not configured — the native engine cannot run");

    const agent = await loadAgentForWorkspace(data.agentId, workspaceId);

    let query = supabaseAdmin
      .from("calls")
      .select("retell_call_id, transcript, created_at")
      .eq("workspace_id", workspaceId)
      .eq("agent_id", data.agentId)
      .not("transcript", "is", null)
      .order("created_at", { ascending: false })
      .limit(data.callId ? 1 : data.limit);
    if (data.callId) query = query.eq("retell_call_id", data.callId);

    const { data: calls, error } = await query;
    if (error) throw new Error(error.message);
    if (!calls || calls.length === 0) {
      return {
        runs: [] as ShadowRunSummary[],
        skipped: 0,
        message: "No reference calls with transcripts found for this agent",
      };
    }

    // Built once: every replay runs the same flow, and compiling per call would
    // multiply the work for no benefit.
    const runtime = await buildGraphRuntime({
      apiKey,
      logPrefix: "[shadow]",
      agentId: data.agentId,
      supabase: supabaseAdmin as never,
    });
    if (!runtime) {
      throw new Error(
        "Agent has no runnable conversation graph — the native engine cannot execute it",
      );
    }

    const runs: ShadowRunSummary[] = [];
    let skipped = 0;

    for (const call of calls) {
      const reference = parseTranscriptText(String(call.transcript ?? ""));
      const userTurns = reference.filter((t) => t.role === "user").map((t) => t.text);
      if (userTurns.length < MIN_USER_TURNS) {
        skipped += 1;
        continue;
      }

      // A fresh VM per call: variables and history from one replay must not leak
      // into the next, or later calls would start mid-conversation.
      const perCall = await buildGraphRuntime({
        apiKey,
        logPrefix: "[shadow]",
        agentId: data.agentId,
        supabase: supabaseAdmin as never,
      });
      if (!perCall) {
        skipped += 1;
        continue;
      }

      let summary: ShadowRunSummary;
      try {
        const replay = await replayThroughVm(perCall.vm, userTurns);
        const diff = diffTranscripts(reference, replay.turns);
        summary = {
          id: null,
          referenceCallId: (call.retell_call_id as string | null) ?? null,
          userTurnCount: userTurns.length,
          referenceAgentTurns: diff.referenceAgentTurns,
          candidateAgentTurns: diff.candidateAgentTurns,
          averageSimilarity: diff.averageSimilarity,
          divergedAtTurn: diff.divergedAtTurn,
          verdict: diff.verdict,
          nodePath: replay.nodePath,
          error: replay.errors[0] ?? null,
        };

        const { data: row } = await supabaseAdmin
          .from("voice_shadow_runs")
          .insert({
            workspace_id: workspaceId,
            agent_id: data.agentId,
            reference_call_id: summary.referenceCallId,
            reference_engine: resolveDeploymentMode(
              agent.settings as never,
            ).toLowerCase(),
            user_turn_count: summary.userTurnCount,
            reference_agent_turns: summary.referenceAgentTurns,
            candidate_agent_turns: summary.candidateAgentTurns,
            average_similarity: summary.averageSimilarity,
            diverged_at_turn: summary.divergedAtTurn,
            verdict: summary.verdict,
            diff: diff.turns as never,
            candidate_transcript: formatShadowTranscript(replay.turns),
            node_path: replay.nodePath as never,
            warnings: [...perCall.warnings, ...replay.errors] as never,
            error: summary.error,
          } as never)
          .select("id")
          .single();
        summary.id = (row?.id as string | undefined) ?? null;
      } catch (err) {
        // One bad reference call must not abort the batch: the point of a shadow
        // run is to collect evidence, including failures.
        summary = {
          id: null,
          referenceCallId: (call.retell_call_id as string | null) ?? null,
          userTurnCount: userTurns.length,
          referenceAgentTurns: reference.filter((t) => t.role === "agent").length,
          candidateAgentTurns: 0,
          averageSimilarity: 0,
          divergedAtTurn: null,
          verdict: "divergent",
          nodePath: [],
          error: err instanceof Error ? err.message : String(err),
        };
      }
      runs.push(summary);
    }

    return {
      runs,
      skipped,
      message:
        runs.length === 0
          ? `No reference call had at least ${MIN_USER_TURNS} caller turns`
          : `Replayed ${runs.length} call${runs.length === 1 ? "" : "s"}`,
    };
  });

export const listShadowRuns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z.object({ agentId: z.string().uuid(), limit: z.number().int().min(1).max(50).default(20) }).parse(
      input ?? {},
    ),
  )
  .handler(async ({ context, data }) => {
    if (!context.workspaceId) throw new Error("No active workspace");
    const { data: rows, error } = await supabaseAdmin
      .from("voice_shadow_runs")
      .select("*")
      .eq("workspace_id", context.workspaceId)
      .eq("agent_id", data.agentId)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export interface CutoverCheck {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}

export interface CutoverReadiness {
  agentId: string;
  agentName: string;
  currentMode: string;
  /** True only when nothing failed. Warnings are judgement calls, not blockers. */
  ready: boolean;
  checks: CutoverCheck[];
}

/**
 * Build the per-agent cutover checklist.
 *
 * Deliberately conservative about what counts as a blocker: a missing provider
 * key or an unrunnable flow means the call cannot happen at all, whereas thin
 * shadow evidence is a warning for a human to weigh. Blocking on the latter would
 * make the first agent impossible to migrate.
 */
async function computeCutoverReadiness(
  agentId: string,
  workspaceId: string,
): Promise<CutoverReadiness> {
  const agent = await loadAgentForWorkspace(agentId, workspaceId);
  const settings = (agent.settings ?? {}) as Record<string, unknown>;
  const checks: CutoverCheck[] = [];

  const openai = Boolean(process.env.OPENAI_API_KEY);
  checks.push({
    id: "llm",
    label: "Text LLM key",
    status: openai ? "pass" : "fail",
    detail: openai ? "OPENAI_API_KEY is set" : "OPENAI_API_KEY is missing",
  });

  const fish = Boolean(process.env.FISH_API_KEY);
  const tts = fish || Boolean(process.env.ELEVENLABS_API_KEY);
  checks.push({
    id: "tts",
    label: "Speech synthesis",
    status: tts ? (fish ? "pass" : "warn") : "fail",
    // Vendor names stay out of these strings: the checklist renders in the
    // customer-facing migration console.
    detail: fish
      ? "Native speech synthesis configured"
      : tts
        ? "Running on the fallback provider — costs several times more per minute"
        : "No speech synthesis key configured",
  });

  // Without a Fish model id the provider falls back to its own default voice,
  // which is a working call with the wrong voice — a warning, not a blocker.
  const voiceId = String(settings.webeeVoiceId ?? "").trim();
  checks.push({
    id: "voice",
    label: "Agent voice",
    status: voiceId ? "pass" : "warn",
    detail: voiceId
      ? `Voice ${settings.webeeVoiceName ? `"${String(settings.webeeVoiceName)}"` : voiceId} selected`
      : "No voice picked — calls will use the default WEBEE Native voice",
  });

  const deepgram = Boolean(process.env.DEEPGRAM_API_KEY);
  checks.push({
    id: "stt",
    label: "Speech recognition",
    status: deepgram ? "pass" : openai ? "warn" : "fail",
    detail: deepgram
      ? "Deepgram streaming configured"
      : openai
        ? "Falling back to batch Whisper — adds the whole transcription to every turn"
        : "No STT provider configured",
  });

  // The flow is the actual Retell replacement, so an agent whose graph does not
  // compile cannot be migrated regardless of anything else.
  let graphOk = false;
  let graphDetail = "Could not build the conversation graph";
  try {
    const runtime = await buildGraphRuntime({
      apiKey: process.env.OPENAI_API_KEY ?? "",
      logPrefix: "[cutover]",
      agentId,
      supabase: supabaseAdmin as never,
    });
    if (runtime) {
      graphOk = true;
      graphDetail = runtime.warnings.length
        ? `Compiles with ${runtime.warnings.length} warning(s): ${runtime.warnings[0]}`
        : "Conversation graph compiles cleanly";
    } else {
      graphDetail = "Agent has no runnable conversation graph";
    }
  } catch (err) {
    graphDetail = err instanceof Error ? err.message : String(err);
  }
  checks.push({
    id: "graph",
    label: "Conversation graph",
    status: graphOk ? "pass" : "fail",
    detail: graphDetail,
  });

  const { data: numbers } = await supabaseAdmin
    .from("phone_numbers")
    .select("phone_number, is_active")
    .eq("workspace_id", workspaceId)
    .eq("agent_id", agentId)
    .eq("is_active", true);
  const numberCount = numbers?.length ?? 0;
  checks.push({
    id: "number",
    label: "Phone number",
    status: numberCount > 0 ? "pass" : "warn",
    detail:
      numberCount > 0
        ? `${numberCount} active number(s) pointed at this agent`
        : "No number assigned — web calls will work, inbound phone calls will not",
  });

  const { data: runs } = await supabaseAdmin
    .from("voice_shadow_runs")
    .select("verdict, average_similarity")
    .eq("workspace_id", workspaceId)
    .eq("agent_id", agentId)
    .order("created_at", { ascending: false })
    .limit(10);
  const shadowRuns = runs ?? [];
  const aligned = shadowRuns.filter((r) => r.verdict === "aligned").length;
  checks.push({
    id: "shadow",
    label: "Shadow parity",
    status:
      shadowRuns.length === 0
        ? "warn"
        : aligned >= Math.ceil(shadowRuns.length / 2)
          ? "pass"
          : "warn",
    detail:
      shadowRuns.length === 0
        ? "No shadow runs yet — replay some real calls before cutting over"
        : `${aligned}/${shadowRuns.length} recent replays aligned with the reference transcript`,
  });

  const { data: nativeRates } = await supabaseAdmin
    .from("cost_engine_webee_native")
    .select("id")
    .eq("is_current", true)
    .limit(1)
    .maybeSingle();
  checks.push({
    id: "cost",
    label: "Cost rates",
    status: nativeRates ? "pass" : "warn",
    detail: nativeRates
      ? "Native engine rates configured — calls will report a cost"
      : "No native rates configured — calls will reconcile as cost unavailable",
  });

  return {
    agentId,
    agentName: (agent.name as string | null) ?? "Agent",
    currentMode: resolveDeploymentMode(settings as never),
    ready: checks.every((c) => c.status !== "fail"),
    checks,
  };
}

export const getCutoverReadiness = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ agentId: z.string().uuid() }).parse(input ?? {}))
  .handler(async ({ context, data }): Promise<CutoverReadiness> => {
    if (!context.workspaceId) throw new Error("No active workspace");
    return computeCutoverReadiness(data.agentId, context.workspaceId);
  });

/**
 * Switch one agent between Retell and the native engine.
 *
 * Only `settings.deploymentMode` changes, which is the whole point of the flag:
 * the Retell agent it was provisioned as is left in place, so rolling back is the
 * same call with `mode: "RETELL"` and takes effect on the next call. Rollback is
 * never gated — a checklist must not be able to trap an agent on a broken engine.
 */
export const setAgentEngine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        agentId: z.string().uuid(),
        mode: z.enum(["WEBEE_NATIVE", "RETELL"]),
        /** Proceed despite a failing check. Warnings never block. */
        force: z.boolean().default(false),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ context, data }) => {
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No active workspace");

    let readiness: CutoverReadiness | null = null;
    if (data.mode === "WEBEE_NATIVE") {
      readiness = await computeCutoverReadiness(data.agentId, workspaceId);
      const blockers = readiness.checks.filter((c) => c.status === "fail");
      if (blockers.length > 0 && !data.force) {
        throw new Error(
          `Not ready for the native engine: ${blockers.map((b) => `${b.label} — ${b.detail}`).join("; ")}`,
        );
      }
    }

    const agent = await loadAgentForWorkspace(data.agentId, workspaceId);
    const settings = { ...((agent.settings ?? {}) as Record<string, unknown>) };
    const previousMode = resolveDeploymentMode(settings as never);
    settings.deploymentMode = data.mode;
    // Legacy readers still branch on voiceProvider, and leaving it as
    // OPENAI_REALTIME would send a migrated agent down the HyperStream path.
    settings.voiceProvider = "RETELL";

    const { error } = await supabaseAdmin
      .from("agents")
      .update({ settings: settings as never })
      .eq("id", data.agentId)
      .eq("workspace_id", workspaceId);
    if (error) throw new Error(error.message);

    return {
      agentId: data.agentId,
      previousMode,
      mode: data.mode,
      readiness,
      forced: data.mode === "WEBEE_NATIVE" && data.force,
    };
  });
