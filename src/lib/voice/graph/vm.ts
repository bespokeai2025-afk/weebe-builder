/**
 * Conversation graph VM — the interpreter.
 *
 * This is the piece that replaces Retell. Retell's real product is not TTS: it is
 * executing the conversation flow graph at runtime. Until now WEBEE exported that
 * graph and flattened it into one prompt string for OpenAI Realtime, which is why
 * agents skipped steps — a flattened graph has no notion of "you are here".
 *
 * The VM keeps that position explicitly and drives the call one node at a time.
 *
 * Shape of the contract:
 *
 *   - `run(input)` is an async generator of directives. It yields until the flow
 *     needs something from the outside world (a caller utterance, a DTMF digit, a
 *     transfer outcome) and then returns.
 *   - Call `run` again with that input to resume. All state lives on the instance,
 *     so the transport layer stays a dumb pipe.
 *   - Speech is emitted as directives. Generated lines stream tokens (or sentence
 *     batches) into TTS so playback can start before the model finishes writing.
 *
 * Relative imports only — this module is reachable from vite.config.ts.
 */

import { compileFlow, interpolate, nodeModel, type CompiledFlow } from "./flow";
import { summarizeCollectedFacts } from "./collected-facts.shared";
import type { CallTurnTrace } from "./latency-trace";
import { selectDigitEdge, selectEdge, selectGlobalNode, looksLikePhoneAnswer, tryHeuristicEdgeIndex, type RouteContext } from "./router";
import {
  partialMatchesFinal,
  streamSpeculativeTokens,
  type SpeculativeSpeechRun,
} from "../speculative-speech.shared";
import type {
  EndReason,
  FlowEdge,
  FlowNode,
  FunctionNode,
  LlmMessage,
  VariableValue,
  VmDirective,
  VmLatencyHooks,
  VmHooks,
  VmInput,
  VmLlm,
  VmOptions,
} from "./types";

/** Where a node hands control next. */
type StepResult =
  | { kind: "goto"; nodeId: string }
  | { kind: "await"; what: "user" | "digit" | "transfer" }
  | { kind: "end"; reason: EndReason };

const DEFAULT_MAX_STEPS = 25;

const TURN_RULES_BASE = [
  "You are speaking on a live phone call. Produce ONLY the words to say next.",
  "Follow the task for THIS turn exactly.",
  "Do not ask about property size, bedrooms, bathrooms, price, type, or address unless the task explicitly asks for it.",
  "Never re-ask for information the caller already provided earlier in this conversation.",
  "Never narrate stage directions, never describe what you are doing, and never read meta-instructions aloud.",
  "Do not greet the caller again mid-call unless the script requires it.",
].join(" ");

/** Split node prompt text into spoken script vs builder-only style directions. */
function splitPromptScript(raw: string): { script: string; directions: string[] } {
  const script: string[] = [];
  const directions: string[] = [];
  for (const line of raw.split(/\n+/).map((l) => l.trim()).filter(Boolean)) {
    const isDirection =
      /^(be |do not |don't |and do not |never |always |make sure|if the user|when the user|only |avoid |keep |stay )/i.test(
        line,
      ) || /\bdo not ask any other questions\b/i.test(line);
    if (isDirection) {
      directions.push(line);
    } else {
      script.push(line);
    }
  }
  return { script: script.join("\n"), directions };
}

function buildTurnRules(raw: string): string {
  const { script, directions } = splitPromptScript(raw);
  const rules = [TURN_RULES_BASE];
  const noExtraQuestions = directions.some((d) => /\bdo not ask any other questions\b/i.test(d));
  const wantsFlavor = directions.some((d) => /\b(funny|quirky|humou?r|inviting)\b/i.test(d));

  if (script.trim()) {
    rules.push(
      "The task includes a script. Speak the script lines in order, keeping required names, company names, and offers intact.",
      wantsFlavor
        ? "You may add brief quirky flavor, but never skip the script or replace it with unrelated questions."
        : "Stay close to the script wording; do not invent a different pitch or question.",
    );
    if (noExtraQuestions) {
      rules.push("Do not ask any question beyond what the script already contains.");
    }
    rules.push("Use up to three short sentences when the script needs them.");
  } else {
    rules.push(
      "Ask one question from the task, nothing else.",
      "Say ONE short sentence — under 25 words when possible — then stop.",
    );
  }
  return rules.join(" ");
}

