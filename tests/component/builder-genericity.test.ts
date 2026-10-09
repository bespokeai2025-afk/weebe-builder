/**
 * Builder settings that used to be ignored or hardcoded, now honoured: the native speech model,
 * per-engine setting support, knowledge-base content, agent timezone/locale/phone country,
 * language-aware routing, and the single voice table.
 */
import { describe, expect, it } from "vitest";
import { alignFlowModelsToEngine } from "@/lib/voice/graph/flow-models.shared";
import { isModelServedByWebeeProvider } from "@/lib/voice/webee-native.shared";
import { settingSupport } from "@/lib/builder/engine-capabilities";
import { buildKnowledgeBaseSection } from "@/lib/builder/knowledge-base-prompt.shared";
import { normalizeTransferNumber } from "@/lib/builder/export-conversation-flow";
import { interpolate } from "@/lib/voice/graph/flow";
import { selectEdge, selectGlobalNode } from "@/lib/voice/graph/router";
import { activeVoiceSlot, agentVoicePatch, getAgentVoice } from "@/lib/builder/agent-voice.shared";
import type { BuilderSettings } from "@/lib/builder/types";
import type { ConversationFlow } from "@/lib/voice/graph/types";

const base = { agentName: "a", globalPrompt: "", beginMessage: "", model: "gpt-4.1", voiceId: "", language: "en-US", temperature: 0.3 } as BuilderSettings;

describe("native speech model", () => {
  const flow = {
    model_choice: { type: "cascading", model: "gpt-4.1" },
    nodes: [
      { id: "a", type: "conversation", model_choice: { model: "claude-4.6-sonnet" } },
      { id: "b", type: "conversation", model_choice: { model: "gpt-4.1-mini" } },
      { id: "c", type: "conversation" },
    ],
  } as unknown as ConversationFlow;

  it("makes the builder's speech model the flow model and drops overrides the provider cannot serve", () => {
    const { flow: out, warnings } = alignFlowModelsToEngine(flow, "gpt-4o-mini", "openai");
    expect(out.model_choice?.model).toBe("gpt-4o-mini");
    expect(out.nodes.find((n) => n.id === "a")?.model_choice).toBeUndefined();
    expect(out.nodes.find((n) => n.id === "b")?.model_choice?.model).toBe("gpt-4.1-mini");
    expect(warnings).toHaveLength(1);
  });

  it("knows which models each provider serves", () => {
    expect(isModelServedByWebeeProvider("gpt-4.1", "openai")).toBe(true);
    expect(isModelServedByWebeeProvider("claude-4.6-sonnet", "openai")).toBe(false);
    expect(isModelServedByWebeeProvider("gpt-oss-120b", "openai")).toBe(false);
    expect(isModelServedByWebeeProvider("gpt-oss-120b", "cerebras")).toBe(true);
    expect(isModelServedByWebeeProvider("gpt-4.1", "cerebras")).toBe(false);
  });
});

describe("engine capability table", () => {
  it("flags settings the native engine only partly honours, and not on Retell", () => {
    // Background sound now plays on native phone calls, but not in the browser test.
    expect(settingSupport("ambientSound", { ...base, deploymentMode: "WEBEE_NATIVE" }).support).toBe("partial");
    expect(settingSupport("voiceEmotion", { ...base, deploymentMode: "WEBEE_NATIVE", webeeTtsProvider: "openai" }).support).toBe("none");
    expect(settingSupport("ambientSound", { ...base, deploymentMode: "RETELL" }).support).toBe("full");
    expect(settingSupport("enableBackchannel", { ...base, deploymentMode: "WEBEE_NATIVE" }).support).toBe("full");
  });
  it("treats Fish-only prosody as supported with Fish TTS and ignored with others", () => {
    const native = { ...base, deploymentMode: "WEBEE_NATIVE" as const };
    expect(settingSupport("voiceEmotion", native).support).toBe("full");
    expect(settingSupport("voiceEmotion", { ...native, webeeTtsProvider: "openai" }).support).toBe("none");
  });
});

