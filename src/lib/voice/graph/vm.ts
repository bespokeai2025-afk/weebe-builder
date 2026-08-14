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
 *   - Speech is emitted as whole utterances. Token-level streaming into TTS is
 *     deliberately left to the turn-taking phase, where the latency budget and
 *     barge-in cancellation are designed together.
 *
 * Relative imports only — this module is reachable from vite.config.ts.
 */

import { compileFlow, interpolate, nodeModel, type CompiledFlow } from "./flow";
import { selectDigitEdge, selectEdge, selectGlobalNode, type RouteContext } from "./router";
import type {
  EndReason,
  FlowEdge,
  FlowNode,
  FunctionNode,
  LlmMessage,
  VariableValue,
  VmDirective,
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

const TURN_RULES = [
  "You are speaking on a live phone call. Produce ONLY the words to say next.",
  "Say one step's worth of content — at most two short sentences — then stop.",
  "Never narrate stage directions, never describe what you are doing, and never",
  "read instruction text aloud. Do not greet the caller again mid-call.",
].join(" ");

export class ConversationVm {
  private readonly compiled: CompiledFlow;
  private readonly llm: VmLlm;
  private readonly hooks: VmHooks;
  private readonly fallbackModel?: string;
  private readonly maxStepsPerTurn: number;

  private variables: Record<string, VariableValue>;
  private history: LlmMessage[] = [];
  private currentNodeId: string | null;
  /** Nodes to come back to after a `return_to_previous` global node finishes. */
  private returnStack: string[] = [];
  private awaiting: "user" | "digit" | "transfer" | null = null;
  private ended = false;
  private started = false;

  constructor(options: VmOptions) {
    this.compiled = compileFlow(options.flow);
    this.llm = options.llm;
    this.hooks = options.hooks ?? {};
    this.fallbackModel = options.model;
    this.maxStepsPerTurn = options.maxStepsPerTurn ?? DEFAULT_MAX_STEPS;
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
    const ctx = this.routeContext(node);

    if (this.compiled.globalNodes.length > 0) {
      const hit = await selectGlobalNode(this.compiled.globalNodes, ctx, this.llm);
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

    const edge = await selectEdge(node.edges ?? [], ctx, this.llm);
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

    // Otherwise the caller has not yet satisfied any transition, so stay on this
    // step and take another turn rather than dead-ending the call.
    yield* this.advance(node.id);
  }

  /** Execute nodes until the flow blocks or ends. */
  private async *advance(startNodeId: string): AsyncGenerator<VmDirective> {
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
      const result = yield* this.executeNode(node);

      if (result.kind === "await") {
        this.awaiting = result.what;
        if (result.what === "user") yield { type: "await_user", nodeId: node.id };
        return;
      }
      if (result.kind === "end") {
        this.ended = true;
        yield { type: "end_call", nodeId: node.id, reason: result.reason };
        return;
      }
      nodeId = result.nodeId;
    }
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
    const text = await this.resolveSpeech(node);
    if (text) {
      this.history.push({ role: "assistant", content: text });
      yield { type: "speak", nodeId: node.id, text };
    }
    // A conversation node always hands the floor back, even with no outgoing
    // edges — the caller may still be mid-thought, and silence timeouts are the
    // transport's job, not the graph's.
    return { kind: "await", what: "user" };
  }

  private async *execEnd(node: FlowNode): AsyncGenerator<VmDirective, StepResult> {
    const text = await this.resolveSpeech(node);
    if (text) {
      this.history.push({ role: "assistant", content: text });
      yield { type: "speak", nodeId: node.id, text };
    }
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
    const prompt = await this.resolveSpeech(node);
    if (prompt) {
      this.history.push({ role: "assistant", content: prompt });
      yield { type: "speak", nodeId: node.id, text: prompt };
    }
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

  /** Resolve the words a node speaks: verbatim for static text, generated otherwise. */
  private async resolveSpeech(node: FlowNode): Promise<string> {
    const instruction = node.instruction;
    const raw = String(instruction?.text ?? "").trim();
    // Retell's sentinel for "advance without speaking".
    if (/^NO_RESPONSE_NEEDED$/i.test(raw)) return "";
    if (!raw) return "";

    if (instruction?.type === "static_text") return interpolate(raw, this.variables);

    const system: string[] = [TURN_RULES];
    if (this.compiled.globalPrompt) {
      system.push(`# Overall instructions\n${interpolate(this.compiled.globalPrompt, this.variables)}`);
    }
    const known = Object.entries(this.variables).filter(
      ([, v]) => v !== null && v !== undefined && v !== "",
    );
    if (known.length) {
      system.push(
        `# Known information\n${known.map(([k, v]) => `- ${k}: ${String(v)}`).join("\n")}`,
      );
    }
    system.push(`# Your task for this turn\n${interpolate(raw, this.variables)}`);

    try {
      const text = await this.llm.generate(
        [{ role: "system", content: system.join("\n\n") }, ...this.history.slice(-16)],
        { model: nodeModel(node, this.compiled, this.fallbackModel) },
      );
      const clean = text.trim();
      // An empty generation would leave dead air; the authored instruction is a
      // poor line to read aloud but better than silence.
      return clean || interpolate(raw, this.variables);
    } catch (err) {
      this.log(`generation failed on node "${node.id}": ${errMessage(err)}`);
      return interpolate(raw, this.variables);
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
      model: node ? nodeModel(node, this.compiled, this.fallbackModel) : this.fallbackModel,
    };
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
