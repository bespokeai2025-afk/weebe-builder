/**
 * Retell's own platform applies the nine Agent Handbook toggles internally when it deploys an
 * agent with `handbook_config` set. The native engine has no such built-in behaviour to opt into —
 * these toggles were saved by the builder and then read by nobody, so a native call behaved
 * identically whether every toggle was on or off. Compiled into plain prompt instructions instead,
 * one line per enabled toggle.
 */
import { describe, expect, it } from "vitest";
import {
  appendHandbookInstructions,
  buildHandbookInstructions,
} from "@/lib/voice/graph/handbook-instructions.shared";

describe("buildHandbookInstructions", () => {
  it("returns nothing when every toggle is off or unset", () => {
    expect(buildHandbookInstructions({})).toBe("");
    expect(buildHandbookInstructions(null)).toBe("");
    expect(buildHandbookInstructions({ handbookHighEmpathy: false })).toBe("");
  });

  it("includes exactly one line per enabled toggle, no more", () => {
    const out = buildHandbookInstructions({
      handbookHighEmpathy: true,
      handbookAiDisclosure: true,
    });
    const lines = out.split("\n");
    expect(lines).toHaveLength(2);
    expect(out).toMatch(/empathy/i);
    expect(out).toMatch(/AI assistant/i);
  });

  it("ignores a truthy-but-not-boolean value — only an exact true enables a toggle", () => {
    expect(buildHandbookInstructions({ handbookHighEmpathy: "true" as unknown as boolean })).toBe("");
    expect(buildHandbookInstructions({ handbookHighEmpathy: 1 as unknown as boolean })).toBe("");
  });

  it("covers all nine toggles, each with its own distinguishable instruction", () => {
    const allOn = {
      handbookEchoVerification: true,
      handbookSpeechNormalization: true,
      handbookDefaultPersonality: true,
      handbookScopeBoundaries: true,
      handbookNaturalFillerWords: true,
      handbookNatoPhoneticAlphabet: true,
      handbookHighEmpathy: true,
      handbookAiDisclosure: true,
      handbookSmartMatching: true,
    };
    const lines = buildHandbookInstructions(allOn).split("\n");
    expect(lines).toHaveLength(9);
    expect(new Set(lines).size).toBe(9); // no two toggles produce the same line
  });
});

describe("appendHandbookInstructions", () => {
  it("leaves the prompt untouched when nothing is enabled", () => {
    expect(appendHandbookInstructions("Be brief.", {})).toBe("Be brief.");
    expect(appendHandbookInstructions("Be brief.", null)).toBe("Be brief.");
  });

  it("appends the handbook block after the existing prompt, separated clearly", () => {
    const out = appendHandbookInstructions("Be brief.", { handbookHighEmpathy: true });
    expect(out.startsWith("Be brief.")).toBe(true);
    expect(out).toMatch(/empathy/i);
  });

  it("still produces a usable prompt when the base prompt is empty", () => {
    const out = appendHandbookInstructions("", { handbookAiDisclosure: true });
    expect(out).toMatch(/AI assistant/i);
    expect(out.startsWith("\n")).toBe(false);
  });
});