describe("knowledge base prompt", () => {
  it("includes local text, lists documents without it, and caps the size", () => {
    const kb = buildKnowledgeBaseSection(
      [
        { name: "FAQ", type: "text", content: "We open at 9am." },
        { name: "Brochure", type: "file" },
        { name: "Huge", type: "text", content: "x".repeat(500) },
      ],
      { maxChars: 300 },
    );
    expect(kb.text).toContain("We open at 9am.");
    expect(kb.missing).toEqual(["Brochure"]);
    expect(kb.truncated).toEqual(["Huge"]);
    expect(kb.text.length).toBeLessThan(600);
  });
});

describe("agent locale", () => {
  it("converts national numbers with the agent's calling code, keeping +44 as the default", () => {
    expect(normalizeTransferNumber("07412 345678")).toBe("+447412345678");
    expect(normalizeTransferNumber("0412 345 678", "61")).toBe("+61412345678");
    expect(normalizeTransferNumber("+14155550100", "61")).toBe("+14155550100");
  });

  it("speaks dates in the agent's locale", () => {
    const us = interpolate("{{current_date}}", { locale: "en-US", timezone: "America/New_York" });
    const gb = interpolate("{{current_date}}", {});
    expect(us).toMatch(/^[A-Z][a-z]+ \d{1,2}, \d{4}$/);
    expect(gb).toMatch(/^\d{1,2} [A-Z][a-z]+ \d{4}$/);
  });
});

describe("language-aware routing", () => {
  function counting() {
    const spy = { calls: 0 };
    const llm = {
      classify: async () => {
        spy.calls += 1;
        return 0;
      },
      generate: async () => "",
      extract: async () => ({}),
    } as never;
    return { llm, spy };
  }
  const edges = ["user says yes", "user says no"].map((prompt, i) => ({
    id: `e${i}`,
    destination_node_id: `d${i}`,
    transition_condition: { type: "prompt" as const, prompt },
  }));
  const ctx = (text: string, englishRules: boolean) =>
    ({ history: [{ role: "user", content: text }], variables: {}, globalPrompt: "", flex: false, englishRules }) as never;

  it("uses English yes/no matching for English agents", async () => {
    const { llm, spy } = counting();
    const r = await selectEdge(edges, ctx("yes", true), llm);
    expect(spy.calls).toBe(0);
    expect(r.method).toBe("heuristic");
  });

  it("lets the classifier decide for other languages", async () => {
    const { llm, spy } = counting();
    await selectEdge(edges, ctx("sí, claro", false), llm);
    expect(spy.calls).toBe(1);
  });

  it("checks global nodes for non-English callers instead of skipping them on an English keyword gate", async () => {
    const { llm, spy } = counting();
    await selectGlobalNode([{ condition: "caller wants a human" }], ctx("quiero hablar con una persona", false), llm);
    expect(spy.calls).toBe(1);
    const english = counting();
    const r = await selectGlobalNode([{ condition: "caller wants a human" }], ctx("my house has three bedrooms", true), english.llm);
    expect(r.method).toBe("global_skip");
  });
});

describe("agent voice table", () => {
  it("resolves the voice the agent will actually use", () => {
    expect(activeVoiceSlot({ deploymentMode: "RETELL" })).toBe("retell");
    expect(activeVoiceSlot({ deploymentMode: "WEBEE_NATIVE" })).toBe("fish");
    expect(activeVoiceSlot({ deploymentMode: "WEBEE_NATIVE", webeeTtsProvider: "cartesia" })).toBe("cartesia");
    expect(getAgentVoice({ deploymentMode: "WEBEE_NATIVE", webeeVoiceId: "abc", webeeVoiceName: "Sarah" })).toMatchObject({ id: "abc", name: "Sarah", provider: "Fish Audio" });
  });
  it("writes a provider's voice to its own field", () => {
    expect(agentVoicePatch("fish", "abc", "Sarah")).toEqual({ webeeVoiceId: "abc", webeeVoiceName: "Sarah" });
    expect(agentVoicePatch("cartesia", "uuid")).toEqual({ cartesiaVoice: "uuid" });
  });
});
