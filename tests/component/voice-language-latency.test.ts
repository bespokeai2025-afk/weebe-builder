import { describe, expect, it } from "vitest";

import { resolveCascadeTuning } from "@/lib/voice/cascade-tuning.shared";
import {
  resolveWebeeClassifierModel,
  resolveWebeeLlmProvider,
  resolveWebeeSpeechModel,
} from "@/lib/voice/webee-native.shared";
import {
  buildLanguageLockInstruction,
  isEnglishOnlyAgent,
  isLikelyEnglishSttHallucination,
  isMostlyNonLatinScript,
  normalizeEnglishLockedSttText,
  resolveSttLanguageCode,
  romanizeForEnglishStt,
} from "@/lib/voice/language-lock.shared";

describe("language lock", () => {
  it("locks English agents to English only", () => {
    const instruction = buildLanguageLockInstruction(["en-US"]);
    expect(instruction).toContain("ONLY in English");
    expect(instruction).toContain("Latin letters");
    expect(instruction).not.toContain("repeat in English");
    expect(instruction.length).toBeLessThan(120);
    expect(isEnglishOnlyAgent(["en-US"])).toBe(true);
  });

  it("detects non-Latin STT output", () => {
    expect(isMostlyNonLatinScript("आरजो")).toBe(true);
    expect(isMostlyNonLatinScript("Arjo")).toBe(false);
    expect(isMostlyNonLatinScript("Ar jo")).toBe(false);
  });

  it("drops Fish hallucinations and romanizes Indic script for English STT", () => {
    expect(isLikelyEnglishSttHallucination("嗯。")).toBe(true);
    expect(normalizeEnglishLockedSttText("嗯。", "en")).toBe("");
    expect(normalizeEnglishLockedSttText("आर जो", "en")).toBe("ar jo");
    expect(normalizeEnglishLockedSttText("हेलो हेलो", "en")).toBe("hello hello");
    expect(normalizeEnglishLockedSttText("哈喽，哈喽", "en")).toBe("hello");
    expect(normalizeEnglishLockedSttText("Arjo", "en")).toBe("Arjo");
    expect(normalizeEnglishLockedSttText("yes please", "en")).toBe("yes please");
    expect(normalizeEnglishLockedSttText("ar jao", "en")).toBe("");
    expect(normalizeEnglishLockedSttText("Ar jao.", "en")).toBe("");
  });

  it("romanizes common mis-detected greetings and names", () => {
    expect(romanizeForEnglishStt("आर जो")).toBe("ar jo");
    expect(romanizeForEnglishStt("हेलो")).toBe("hello");
    expect(romanizeForEnglishStt("哈喽")).toBe("hello");
  });

  it("maps en-US to Whisper language en", () => {
    expect(resolveSttLanguageCode(["en-US"])).toBe("en");
  });

  it("skips hard lock for multilingual flex mode", () => {
    const instruction = buildLanguageLockInstruction(["multi"]);
    expect(instruction).not.toContain("ONLY in English");
    expect(resolveSttLanguageCode(["multi"])).toBeUndefined();
  });
});

describe("WEBEE Native speech model", () => {
  it("defaults the provider to OpenAI", () => {
    expect(resolveWebeeLlmProvider({})).toBe("openai");
    expect(resolveWebeeLlmProvider({ webeeLlmProvider: "cerebras" })).toBe("cerebras");
  });

  it("defaults to OpenAI gpt-4o-mini when provider is unset", () => {
    expect(resolveWebeeSpeechModel({})).toBe("gpt-4o-mini");
    expect(resolveWebeeSpeechModel({ model: "gpt-4.1" })).toBe("gpt-4o-mini");
    expect(resolveWebeeSpeechModel({ webeeSpeechModel: "gpt-4.1" })).toBe("gpt-4.1");
  });

  it("uses Cerebras models when the provider is Cerebras", () => {
    expect(resolveWebeeSpeechModel({ webeeLlmProvider: "cerebras" })).toBe("gpt-oss-120b");
    expect(resolveWebeeSpeechModel({ webeeLlmProvider: "cerebras", model: "gpt-4o-mini" })).toBe(
      "gpt-oss-120b",
    );
    expect(resolveWebeeSpeechModel({ webeeLlmProvider: "cerebras", webeeSpeechModel: "llama3.1-8b" })).toBe(
      "llama3.1-8b",
    );
  });
});

