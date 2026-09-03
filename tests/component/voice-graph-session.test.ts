import { describe, expect, it } from "vitest";

import { GraphSession } from "@/lib/voice/gateway/graph-session";
import { ConversationVm } from "@/lib/voice/graph/vm";
import type { ConversationFlow, FlowNode, VmLlm } from "@/lib/voice/graph/types";

function llm(classify: (choices: string[]) => number = () => 0): VmLlm {
  return {
    generate: async () => "generated",
    generateStream: async function* () {
      yield "generated";
    },
    classify: async (_m, choices) => classify(choices),
    extract: async () => ({}),
  };
}

function say(id: string, text: string, edges: FlowNode["edges"] = []): FlowNode {
  return { id, type: "conversation", instruction: { type: "static_text", text }, edges };
}

function edge(id: string, to: string, prompt = ""): NonNullable<FlowNode["edges"]>[number] {
  return { id, destination_node_id: to, transition_condition: { type: "prompt", prompt } };
}

function flowOf(nodes: FlowNode[]): ConversationFlow {
  return { start_node_id: nodes[0]?.id, nodes };
}

/** Records every callback the session makes, in order. */
function recorder(overrides: { speakDelayMs?: number } = {}) {
  const events: string[] = [];
  const readSpeech = async (source: string | AsyncIterable<string>) => {
    if (typeof source === "string") return source;
    let text = "";
    for await (const chunk of source) text = text ? `${text} ${chunk}` : chunk;
    return text;
  };
  const callbacks = {
    speak: async (source: string | AsyncIterable<string>) => {
      const text = await readSpeech(source);
      events.push(`speak:${text}`);
      if (overrides.speakDelayMs) {
        await new Promise((r) => setTimeout(r, overrides.speakDelayMs));
      }
      events.push(`spoken:${text}`);
    },
    onTranscript: (role: string, text: string) => events.push(`transcript:${role}:${text}`),
    onNodeActive: (nodeId: string) => events.push(`node:${nodeId}`),
    onAwaitUser: (opts) =>
      events.push(opts?.silenceTimeoutMs ? `await_user:${opts.silenceTimeoutMs}` : "await_user"),
    onAwaitDigit: (ms: number) => events.push(`await_digit:${ms}`),
    onVariables: (v: Record<string, unknown>) => events.push(`vars:${Object.keys(v).join(",")}`),
    onToolCall: (id: string, _r: string, ok: boolean) => events.push(`tool:${id}:${ok}`),
    onAgentSwap: (id: string) => events.push(`swap:${id}`),
    onEnd: (reason: string) => events.push(`end:${reason}`),
    onError: (m: string) => events.push(`error:${m}`),
  };
  return { events, callbacks };
}

