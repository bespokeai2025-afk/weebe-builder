/**
 * Graph session — adapts conversation-graph VM directives onto a transport.
 *
 * The VM decides what should happen; this decides how it reaches the caller. It
 * exists so the browser relay and the telephony gateways drive the graph through
 * one code path — the divergence between those two was how the old relays ended
 * up carrying different bugs.
 *
 * Directives are consumed strictly in order, awaiting each one, because audio
 * ordering is the whole game: a "goodbye" that overtakes the sentence before it
 * is worse than a slow response.
 *
 * Relative imports only — this module is reachable from vite.config.ts.
 */

import type { ConversationVm } from "../graph/vm";
import type { EndReason, VariableValue, VmDirective, VmInput } from "../graph/types";

export interface GraphSessionCallbacks {
  /** Render speech. Must resolve once the words are handed to the transport. */
  speak(text: string, options: { interruptible: boolean; nodeId: string }): Promise<void>;
  onTranscript?(role: "agent" | "user", text: string): void;
  onVariables?(values: Record<string, VariableValue>): void;
  onToolCall?(toolId: string, result: string, ok: boolean): void;
  /** Bridge the call. Resolve true once connected, false if it could not be. */
  onTransfer?(destination: string, transferType: string): Promise<boolean>;
  onAgentSwap?(agentId: string, agentVersion?: number | string): void;
  /** Caller is expected to speak next; used to open the mic gate. */
  onAwaitUser?(): void;
  onAwaitDigit?(pauseDetectionMs: number): void;
  onEnd?(reason: EndReason): void;
  onError?(message: string): void;
}

export class GraphSession {
  private readonly vm: ConversationVm;
  private readonly cb: GraphSessionCallbacks;
  /** Serialises turns so a late STT result cannot interleave with a live one. */
  private queue: Promise<void> = Promise.resolve();

  constructor(vm: ConversationVm, callbacks: GraphSessionCallbacks) {
    this.vm = vm;
    this.cb = callbacks;
  }

  get isEnded(): boolean {
    return this.vm.isEnded;
  }

  begin(): Promise<void> {
    return this.enqueue({ type: "begin" });
  }

  submitUserText(text: string): Promise<void> {
    return this.enqueue({ type: "user_utterance", text });
  }

  submitDigit(digit: string): Promise<void> {
    return this.enqueue({ type: "digit", digit });
  }

  private enqueue(input: VmInput): Promise<void> {
    // Chain rather than run concurrently: two overlapping turns would both mutate
    // VM position and produce two agent utterances for one caller turn.
    this.queue = this.queue.then(() => this.pump(input)).catch((err) => {
      this.cb.onError?.(err instanceof Error ? err.message : String(err));
    });
    return this.queue;
  }

  private async pump(input: VmInput): Promise<void> {
    let next: VmInput | null = input;
    while (next) {
      const followUp: VmInput | null = await this.consume(next);
      next = followUp;
    }
  }

  /** Drain one VM run, returning an input to immediately feed back if needed. */
  private async consume(input: VmInput): Promise<VmInput | null> {
    let followUp: VmInput | null = null;

    for await (const directive of this.vm.run(input)) {
      const resume = await this.apply(directive);
      if (resume) followUp = resume;
    }
    return followUp;
  }

  private async apply(directive: VmDirective): Promise<VmInput | null> {
    switch (directive.type) {
      case "speak":
        this.cb.onTranscript?.("agent", directive.text);
        await this.cb.speak(directive.text, {
          interruptible: directive.interruptible === true,
          nodeId: directive.nodeId,
        });
        return null;

      case "await_user":
        this.cb.onAwaitUser?.();
        return null;

      case "await_digit":
        this.cb.onAwaitDigit?.(directive.pauseDetectionMs);
        return null;

      case "variables":
        this.cb.onVariables?.(directive.values);
        return null;

      case "tool_call":
        this.cb.onToolCall?.(directive.toolId, directive.result, directive.ok);
        return null;

      case "sms":
        return null;

      case "transfer_call": {
        // Without a bridge implementation the transfer cannot have succeeded, so
        // report failure and let the flow take its transfer-failed edge.
        const ok = this.cb.onTransfer
          ? await this.cb
              .onTransfer(directive.destination, directive.transferType)
              .catch(() => false)
          : false;
        return { type: "transfer_result", ok };
      }

      case "agent_swap":
        this.cb.onAgentSwap?.(directive.agentId, directive.agentVersion);
        return null;

      case "end_call":
        this.cb.onEnd?.(directive.reason);
        return null;

      case "error":
        this.cb.onError?.(directive.message);
        return null;
    }
  }
}