describe("WEBEE Native classifier model", () => {
  it("defaults to gpt-4.1-nano on OpenAI", () => {
    expect(resolveWebeeClassifierModel({})).toBe("gpt-4.1-nano");
  });

  it("uses gpt-oss-120b when the provider is Cerebras", () => {
    expect(resolveWebeeClassifierModel({ webeeLlmProvider: "cerebras" })).toBe("gpt-oss-120b");
    expect(
      resolveWebeeClassifierModel({ webeeLlmProvider: "cerebras", webeeClassifierModel: "gpt-4o-mini" }),
    ).toBe("gpt-oss-120b");
  });
});

describe("resolveTextModel", () => {
  it("maps OpenAI chat ids onto gpt-oss-120b for Cerebras", async () => {
    const { resolveTextModel } = await import("@/lib/voice/llm/gpt");
    expect(resolveTextModel("gpt-4o-mini", "cerebras")).toBe("gpt-oss-120b");
    expect(resolveTextModel("gpt-4.1-nano", "cerebras")).toBe("gpt-oss-120b");
    expect(resolveTextModel("gpt-oss-120b", "cerebras")).toBe("gpt-oss-120b");
    expect(resolveTextModel("llama3.1-8b", "cerebras")).toBe("llama3.1-8b");
    expect(resolveTextModel("llama-3.3-70b", "cerebras")).toBe("llama-3.3-70b");
    expect(resolveTextModel("qwen-3-32b", "cerebras")).toBe("qwen-3-32b");
  });

  it("keeps OpenAI ids when falling back to OpenAI", async () => {
    const { resolveTextModel, resolveVoiceLlmAuth } = await import("@/lib/voice/llm/gpt");
    expect(resolveTextModel("gpt-4o-mini", "openai")).toBe("gpt-4o-mini");
    expect(resolveTextModel("gpt-4o", "openai")).toBe("gpt-4o");
    expect(resolveTextModel("gpt-4.1-nano", "openai")).toBe("gpt-4.1-nano");
    expect(resolveTextModel("gpt-oss-120b", "openai")).toBe("gpt-4o-mini");
    expect(resolveVoiceLlmAuth("sk-test", "openai").provider).toBe("openai");
    expect(resolveVoiceLlmAuth("sk-test", "openai").url).toContain("openai.com");
  });
});