/** Ignore mid-thought fillers so the agent does not re-prompt on "uh" / "it's". */
function isFillerUtterance(text: string): boolean {
  const stripped = text.trim().toLowerCase().replace(/[.,!?…'"]/g, " ");
  const words = stripped.split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  if (words.length > 3) return false;
  const fillers = new Set([
    "uh",
    "um",
    "er",
    "ah",
    "hmm",
    "hm",
    "like",
    "so",
    "well",
    "its",
    "it",
    "i",
    "a",
    "the",
  ]);
  return words.every((w) => fillers.has(w) || w === "its" || w === "it's");
}

/** Caller is stalling without giving the requested information. */
function isHedgingUtterance(text: string): boolean {
  const t = text.trim().toLowerCase();
  return /\b(maybe later|not sure|don't know|do not know|still thinking|thinking about|hold on|hang on|wait a|one sec|just a sec|give me a sec|not now|call me back|call back later|i'll think|let me think)\b/.test(
    t,
  );
}

/** Caller gave concrete data (phone, name, address fragment) worth acknowledging. */
function isSubstantiveAnswer(text: string): boolean {
  const t = text.trim();
  if (!t || isFillerUtterance(t) || isHedgingUtterance(t)) return false;
  if (looksLikePhoneAnswer(t)) return true;
  if (/\d/.test(t)) return true;
  if (/\b(apartment|villa|flat|house|street|road|dubai|email|at gmail|at yahoo)\b/i.test(t)) {
    return true;
  }
  const words = t.split(/\s+/).filter(Boolean);
  return words.length >= 1 && words.length <= 4 && t.length >= 2;
}

export type SpeechWarmTarget =
  | { kind: "static"; text: string }
  | { kind: "prompt"; nodeId: string; messages: LlmMessage[]; model: string };

export class ConversationVm {
  private readonly compiled: CompiledFlow;
  private readonly llm: VmLlm;
  private readonly hooks: VmHooks;
  private readonly fallbackModel?: string;
  private readonly maxStepsPerTurn: number;
  private readonly languageLock: string;

  private variables: Record<string, VariableValue>;
  private history: LlmMessage[] = [];
  private currentNodeId: string | null;
  /** Nodes to come back to after a `return_to_previous` global node finishes. */
  private returnStack: string[] = [];
  private awaiting: "user" | "digit" | "transfer" | null = null;
  private ended = false;
  private started = false;
  private turnTrace: CallTurnTrace | null = null;
  private latencyHooks: VmLatencyHooks = {};
  /** Speech started on stable partial STT, keyed by predicted destination node. */
  private speculativeSpeech = new Map<string, SpeculativeSpeechRun>();

  constructor(options: VmOptions) {
    this.compiled = compileFlow(options.flow);
    this.llm = options.llm;
    this.hooks = options.hooks ?? {};
    this.fallbackModel = options.model;
    this.maxStepsPerTurn = options.maxStepsPerTurn ?? DEFAULT_MAX_STEPS;
    this.languageLock = options.languageLock?.trim() ?? "";
    this.variables = { ...(options.variables ?? {}) };
    this.currentNodeId = this.compiled.startNodeId;

    for (const warning of this.compiled.warnings) {
      this.log(`flow warning: ${warning}`);
    }
  }

  get isEnded(): boolean {
    return this.ended;
  }

  get nodeId(): string | null {
    return this.currentNodeId;
  }

  /** Snapshot of collected variables, for post-call analysis and webhooks. */
  getVariables(): Record<string, VariableValue> {
    return { ...this.variables };
  }

  getTranscript(): LlmMessage[] {
    return [...this.history];
  }

  /** Diagnostics from compiling the flow (dropped nodes, dangling edges, …). */
  getWarnings(): string[] {
    return [...this.compiled.warnings];
  }

  /** Attach per-turn latency marks from the cascade session. */
  setTurnTrace(trace: CallTurnTrace | null): void {
    this.turnTrace = trace;
  }

  getTurnTrace(): CallTurnTrace | null {
    return this.turnTrace;
  }

  setLatencyHooks(hooks: VmLatencyHooks): void {
    this.latencyHooks = hooks;
  }

  setSpeculativeSpeech(nodeId: string, run: SpeculativeSpeechRun | null): void {
    const prev = this.speculativeSpeech.get(nodeId);
    if (prev && prev !== run) prev.ctrl.abort();
    if (run) this.speculativeSpeech.set(nodeId, run);
    else this.speculativeSpeech.delete(nodeId);
  }

  clearSpeculativeSpeech(): void {
    for (const run of this.speculativeSpeech.values()) run.ctrl.abort();
    this.speculativeSpeech.clear();
  }

  /**
   * If a heuristic edge from the current node matches `userText`, return the
   * first speakable chunk of the destination static_text node (for TTS pre-warm).
   */
  peekStaticSpeechAfterHeuristic(userText: string): string | null {
    const target = this.peekSpeechWarmTarget(userText);
    return target?.kind === "static" ? target.text : null;
  }

  /**
   * Predict the next speakable output when a heuristic edge matches partial/final STT.
   */
  peekSpeechWarmTarget(userText: string): SpeechWarmTarget | null {
    const node = this.currentNode();
    if (!node) return null;

    const usable = (node.edges ?? []).filter((e) => e.destination_node_id);
    if (usable.length === 0) return null;

    const conditions = usable.map((e) =>
      interpolate(e.transition_condition.prompt.trim(), this.variables),
    );
    const index = tryHeuristicEdgeIndex(conditions, userText);
    if (index === null || index < 0 || index >= usable.length) return null;

    const destId = usable[index]!.destination_node_id!;
    const dest = this.compiled.nodes.get(destId);
    if (!dest?.instruction) return null;

    const raw = String(dest.instruction.text ?? "").trim();
    if (!raw || /^NO_RESPONSE_NEEDED$/i.test(raw)) return null;

    if (dest.instruction.type === "static_text") {
      const text = interpolate(raw, this.variables);
      return text ? { kind: "static", text } : null;
    }

    const messages = this.buildSpeechMessages(dest, raw);
    const model = nodeModel(dest, this.compiled, this.fallbackModel) ?? this.fallbackModel ?? "";
    if (!model || !this.llm.generateStream) return null;
    return { kind: "prompt", nodeId: dest.id, messages, model };
  }

  /**
   * Advance the flow with one input, yielding directives until it blocks again.
   */
  async *run(input: VmInput): AsyncGenerator<VmDirective> {
    if (this.ended) return;

    switch (input.type) {
      case "begin": {
        if (this.started) return;
        this.started = true;
        if (!this.currentNodeId) {
          yield this.fail("", "flow has no executable start node");
          yield { type: "end_call", nodeId: "", reason: "error" };
          this.ended = true;
          return;
        }
        // `start_speaker: "user"` means the agent stays silent until spoken to,
        // which is how inbound flows avoid talking over a caller's greeting.
        if (this.compiled.startSpeaker === "user") {
          this.awaiting = "user";
          yield { type: "await_user", nodeId: this.currentNodeId };
          return;
        }
        yield* this.advance(this.currentNodeId);
        return;
      }

      case "user_utterance": {
        const text = input.text.trim();
        if (!text) return;
        this.history.push({ role: "user", content: text });
        yield* this.afterUserTurn();
        return;
      }

      case "digit": {
        const node = this.currentNode();
        this.history.push({ role: "user", content: `[pressed ${input.digit}]` });
        if (!node) {
          yield* this.afterUserTurn();
          return;
        }
        const edge = await selectDigitEdge(node.edges ?? [], input.digit, this.routeContext(node), this.llm);
        if (edge?.destination_node_id) {
          yield* this.advance(edge.destination_node_id);
          return;
        }
        // No branch claims this digit; fall back to ordinary routing so a
        // catch-all condition still works.
        yield* this.afterUserTurn();
        return;
      }

      case "transfer_result": {
        const node = this.currentNode();
        this.awaiting = null;
        if (input.ok) {
          this.ended = true;
          yield { type: "end_call", nodeId: node?.id ?? "", reason: "transferred" };
          return;
        }
        const failedEdge = (node as { edge?: FlowEdge } | undefined)?.edge;
        if (failedEdge?.destination_node_id) {
          yield* this.advance(failedEdge.destination_node_id);
          return;
        }
        this.ended = true;
        yield { type: "end_call", nodeId: node?.id ?? "", reason: "dead_end" };
        return;
      }
    }
  }

  // ─── Turn handling ──────────────────────────────────────────────────────────

  /**
   * Decide where a caller's reply takes the flow.
   *
   * Global nodes are checked first — they are the flow's interrupt handlers, so a
   * request to reach a human must win over the current step's own edges.
   */
  private async *afterUserTurn(): AsyncGenerator<VmDirective> {
    const node = this.currentNode();
    this.latencyHooks.onRouteStart?.();

    const latestUser = this.history.filter((m) => m.role === "user").at(-1)?.content ?? "";
    const warm = this.peekStaticSpeechAfterHeuristic(latestUser);
    if (warm) this.latencyHooks.onSpeculativeTts?.(warm);

    const ctx = this.routeContext(node);

    if (this.compiled.globalNodes.length > 0) {
      this.turnTrace?.mark("graph_route_global_start");
      const hit = await selectGlobalNode(this.compiled.globalNodes, ctx, this.llm);
      this.turnTrace?.mark("graph_route_global_end");
      if (hit && hit.node.id !== node?.id) {
        if (hit.returnToPrevious && node) this.returnStack.push(node.id);
        yield* this.advance(hit.node.id);
        return;
      }
    }

    if (!node) {
      this.ended = true;
      yield { type: "end_call", nodeId: "", reason: "dead_end" };
      return;
    }

    this.turnTrace?.mark("graph_route_edge_start");
    const edge = await selectEdge(node.edges ?? [], ctx, this.llm);
    this.turnTrace?.mark("graph_route_edge_end");
    if (edge?.destination_node_id) {
      yield* this.advance(edge.destination_node_id);
      return;
    }

    // A node with nowhere to go has finished its job. If we got here through a
    // `return_to_previous` global jump, that is the moment to unwind — otherwise
    // the interrupt handler would repeat itself every turn.
    const hasExit = (node.edges ?? []).some((e) => e.destination_node_id);
    if (!hasExit && this.returnStack.length > 0) {
      yield* this.advance(this.returnStack.pop()!);
      return;
    }

    // No edge matched — stay on this step. Static nodes may re-speak verbatim;
    // prompt nodes acknowledge substantive answers so the caller is not left in silence.
    if (isFillerUtterance(latestUser) || isHedgingUtterance(latestUser)) {
      this.awaiting = "user";
      yield { type: "await_user", nodeId: node.id };
      return;
    }
    if (node.instruction?.type === "static_text") {
      yield* this.advance(node.id);
      return;
    }
    if (isSubstantiveAnswer(latestUser)) {
      this.log(`routing miss on "${node.id}" — acknowledging substantive reply via LLM`);
      yield* this.yieldSpeech(node);
      this.awaiting = "user";
      yield { type: "await_user", nodeId: node.id };
      return;
    }
    this.awaiting = "user";
    yield { type: "await_user", nodeId: node.id };
  }

  /** Execute nodes until the flow blocks or ends. */
  private async *advance(startNodeId: string): AsyncGenerator<VmDirective> {
    this.turnTrace?.mark("graph_advance_start");
    let nodeId: string | null = startNodeId;
    let steps = 0;

    while (nodeId && !this.ended) {
      if (++steps > this.maxStepsPerTurn) {
        yield this.fail(nodeId, `exceeded ${this.maxStepsPerTurn} steps in one turn; flow may loop`);
        this.ended = true;
        yield { type: "end_call", nodeId, reason: "step_limit" };
        return;
      }

      const node = this.compiled.nodes.get(nodeId);
      if (!node) {
        yield this.fail(nodeId, `node "${nodeId}" does not exist`);
        this.ended = true;
        yield { type: "end_call", nodeId, reason: "dead_end" };
        return;
      }

      this.currentNodeId = nodeId;
      this.turnTrace?.mark("graph_node_loaded");
      const result = yield* this.executeNode(node);

      if (result.kind === "await") {
        this.awaiting = result.what;
        if (result.what === "user") yield { type: "await_user", nodeId: node.id };
        this.turnTrace?.mark("graph_advance_end");
        return;
      }
      if (result.kind === "end") {
        this.ended = true;
        yield { type: "end_call", nodeId: node.id, reason: result.reason };
        this.turnTrace?.mark("graph_advance_end");
        return;
      }
      nodeId = result.nodeId;
    }
    this.turnTrace?.mark("graph_advance_end");
  }

  // ─── Node executors ─────────────────────────────────────────────────────────

  private async *executeNode(node: FlowNode): AsyncGenerator<VmDirective, StepResult> {
    switch (node.type) {
      case "conversation":
        return yield* this.execConversation(node);
      case "end":
        return yield* this.execEnd(node);
      case "branch":
        return yield* this.execBranch(node);
      case "extract_dynamic_variables":
        return yield* this.execExtract(node);
      case "function":
        return yield* this.execFunction(node);
      case "press_digit":
        return yield* this.execPressDigit(node);
      case "sms":
        return yield* this.execSms(node);
      case "code":
        return yield* this.execCode(node);
      case "transfer_call":
        return yield* this.execTransfer(node);
      case "agent_swap":
        return yield* this.execAgentSwap(node);
    }
  }

  private async *execConversation(node: FlowNode): AsyncGenerator<VmDirective, StepResult> {
    yield* this.yieldSpeech(node);
    // A conversation node always hands the floor back, even with no outgoing
    // edges — the caller may still be mid-thought, and silence timeouts are the
    // transport's job, not the graph's.
    return { kind: "await", what: "user" };
  }

  private async *execEnd(node: FlowNode): AsyncGenerator<VmDirective, StepResult> {
    yield* this.yieldSpeech(node);
    return { kind: "end", reason: "flow_ended" };
  }

  private async *execBranch(node: FlowNode): AsyncGenerator<VmDirective, StepResult> {
    const elseEdge = (node as { else_edge?: FlowEdge }).else_edge;
    const edge = await selectEdge(node.edges ?? [], this.routeContext(node), this.llm);
    const chosen = edge ?? elseEdge;
    return this.follow(chosen, node);
  }

  private async *execExtract(node: FlowNode): AsyncGenerator<VmDirective, StepResult> {
    const declared = Array.isArray((node as { variables?: unknown[] }).variables)
      ? ((node as { variables: Array<Record<string, unknown>> }).variables ?? [])
      : [];
    const fields = declared
      .map((v) => ({
        name: String(v.name ?? "").trim(),
        description: String(v.description ?? ""),
        type: String(v.type ?? "string"),
        choices: Array.isArray(v.choices) ? (v.choices as string[]) : undefined,
      }))
      .filter((f) => f.name);

    if (fields.length > 0) {
      try {
        const instruction = node.instruction?.text?.trim();
        const messages = instruction
          ? [...this.history, { role: "system" as const, content: instruction }]
          : this.history;
        const values = await this.llm.extract(messages, fields, {
          model: nodeModel(node, this.compiled, this.fallbackModel),
        });
        if (Object.keys(values).length > 0) {
          this.variables = { ...this.variables, ...values };
          yield { type: "variables", nodeId: node.id, values };
        }
      } catch (err) {
        // Extraction is best-effort: a missing variable should not kill the call,
        // and downstream conditions can still route on the transcript.
        this.log(`extraction failed on node "${node.id}": ${errMessage(err)}`);
      }
    }

    const edge = await selectEdge(node.edges ?? [], this.routeContext(node), this.llm);
    return this.follow(edge, node);
  }

  private async *execFunction(node: FunctionNode): AsyncGenerator<VmDirective, StepResult> {
    if (node.speak_during_execution) {
      const filler = interpolate(
        String(node.execution_message_description ?? node.instruction?.text ?? "").trim(),
        this.variables,
      );
      if (filler) yield { type: "speak", nodeId: node.id, text: filler, interruptible: true };
    }

    const toolId = String(node.tool_id ?? "").trim() || `tool-${node.id}`;
    const invocation = {
      toolId,
      toolName: String(node.name ?? toolId),
      toolType: String(node.tool_type ?? "local"),
      url: node.url ? interpolate(String(node.url), this.variables) : undefined,
      timeoutMs: typeof node.timeout === "number" ? node.timeout : undefined,
      args: await this.buildToolArgs(node),
      variables: { ...this.variables },
    };

    const run = async () => {
      if (!this.hooks.executeTool) {
        this.log(`no executeTool hook; node "${node.id}" tool "${toolId}" skipped`);
        return { ok: false, output: JSON.stringify({ error: "no tool executor configured" }) };
      }
      try {
        return await this.hooks.executeTool(invocation);
      } catch (err) {
        return { ok: false, output: JSON.stringify({ error: errMessage(err) }) };
      }
    };

    // `wait_for_result: false` is Retell's fire-and-forget mode: the flow moves on
    // immediately and the tool's result never influences routing.
    if (node.wait_for_result === false) {
      void run().catch(() => {});
      const edge = await selectEdge(node.edges ?? [], this.routeContext(node), this.llm);
      return this.follow(edge ?? (node.else_edge as FlowEdge | undefined), node);
    }

    const outcome = await run();
    if (outcome.variables && Object.keys(outcome.variables).length > 0) {
      this.variables = { ...this.variables, ...outcome.variables };
      yield { type: "variables", nodeId: node.id, values: outcome.variables };
    }
    yield { type: "tool_call", nodeId: node.id, toolId, result: outcome.output, ok: outcome.ok };
    // Routing conditions like "the booking succeeded" can only be judged if the
    // result is part of the conversation the router sees.
    this.history.push({
      role: "system",
      content: `Tool "${invocation.toolName}" ${outcome.ok ? "returned" : "failed"}: ${truncate(outcome.output, 800)}`,
    });

    // A hang-up tool ends the call wherever it is wired, without needing the
    // flow author to also attach an `end` node.
    if (outcome.endCall) return { kind: "end", reason: "flow_ended" };

    if (!outcome.ok && node.else_edge?.destination_node_id) {
      return { kind: "goto", nodeId: node.else_edge.destination_node_id };
    }
    const edge = await selectEdge(node.edges ?? [], this.routeContext(node), this.llm);
    return this.follow(edge ?? (node.else_edge as FlowEdge | undefined), node);
  }

  private async *execPressDigit(node: FlowNode): AsyncGenerator<VmDirective, StepResult> {
    yield* this.yieldSpeech(node);
    const pauseDetectionMs =
      typeof (node as { pause_detection_ms?: number }).pause_detection_ms === "number"
        ? (node as { pause_detection_ms: number }).pause_detection_ms
        : 1000;
    yield { type: "await_digit", nodeId: node.id, pauseDetectionMs };
    return { kind: "await", what: "digit" };
  }

  private async *execSms(node: FlowNode): AsyncGenerator<VmDirective, StepResult> {
    const message = interpolate(String(node.instruction?.text ?? "").trim(), this.variables);
    let ok = false;
    if (!this.hooks.sendSms) {
      this.log(`no sendSms hook; node "${node.id}" cannot send`);
    } else if (!message) {
      this.log(`node "${node.id}" has no SMS body`);
    } else {
      try {
        ok = await this.hooks.sendSms(message, { ...this.variables });
      } catch (err) {
        this.log(`sendSms failed on node "${node.id}": ${errMessage(err)}`);
      }
    }
    yield { type: "sms", nodeId: node.id, message, ok };

    const edges = node as { success_edge?: FlowEdge; failed_edge?: FlowEdge };
    const chosen = ok ? edges.success_edge : edges.failed_edge;
    // Fall back to the other branch only when the matching one is missing, so a
    // half-configured node still progresses.
    return this.follow(chosen ?? edges.success_edge ?? edges.failed_edge, node);
  }

  private async *execCode(node: FlowNode): AsyncGenerator<VmDirective, StepResult> {
    const code = String((node as { code?: string }).code ?? "");
    if (code.trim() && this.hooks.runCode) {
      try {
        const values = await this.hooks.runCode(code, { ...this.variables });
        if (values && Object.keys(values).length > 0) {
          this.variables = { ...this.variables, ...values };
          yield { type: "variables", nodeId: node.id, values };
        }
      } catch (err) {
        this.log(`code node "${node.id}" failed: ${errMessage(err)}`);
      }
    } else if (code.trim()) {
      // Running flow-authored JavaScript in this process would be an RCE sink, so
      // there is no default evaluator; a host must opt in with a sandbox.
      this.log(`code node "${node.id}" skipped: no runCode hook configured`);
    }

    const edge = await selectEdge(node.edges ?? [], this.routeContext(node), this.llm);
    return this.follow(edge, node);
  }

  private async *execTransfer(node: FlowNode): AsyncGenerator<VmDirective, StepResult> {
    const destination = await this.resolveTransferDestination(node);
    const option = (node as { transfer_option?: Record<string, unknown> }).transfer_option ?? {};
    const failedEdge = (node as { edge?: FlowEdge }).edge;

    if (!destination) {
      this.log(`node "${node.id}" has no resolvable transfer destination`);
      yield this.fail(node.id, "transfer destination could not be resolved");
      if (failedEdge?.destination_node_id) {
        return { kind: "goto", nodeId: failedEdge.destination_node_id };
      }
      return { kind: "end", reason: "error" };
    }

    yield {
      type: "transfer_call",
      nodeId: node.id,
      destination,
      transferType: String(option.type ?? "cold_transfer"),
      sipHeaders: (node as { custom_sip_headers?: Record<string, string> }).custom_sip_headers,
    };
    // The host reports the outcome so the transfer-failed edge stays reachable.
    return { kind: "await", what: "transfer" };
  }

  private async *execAgentSwap(node: FlowNode): AsyncGenerator<VmDirective, StepResult> {
    const agentId = String((node as { agent_id?: string }).agent_id ?? "").trim();
    if (!agentId) {
      yield this.fail(node.id, "agent_swap node has no agent_id");
      const edge = (node as { edge?: FlowEdge }).edge;
      if (edge?.destination_node_id) return { kind: "goto", nodeId: edge.destination_node_id };
      return { kind: "end", reason: "error" };
    }
    yield {
      type: "agent_swap",
      nodeId: node.id,
      agentId,
      agentVersion: (node as { agent_version?: number | string }).agent_version,
    };
    return { kind: "end", reason: "agent_swapped" };
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  /**
   * Take an edge, honouring a pending `return_to_previous` global jump when the
   * branch simply runs out of graph.
   */
  private follow(edge: FlowEdge | null | undefined, node: FlowNode): StepResult {
    if (edge?.destination_node_id) return { kind: "goto", nodeId: edge.destination_node_id };
    const returnTo = this.returnStack.pop();
    if (returnTo) return { kind: "goto", nodeId: returnTo };
    this.log(`node "${node.id}" (${node.type}) has no matching outgoing edge`);
    return { kind: "end", reason: "dead_end" };
  }

  /** Emit speech for a node and record the assistant line once playback can start. */
  private async *yieldSpeech(
    node: FlowNode,
    options: { interruptible?: boolean } = {},
  ): AsyncGenerator<VmDirective> {
    const speech = await this.prepareSpeech(node);
    if (!speech) return;

    if (speech.kind === "static") {
      this.history.push({ role: "assistant", content: speech.text });
      yield {
        type: "speak",
        nodeId: node.id,
        text: speech.text,
        interruptible: options.interruptible,
      };
      return;
    }

    let resolveText!: (text: string) => void;
    const textDone = new Promise<string>((resolve) => {
      resolveText = resolve;
    });

    async function* collectTokens(): AsyncGenerator<string> {
      let full = "";
      try {
        for await (const delta of speech.stream) {
          full += delta;
          yield delta;
        }
        resolveText(full.trim() || speech.fallback);
      } catch (err) {
        resolveText(speech.fallback);
        if (speech.fallback) yield speech.fallback;
        throw err;
      }
    }

    yield {
      type: "speak",
      nodeId: node.id,
      textStream: collectTokens(),
      interruptible: options.interruptible,
    };

    const text = await textDone;
    if (text) this.history.push({ role: "assistant", content: text });
  }

  private async prepareSpeech(
    node: FlowNode,
  ): Promise<
    | { kind: "static"; text: string }
    | { kind: "generated"; stream: AsyncIterable<string>; fallback: string }
    | null
  > {
    const instruction = node.instruction;
    const raw = String(instruction?.text ?? "").trim();
    if (/^NO_RESPONSE_NEEDED$/i.test(raw)) return null;
    if (!raw) return null;

    if (instruction?.type === "static_text") {
      const text = interpolate(raw, this.variables);
      return text ? { kind: "static", text } : null;
    }

    const messages = this.buildSpeechMessages(node, raw);
    const fallback = interpolate(raw, this.variables);
    const model = nodeModel(node, this.compiled, this.fallbackModel);

    const latestUser = this.history.filter((m) => m.role === "user").at(-1)?.content ?? "";
    const spec = this.speculativeSpeech.get(node.id);
    if (spec) {
      if (partialMatchesFinal(spec.partial, latestUser)) {
        this.speculativeSpeech.delete(node.id);
        this.turnTrace?.mark("speculative_speech_hit");
        return {
          kind: "generated",
          stream: streamSpeculativeTokens(spec),
          fallback,
        };
      }
      spec.ctrl.abort();
      this.speculativeSpeech.delete(node.id);
    }

    if (this.llm.generateStream) {
      try {
        return {
          kind: "generated",
          stream: this.llm.generateStream(messages, { model }),
          fallback,
        };
      } catch (err) {
        this.log(`stream setup failed on node "${node.id}": ${errMessage(err)}`);
      }
    }

    try {
      const text = await this.llm.generate(messages, { model });
      const clean = text.trim() || fallback;
      return clean ? { kind: "static", text: clean } : null;
    } catch (err) {
      this.log(`generation failed on node "${node.id}": ${errMessage(err)}`);
      return fallback ? { kind: "static", text: fallback } : null;
    }
  }

  private buildSpeechMessages(node: FlowNode, raw: string): LlmMessage[] {
    const interpolated = interpolate(raw, this.variables);
    const { script, directions } = splitPromptScript(interpolated);
    const system: string[] = [buildTurnRules(interpolated)];
    if (this.languageLock) system.push(this.languageLock);
    const collected = summarizeCollectedFacts(this.history);
    if (collected) {
      system.push(`# Already collected from the caller (do not ask again)\n${collected}`);
    }
    const known = Object.entries(this.variables).filter(
      ([, v]) => v !== null && v !== undefined && v !== "",
    );
    if (known.length) {
      system.push(
        `# Known information\n${known.map(([k, v]) => `- ${k}: ${String(v)}`).join("\n")}`,
      );
    }
    if (script.trim()) {
      system.push(`# Script to say\n${script}`);
    }
    if (directions.length) {
      system.push(
        `# Style notes (do not read aloud)\n${directions.map((d) => `- ${d}`).join("\n")}`,
      );
    }
    if (!script.trim()) {
      system.push(`# Your task for this turn\n${interpolated}`);
    }
    return [{ role: "system", content: system.join("\n\n") }, ...this.history.slice(-12)];
  }

  /** Blocking speech resolution for transfer prompts and other one-shot paths. */
  private async resolveSpeech(node: FlowNode): Promise<string> {
    const speech = await this.prepareSpeech(node);
    if (!speech) return "";
    if (speech.kind === "static") return speech.text;

    let full = "";
    try {
      for await (const delta of speech.stream) full += delta;
      return full.trim() || speech.fallback;
    } catch (err) {
      this.log(`generation failed on node "${node.id}": ${errMessage(err)}`);
      return speech.fallback;
    }
  }

  /**
   * Fill a webhook tool's declared parameters from the conversation.
   *
   * Retell lets the model choose tool arguments; reusing the extraction path gives
   * the same effect without a second prompt format to maintain.
   */
  private async buildToolArgs(node: FunctionNode): Promise<Record<string, unknown>> {
    const schema = node.parameters as
      | { properties?: Record<string, { type?: string; description?: string; enum?: string[] }> }
      | undefined;
    const properties = schema?.properties;
    if (!properties || Object.keys(properties).length === 0) return {};

    const fields = Object.entries(properties).map(([name, spec]) => ({
      name,
      description: spec?.description ?? "",
      type: spec?.type ?? "string",
      choices: spec?.enum,
    }));

    try {
      return await this.llm.extract(this.history, fields, {
        model: nodeModel(node, this.compiled, this.fallbackModel),
      });
    } catch (err) {
      this.log(`tool argument extraction failed on node "${node.id}": ${errMessage(err)}`);
      return {};
    }
  }

  /**
   * Resolve where a transfer should go.
   *
   * `inferred` destinations name a dynamic variable; when it has not been
   * collected yet the conversation is asked for it directly, since failing the
   * transfer over a missing variable is worse than one extra model call.
   */
  private async resolveTransferDestination(node: FlowNode): Promise<string> {
    const dest = (node as { transfer_destination?: Record<string, unknown> }).transfer_destination;
    if (!dest) return "";

    if (dest.type === "inferred") {
      const key = String(dest.prompt ?? "").trim();
      if (!key) return "";
      const direct = this.variables[key];
      if (direct !== undefined && direct !== null && String(direct).trim()) {
        return String(direct).trim();
      }
      try {
        const values = await this.llm.extract(
          this.history,
          [
            {
              name: key,
              description: `The phone number to transfer this call to, in E.164 format`,
              type: "string",
            },
          ],
          { model: nodeModel(node, this.compiled, this.fallbackModel) },
        );
        return String(values[key] ?? "").trim();
      } catch {
        return "";
      }
    }

    const number = String(dest.number ?? "").trim();
    const resolved = interpolate(number, this.variables);
    const extension = String(dest.extension ?? "").trim();
    if (!resolved) return "";
    return extension ? `${resolved};ext=${interpolate(extension, this.variables)}` : resolved;
  }

  private routeContext(node: FlowNode | null): RouteContext {
    return {
      history: this.history,
      variables: this.variables,
      globalPrompt: this.compiled.globalPrompt,
      currentNodeHint: node ? this.nodeHint(node) : undefined,
    };
  }

  private nodeHint(node: FlowNode): string {
    const raw = String(node.instruction?.text ?? "").trim();
    const brief = raw ? truncate(interpolate(raw, this.variables), 120) : node.type;
    const label = node.name ? `${node.type} (${node.name})` : node.type;
    return `${label}: ${brief}`;
  }

  private currentNode(): FlowNode | null {
    return this.currentNodeId ? (this.compiled.nodes.get(this.currentNodeId) ?? null) : null;
  }

  private fail(nodeId: string, message: string): VmDirective {
    this.log(message, { nodeId });
    return { type: "error", nodeId, message };
  }

  private log(message: string, meta?: Record<string, unknown>): void {
    if (this.hooks.log) this.hooks.log(message, meta);
    else console.warn(`[graph-vm] ${message}`, meta ?? "");
  }
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Convenience factory mirroring the rest of the voice modules. */
export function createConversationVm(options: VmOptions): ConversationVm {
  return new ConversationVm(options);
}
