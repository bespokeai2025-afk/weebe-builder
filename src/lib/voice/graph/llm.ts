/**
 * Conversation graph VM — Cerebras (OpenAI-compatible) model access.
 *
 * The VM depends on the narrow `VmLlm` interface so its graph semantics can be
 * tested without a network. This is the production implementation of that
 * interface; the prompt engineering for routing and extraction lives here rather
 * than in the VM so it can be tuned without touching flow control.
 *
 * Relative imports only — this module is reachable from vite.config.ts.
 */

import { gptComplete, gptStream, type ChatMsg, type VoiceLlmProvider } from "../llm/gpt";
import {
  WEBEE_NATIVE_CLASSIFIER_MODEL,
  WEBEE_NATIVE_OPENAI_CLASSIFIER_MODEL,
  WEBEE_NATIVE_OPENAI_SPEECH_MODEL,
  WEBEE_NATIVE_SPEECH_MODEL,
} from "../webee-native.shared";
import type { LlmMessage, VariableValue, VmLlm } from "./types";

export interface OpenAiVmLlmOptions {
  apiKey: string;
  provider?: VoiceLlmProvider;
  /** Used when a call site passes no per-node model override. */
  defaultModel?: string;
  /**
   * Cheaper model for routing and extraction. These calls happen on every turn,
   * so paying full model price for "which of these three conditions applies" is
   * the single easiest cost regression to make.
   */
  classifierModel?: string;
  temperature?: number;
}

const CLASSIFY_SYSTEM = [
  "You are a routing classifier for a voice agent.",
  "Pick exactly one transition option, or none.",
  'Reply with JSON only: {"transition": <option_number_or_label>}',
  "Option numbers are 1-based. Use 0 if none apply.",
  "Labels may match option text (e.g. \"positive\"). Do not generate speech.",
].join("\n");

/** gpt-oss spends a slice of max_tokens on reasoning — keep room for spoken words. */
const SPEECH_MAX_TOKENS = 512;
const CLASSIFY_MAX_TOKENS = 128;
const EXTRACT_MAX_TOKENS = 256;

const EXTRACT_SYSTEM = [
  "You extract structured data from a voice conversation.",
  "Return a JSON object containing only the requested fields.",
  "Use null for any field the conversation does not clearly establish — never guess,",
  "and never carry over an example value as if the caller had said it.",
].join("\n");

export function createOpenAiVmLlm(options: OpenAiVmLlmOptions): VmLlm {
  const { apiKey, provider } = options;
  const defaultModel =
    options.defaultModel ||
    (provider === "openai" ? WEBEE_NATIVE_OPENAI_SPEECH_MODEL : WEBEE_NATIVE_SPEECH_MODEL);
  const classifierModel =
    options.classifierModel ||
    (provider === "openai" ? WEBEE_NATIVE_OPENAI_CLASSIFIER_MODEL : WEBEE_NATIVE_CLASSIFIER_MODEL);

  const complete = (messages: LlmMessage[], model: string, extra: Record<string, unknown> = {}) =>
    gptComplete(messages as ChatMsg[], {
      model,
      apiKey,
      provider,
      temperature: options.temperature ?? 0.3,
      ...extra,
    });

  return {
    async generate(messages, opts) {
      return complete(messages, opts?.model || defaultModel, { maxTokens: SPEECH_MAX_TOKENS });
    },

    generateStream(messages, opts) {
      return gptStream(messages as ChatMsg[], {
        model: opts?.model || defaultModel,
        apiKey,
        provider,
        temperature: options.temperature ?? 0.3,
        maxTokens: SPEECH_MAX_TOKENS,
        signal: opts?.signal,
      });
    },

    async classify(messages, choices, opts) {
      if (choices.length === 0) return -1;

      const numbered = choices.map((c, i) => `${i + 1}. ${c}`).join("\n");
      const prompt: LlmMessage[] = [
        { role: "system", content: CLASSIFY_SYSTEM },
        ...messages,
        {
          role: "user",
          content: `Options:\n${numbered}\n\nWhich transition applies?`,
        },
      ];

      // Routing always uses the cheap classifier — never the speech model.
      const raw = await complete(prompt, opts?.model || classifierModel, {
        temperature: 0,
        maxTokens: CLASSIFY_MAX_TOKENS,
        responseFormat: "json_object",
      });

      return parseTransitionIndex(raw, choices);
    },

    async extract(messages, fields, opts) {
      if (fields.length === 0) return {};

      const spec = fields
        .map((f) => {
          const parts = [`- "${f.name}" (${f.type || "string"})`];
          if (f.description) parts.push(`: ${f.description}`);
          if (f.choices?.length) parts.push(` — one of: ${f.choices.join(", ")}`);
          return parts.join("");
        })
        .join("\n");

      const prompt: LlmMessage[] = [
        { role: "system", content: EXTRACT_SYSTEM },
        ...messages,
        {
          role: "user",
          content: `Extract these fields from the conversation:\n${spec}\n\nReturn JSON with exactly these keys.`,
        },
      ];

      const raw = await complete(prompt, opts?.model || classifierModel, {
        temperature: 0,
        maxTokens: EXTRACT_MAX_TOKENS,
        responseFormat: "json_object",
      });

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return {};
      }
      if (typeof parsed !== "object" || parsed === null) return {};

      // Only keep requested keys, and coerce to the declared type so downstream
      // interpolation and comparisons see consistent values.
      const out: Record<string, VariableValue> = {};
      const source = parsed as Record<string, unknown>;
      for (const field of fields) {
        if (!(field.name in source)) continue;
        const value = coerce(source[field.name], field.type);
        if (value !== null) out[field.name] = value;
      }
      return out;
    },
  };
}

/** Parse structured routing output like {"transition": 2} or {"transition": "positive"}. */
export function parseTransitionIndex(raw: string, choices: string[]): number {
  try {
    const parsed = JSON.parse(raw) as { transition?: unknown };
    const value = parsed.transition;
    if (typeof value === "number") {
      if (value <= 0 || value > choices.length) return -1;
      return value - 1;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      const asNum = Number.parseInt(trimmed, 10);
      if (Number.isFinite(asNum) && asNum > 0 && asNum <= choices.length) return asNum - 1;
      const needle = trimmed.toLowerCase();
      if (!needle || needle === "0" || needle === "none") return -1;
      for (let i = 0; i < choices.length; i++) {
        if (choices[i].toLowerCase().includes(needle)) return i;
      }
    }
  } catch {
    /* fall through to legacy number parsing */
  }

  const match = raw.match(/-?\d+/);
  if (!match) return -1;
  const picked = Number.parseInt(match[0], 10);
  if (picked <= 0 || picked > choices.length) return -1;
  return picked - 1;
}

function coerce(value: unknown, type: string): VariableValue {
  if (value === null || value === undefined || value === "") return null;

  switch (type) {
    case "number": {
      const n = typeof value === "number" ? value : Number(String(value).replace(/[^0-9.\-]/g, ""));
      return Number.isFinite(n) ? n : null;
    }
    case "boolean": {
      if (typeof value === "boolean") return value;
      const s = String(value).trim().toLowerCase();
      if (["true", "yes", "y", "1"].includes(s)) return true;
      if (["false", "no", "n", "0"].includes(s)) return false;
      return null;
    }
    default: {
      if (typeof value === "object") return JSON.stringify(value);
      return String(value);
    }
  }
}