describe("routing heuristics", () => {
  it("skips classifier for obvious yes/no and short names", async () => {
    const { tryHeuristicEdgeIndex, looksLikePhoneAnswer } = await import("@/lib/voice/graph/router");
    expect(
      tryHeuristicEdgeIndex(["caller says yes", "caller says no"], "yes"),
    ).toBe(0);
    expect(
      tryHeuristicEdgeIndex(["caller says yes", "caller says no"], "yes please"),
    ).toBe(0);
    expect(
      tryHeuristicEdgeIndex(["caller says yes", "caller says no"], "sim"),
    ).toBe(0);
    expect(
      tryHeuristicEdgeIndex(["caller gives their name", "caller refuses"], "Arjo"),
    ).toBe(0);
    const { looksLikeNameAnswer, looksLikeRepairRequest } = await import("@/lib/voice/graph/router");
    expect(looksLikeNameAnswer("What?")).toBe(false);
    expect(looksLikeNameAnswer("What")).toBe(false);
    expect(looksLikeRepairRequest("What?")).toBe(true);
    expect(looksLikeNameAnswer("Arjo")).toBe(true);
    expect(looksLikePhoneAnswer("Double nine six four nine one nine triple zero.")).toBe(true);
    expect(
      tryHeuristicEdgeIndex(
        ["caller provides phone number", "caller refuses"],
        "Double nine six four nine one nine triple zero.",
      ),
    ).toBe(0);
  });

  it("routes any answer edges on okay without classifier", async () => {
    const { tryHeuristicEdgeIndex } = await import("@/lib/voice/graph/router");
    expect(
      tryHeuristicEdgeIndex(["any answer"], "Okay."),
    ).toBe(0);
    expect(
      tryHeuristicEdgeIndex(["any acknowledgement"], "yes"),
    ).toBe(0);
  });

  it("routes address and owner-occupied answers without classifier", async () => {
    const { tryHeuristicEdgeIndex, looksLikeAddressAnswer } = await import("@/lib/voice/graph/router");
    expect(looksLikeAddressAnswer("24 Baker Street, London SW1A 1AA")).toBe(true);
    expect(
      tryHeuristicEdgeIndex(
        ["caller gives property address", "caller refuses"],
        "Twenty Four Street, Dubai",
      ),
    ).toBe(0);
    expect(
      tryHeuristicEdgeIndex(
        ["property is owner occupied", "property is rented"],
        "I live in it",
      ),
    ).toBe(0);
  });

  it("routes property type and tenure answers", async () => {
    const { tryHeuristicEdgeIndex } = await import("@/lib/voice/graph/router");
    expect(
      tryHeuristicEdgeIndex(["caller says flat", "caller says house"], "It's a flat"),
    ).toBe(0);
    expect(
      tryHeuristicEdgeIndex(["if its vacant", "if its rented out"], "It's rented out"),
    ).toBe(1);
    expect(
      tryHeuristicEdgeIndex(["Which floor is it on"], "Second floor"),
    ).toBe(0);
  });

  it("does not route numeric answers to hang-up or opt-out edges", async () => {
    const { tryHeuristicEdgeIndex } = await import("@/lib/voice/graph/router");
    expect(
      tryHeuristicEdgeIndex(
        ["user not interested / wants to end", "user provides phone number"],
        "9964919000",
      ),
    ).toBe(1);
    expect(
      tryHeuristicEdgeIndex(["user not interested / wants to end"], "Okay"),
    ).toBeNull();
    expect(
      tryHeuristicEdgeIndex(
        ["user not interested / wants to end", "any answer"],
        "Okay",
      ),
    ).toBe(1);
    expect(
      tryHeuristicEdgeIndex(
        ["user not interested / wants to end", "any answer"],
        "not interested",
      ),
    ).toBe(0);
  });

  it("does not treat repeated yes as a skip-to-booking edge", async () => {
    const { tryHeuristicEdgeIndex } = await import("@/lib/voice/graph/router");
    expect(
      tryHeuristicEdgeIndex(
        [
          "user confirms the postcode is correct",
          "appointment is booked / wrap up the call",
        ],
        "Yes. Yes.",
        "Just to check, the postcode is P for Papa. Is that correct?",
      ),
    ).toBe(0);
    expect(
      tryHeuristicEdgeIndex(
        ["user is interested in selling", "user confirms the postcode is correct"],
        "yes",
        "Is that postcode correct?",
      ),
    ).toBe(1);
  });

  it("routes yes through a single continue edge that never says yes", async () => {
    const { tryHeuristicEdgeIndex } = await import("@/lib/voice/graph/router");
    expect(
      tryHeuristicEdgeIndex(
        ["user is ready to give their name", "user is not interested / hang up"],
        "Yes.",
        "Does that all sound ok?",
      ),
    ).toBe(0);
  });

  it("routes owner and title answers without a classifier", async () => {
    const { tryHeuristicEdgeIndex, looksLikeOwnerAnswer, looksLikeTitleAnswer } = await import(
      "@/lib/voice/graph/router"
    );
    expect(looksLikeOwnerAnswer("I am owner of the property.")).toBe(true);
    expect(looksLikeTitleAnswer("Mister.")).toBe(true);
    expect(
      tryHeuristicEdgeIndex(
        [
          "user is the owner of the property",
          "user is calling on behalf of someone else",
        ],
        "I am owner of the property.",
        "Are you the owner or calling on behalf of someone else?",
      ),
    ).toBe(0);
    expect(
      tryHeuristicEdgeIndex(
        ["user gives their preferred title", "user declined"],
        "Mister.",
        "What is your preferred title? For example, Mr, Mrs, Miss.",
      ),
    ).toBe(0);
  });
});