describe("GraphSession", () => {
  it("emits the agent transcript before the audio it describes", async () => {
    const { events, callbacks } = recorder();
    const vm = new ConversationVm({ flow: flowOf([say("greet", "Hello")]), llm: llm() });

    await new GraphSession(vm, callbacks).begin();

    expect(events).toEqual(["node:greet", "transcript:agent:Hello", "speak:Hello", "spoken:Hello", "node:greet", "await_user"]);
  });

  it("finishes speaking one utterance before starting the next", async () => {
    const { events, callbacks } = recorder({ speakDelayMs: 10 });
    const vm = new ConversationVm({
      flow: flowOf([
        say("a", "First line", [edge("e1", "b")]),
        { id: "b", type: "end", instruction: { type: "static_text", text: "Second line" } },
      ]),
      llm: llm(),
    });
    const session = new GraphSession(vm, callbacks);

    await session.begin();
    await session.submitUserText("ok");

    // Audio ordering is the whole game: a closing line must never overtake the
    // sentence before it.
    expect(events.filter((e) => e.startsWith("speak") || e.startsWith("spoken"))).toEqual([
      "speak:First line",
      "spoken:First line",
      "speak:Second line",
      "spoken:Second line",
    ]);
  });

  it("serialises overlapping turns instead of running them concurrently", async () => {
    const { events, callbacks } = recorder({ speakDelayMs: 10 });
    const vm = new ConversationVm({
      flow: flowOf([say("loop", "Say more?")]),
      llm: llm(() => -1),
    });
    const session = new GraphSession(vm, callbacks);
    await session.begin();

    // Two utterances arriving back to back must not both drive the VM at once.
    await Promise.all([session.submitUserText("one"), session.submitUserText("two")]);

    const speaks = events.filter((e) => e.startsWith("speak:") || e.startsWith("spoken:"));
    // Strictly alternating start/finish proves no interleaving.
    for (let i = 0; i < speaks.length; i += 2) {
      expect(speaks[i]).toMatch(/^speak:/);
      expect(speaks[i + 1]).toMatch(/^spoken:/);
    }
  });

  it("releases the mic gate on await_user, not when speech finishes", async () => {
    const { events, callbacks } = recorder();
    const vm = new ConversationVm({ flow: flowOf([say("greet", "Hi")]), llm: llm() });

    await new GraphSession(vm, callbacks).begin();

    // A gateway that unmuted on speak completion would barge over its own audio.
    expect(events.indexOf("await_user")).toBeGreaterThan(events.indexOf("spoken:Hi"));
  });

  it("feeds a transfer outcome back so the failed edge stays reachable", async () => {
    const { events, callbacks } = recorder();
    const vm = new ConversationVm({
      flow: flowOf([
        {
          id: "xfer",
          type: "transfer_call",
          transfer_destination: { type: "predefined", number: "+447412345678" },
          transfer_option: { type: "cold_transfer" },
          edge: edge("f", "sorry", "Transfer failed"),
        } as FlowNode,
        say("sorry", "Nobody is free"),
      ]),
      llm: llm(),
    });

    await new GraphSession(vm, {
      ...callbacks,
      onTransfer: async (destination) => {
        events.push(`transfer:${destination}`);
        return false;
      },
    }).begin();

    expect(events).toContain("transfer:+447412345678");
    expect(events).toContain("speak:Nobody is free");
  });

  it("treats a transfer as failed when the host cannot bridge calls", async () => {
    const { events, callbacks } = recorder();
    const vm = new ConversationVm({
      flow: flowOf([
        {
          id: "xfer",
          type: "transfer_call",
          transfer_destination: { type: "predefined", number: "+447412345678" },
          edge: edge("f", "sorry", "Transfer failed"),
        } as FlowNode,
        say("sorry", "Cannot transfer"),
      ]),
      llm: llm(),
    });

    // No onTransfer hook at all: claiming success would silently drop the caller.
    await new GraphSession(vm, callbacks).begin();

    expect(events).toContain("speak:Cannot transfer");
  });

  it("ends the call when the host bridges the transfer", async () => {
    const { events, callbacks } = recorder();
    const vm = new ConversationVm({
      flow: flowOf([
        {
          id: "xfer",
          type: "transfer_call",
          transfer_destination: { type: "predefined", number: "+441234567890" },
        } as FlowNode,
      ]),
      llm: llm(),
    });

    await new GraphSession(vm, { ...callbacks, onTransfer: async () => true }).begin();

    expect(events).toContain("end:transferred");
  });

  it("reports a thrown speak error instead of leaving the turn dangling", async () => {
    const events: string[] = [];
    const vm = new ConversationVm({ flow: flowOf([say("greet", "Hi")]), llm: llm() });

    await new GraphSession(vm, {
      speak: async () => {
        throw new Error("tts exploded");
      },
      onError: (m) => events.push(`error:${m}`),
    }).begin();

    expect(events).toEqual(["error:tts exploded"]);
  });

  it("surfaces DTMF prompts and forwards digits", async () => {
    const { events, callbacks } = recorder();
    const vm = new ConversationVm({
      flow: flowOf([
        {
          id: "menu",
          type: "press_digit",
          instruction: { type: "static_text", text: "Press 1" },
          pause_detection_ms: 2000,
          edges: [edge("e1", "sales", "caller presses 1")],
        } as FlowNode,
        say("sales", "Sales"),
      ]),
      llm: llm(),
    });
    const session = new GraphSession(vm, callbacks);

    await session.begin();
    expect(events).toContain("await_digit:2000");

    await session.submitDigit("1");
    expect(events).toContain("speak:Sales");
  });

  it("tracks the underlying VM's ended state", async () => {
    const vm = new ConversationVm({
      flow: flowOf([{ id: "bye", type: "end", instruction: { type: "static_text", text: "Bye" } }]),
      llm: llm(),
    });
    const { callbacks } = recorder();
    const session = new GraphSession(vm, callbacks);

    expect(session.isEnded).toBe(false);
    await session.begin();
    expect(session.isEnded).toBe(true);
  });

  it("forwards a silence timeout to the wait edge", async () => {
    const { events, callbacks } = recorder();
    const vm = new ConversationVm({
      flow: flowOf([
        {
          id: "wait",
          type: "conversation",
          start_speaker: "user",
          silence_timeout_ms: 5000,
          retry_count: 0,
          instruction: { type: "static_text", text: "" },
          edges: [edge("e1", "next", "timeout")],
        },
        say("next", "Are you there?"),
      ]),
      llm: llm(),
    });
    const session = new GraphSession(vm, callbacks);
    await session.begin();
    expect(events).toContain("await_user:5000");
    await session.submitSilenceTimeout();
    expect(events).toContain("speak:Are you there?");
  });
});
