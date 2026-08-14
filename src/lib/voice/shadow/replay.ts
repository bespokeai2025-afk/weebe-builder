/**
 * Replay a past call's caller turns through the conversation graph VM.
 *
 * This is the "shadow" half of shadow testing: no audio, no STT, no TTS — just
 * the part being replaced. Feeding the recorded caller utterances back in is what
 * makes the comparison fair, since any difference in what the agent says is then
 * attributable to the engine rather than to a different conversation.
 *
 * The VM is driven through GraphSession so a replay takes exactly the same path
 * as a live call, including global-node jumps and transfer edges. A bug that only
 * appears through the session driver would otherwise be invisible here.
 */

import { GraphSession } from "../gateway/graph-session";
import type { ConversationVm } from "../graph/vm";
import type { VariableValue } from "../graph/types";
import type { ShadowTurn } from "./transcript-diff";

export interface ShadowReplayResult {
  /** Agent turns produced, interleaved with the caller turns that prompted them. */
  turns: ShadowTurn[];
  /** Flow nodes that produced speech, in order, deduplicated for readability. */
  nodePath: string[];
  toolCalls: Array<{ toolId: string; ok: boolean }>;
  variables: Record<string, VariableValue>;
  endReason: string | null;
  transferredTo: string | null;
  errors: string[];
  /** Caller turns that were never delivered because the flow ended first. */
  unusedUserTurns: number;
}

export interface ReplayOptions {
  /**
   * Whether a transfer directive is treated as connected.
   *
   * True by default: the reference call was a real one, so a transfer there did
   * connect, and reporting failure would push the replay down the flow's
   * transfer-failed branch and manufacture a divergence.
   */
  transferSucceeds?: boolean;
}

export async function replayThroughVm(
  vm: ConversationVm,
  userTurns: string[],
  options: ReplayOptions = {},
): Promise<ShadowReplayResult> {
  const turns: ShadowTurn[] = [];
  const nodePath: string[] = [];
  const toolCalls: Array<{ toolId: string; ok: boolean }> = [];
  const errors: string[] = [];
  let variables: Record<string, VariableValue> = {};
  let endReason: string | null = null;
  let transferredTo: string | null = null;

  const session = new GraphSession(vm, {
    // The text itself arrives via onTranscript; this only records which node
    // produced it, which is what makes a routing difference visible.
    speak: async (_text, { nodeId }) => {
      if (nodeId && nodePath[nodePath.length - 1] !== nodeId) nodePath.push(nodeId);
    },
    onTranscript: (role, text) => {
      // Only agent lines: caller lines are the input, and adding them here would
      // duplicate what the loop below already records.
      if (role === "agent") turns.push({ role: "agent", text });
    },
    onVariables: (values) => {
      variables = { ...variables, ...values };
    },
    onToolCall: (toolId, _result, ok) => toolCalls.push({ toolId, ok }),
    onTransfer: async (destination) => {
      transferredTo = destination;
      return options.transferSucceeds !== false;
    },
    onEnd: (reason) => {
      endReason = reason;
    },
    onError: (message) => errors.push(message),
  });

  await session.begin();

  let delivered = 0;
  for (const text of userTurns) {
    // Once the flow has ended, further caller turns would have hit a dead line.
    // They are counted instead of forced through, because a native engine ending
    // early is itself the finding.
    if (session.isEnded) break;
    turns.push({ role: "user", text });
    await session.submitUserText(text);
    delivered += 1;
  }

  return {
    turns,
    nodePath,
    toolCalls,
    variables,
    endReason,
    transferredTo,
    errors,
    unusedUserTurns: userTurns.length - delivered,
  };
}