describe("speech interpolation", () => {
  it("never leaves raw template tokens in spoken text", async () => {
    const { interpolateForSpeech } = await import("@/lib/voice/graph/flow");
    expect(
      interpolateForSpeech("I have your mobile number as {{mobile}}.", {}),
    ).toBe("");
    expect(
      interpolateForSpeech("Hello {{first_name}}", { first_name: "Arjo" }),
    ).toBe("Hello Arjo");
    expect(
      interpolateForSpeech("I have the property type as a {{property_type}}", {
        property_type: "flat",
      }),
    ).toBe("I have the property type as a flat");
    expect(
      interpolateForSpeech(
        "if it is don't read it back to client!\nI have your contact address {{address}}\nif variables are not detected please ask for them. post code read back phonetic alphabet. is that correct?",
        {},
      ),
    ).not.toMatch(/don't read it back/i);
  });
});

describe("house floor skip heuristic", () => {
  it("detects standalone house answers", async () => {
    const { historyIndicatesStandaloneHouse } = await import(
      "@/lib/voice/graph/stt-clarification.shared"
    );
    expect(
      historyIndicatesStandaloneHouse([
        { role: "user", content: "House." },
        { role: "agent", content: "Thank you." },
      ]),
    ).toBe(true);
    expect(
      historyIndicatesStandaloneHouse([
        { role: "assistant", content: "Is it a house, flat, or bungalow?" },
        { role: "user", content: "House." },
      ]),
    ).toBe(true);
    expect(
      historyIndicatesStandaloneHouse([{ role: "user", content: "It's a flat on the second floor." }]),
    ).toBe(false);
  });
});

describe("structured routing output", () => {
  it("parses JSON transition numbers and labels", async () => {
    const { parseTransitionIndex } = await import("@/lib/voice/graph/llm");
    expect(parseTransitionIndex('{"transition": 2}', ["a", "b", "c"])).toBe(1);
    expect(parseTransitionIndex('{"transition": "positive"}', ["negative path", "positive path"])).toBe(1);
    expect(parseTransitionIndex('{"transition": 0}', ["a"])).toBe(-1);
  });
});

describe("cascade tuning", () => {
  it("uses faster endpointing when responsiveness is high", () => {
    const fast = resolveCascadeTuning({ responsiveness: 1.5 });
    const slow = resolveCascadeTuning({ responsiveness: 0.5 });
    expect(fast.vad.silenceFramesTrigger!).toBeLessThan(slow.vad.silenceFramesTrigger!);
    expect(fast.silenceDurationMs).toBeLessThan(slow.silenceDurationMs);
  });

  it("lowers barge-in threshold when interruption sensitivity is high", () => {
    const sensitive = resolveCascadeTuning({ interruptionSensitivity: 0.9 });
    const guarded = resolveCascadeTuning({ interruptionSensitivity: 0.2 });
    expect(sensitive.bargeInSpeechFrames).toBeLessThan(guarded.bargeInSpeechFrames);
  });

  it("shortens utterance coalesce for obvious one-word replies", async () => {
    const { resolveUtteranceCoalesceMs } = await import("@/lib/voice/cascade-tuning.shared");
    expect(resolveUtteranceCoalesceMs("yes please", 600)).toBe(50);
    expect(resolveUtteranceCoalesceMs("Twenty Four Street Dubai", 600)).toBe(600);
  });

  it("commits collect-path partials without waiting on STT final", async () => {
    const {
      looksLikeCommitReadyPartial,
      shouldSkipSttFinal,
      resolveEndpointHangoverMs,
    } = await import("@/lib/voice/turn-commit.shared");
    expect(looksLikeCommitReadyPartial("Yes.")).toBe(true);
    expect(looksLikeCommitReadyPartial("SW1A 1AA")).toBe(true);
    expect(looksLikeCommitReadyPartial("07700900123")).toBe(true);
    expect(looksLikeCommitReadyPartial("Mister.")).toBe(true);
    expect(looksLikeCommitReadyPartial("I am owner of the property.")).toBe(true);
    expect(looksLikeCommitReadyPartial("Twenty Four Street Dubai")).toBe(false);
    expect(shouldSkipSttFinal("yes", true)).toBe(true);
    expect(shouldSkipSttFinal("SW1A 1AA")).toBe(true);
    expect(shouldSkipSttFinal("Twenty Four Street Dubai")).toBe(false);
    expect(resolveEndpointHangoverMs("yes", 500)).toBe(250);
    expect(resolveEndpointHangoverMs("Twenty Four Street Dubai", 500)).toBe(500);
  });

  it("uses a 500ms hangover at default responsiveness", () => {
    const tuned = resolveCascadeTuning({ responsiveness: 1 });
    expect(tuned.silenceDurationMs).toBe(500);
    expect(tuned.utteranceCoalesceMs).toBeLessThanOrEqual(200);
  });
});

describe("Fish TTS prosody", () => {
  it("maps builder emotion and speed into Fish request fields", async () => {
    const { resolveFishTtsVoiceRequest } = await import("@/lib/voice/fish-tts-prosody.shared");
    const req = resolveFishTtsVoiceRequest({
      voiceId: "abc",
      sampleRate: 24000,
      settings: {
        voiceEmotion: "happy",
        voiceSpeed: 1.1,
        volume: 1.2,
        voiceTemperature: 1,
      },
    });
    expect(req.speed).toBe(1.1);
    // Reference voices cap temperature for call-stable timbre (Retell-style).
    expect(req.temperature).toBeLessThanOrEqual(0.2);
    expect(req.volume).toBeGreaterThan(0);

    const happy = resolveFishTtsVoiceRequest({
      voiceId: "abc",
      sampleRate: 24000,
      settings: { voiceEmotion: "happy" },
    });
    expect(happy.temperature).toBeLessThanOrEqual(0.2);
  });
});

describe("speech prompt", () => {
  it("treats collect-path questions as spoken lines and ask-tasks as model work", async () => {
    const { looksLikeSpokenLine, looksLikeAgentTask, leadFieldsForTurn } = await import(
      "@/lib/voice/graph/speech-prompt.shared"
    );
    expect(looksLikeSpokenLine("Can I take your postcode?")).toBe(true);
    expect(looksLikeAgentTask("Ask what type of property it is.")).toBe(true);
    expect(looksLikeSpokenLine("Ask what type of property it is.")).toBe(false);
    expect(looksLikeSpokenLine("Ask the preferred title")).toBe(false);
    expect(
      leadFieldsForTurn("Hello {{first_name}}", { first_name: "Steven", last_name: "Pearce" }),
    ).toEqual([["first_name", "Steven"]]);
    expect(leadFieldsForTurn("Ask the property type.", { first_name: "Steven" })).toEqual([]);
  });

  it("phrases generic Ask/Collect node text as a spoken question", async () => {
    const { spokenQuestionFromTask, splitPromptParts, spokenFallback } = await import(
      "@/lib/voice/graph/speech-prompt.shared"
    );
    expect(spokenQuestionFromTask("Ask the preferred title")).toBe("What's your preferred title?");
    expect(spokenQuestionFromTask("Ask what type of property it is.")).toBe(
      "What type of property is it?",
    );
    expect(spokenQuestionFromTask("Ask the caller to confirm the name Steven.")).toBe(
      "Can I confirm the name Steven?",
    );
    expect(spokenQuestionFromTask("Find out their last name")).toBe("What's your last name?");
    expect(spokenQuestionFromTask("Collect the postcode")).toBe("What's your postcode?");

    const parts = splitPromptParts(
      "Ask the preferred title\nMr, Mrs, Miss, Ms, Dr\nDo not ask any other questions.",
      () => false,
    );
    expect(parts.script).toBe("");
    expect(parts.task).toContain("Ask the preferred title");
    expect(spokenFallback(parts)).toBe("What's your preferred title?");
  });
});
