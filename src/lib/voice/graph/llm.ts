/**
 * Conversation graph VM — OpenAI-backed model access.
 *
 * The VM depends on the narrow `VmLlm` interface so its graph semantics can be
 * tested without a network. This is the production implementation of that
 * interface; the prompt engineering for routing and extraction lives here rather
 * than in the VM so it can be tuned without touching flow control.
 *
 * Relative imports only — this module is reachable from vite.config.ts.
 */

import { gptComplete, type ChatMsg } from "../llm/gpt";
import type { LlmMessage, VariableValue, VmLlm } from "./types";

export interface OpenAiVmLlmOptions {
  apiKey: string;
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
  "You are a routing classifier inside a voice agent.",
  "Read the conversation, then decide which ONE of the numbered options applies.",
  "Reply with the option number only — no words, no punctuation, no explanation.",
  'If none of the options apply, reply with "0".',
].join("\n");

const EXTRACT_SYSTEM = [
  "You extract structured data from a voice conversation.",
  "Return a JSON object containing only the requested fields.",
  "Use null for any field the conversation does not clearly establish — never guess,",
  "and never carry over an example value as if the caller had said it.",
].join("\n");

export function createOpenAiVmLlm(options: OpenAiVmLlmOptions): VmLlm {
  const { apiKey } = options;
  const defaultModel = options.defaultModel || "gpt-4.1";
  const classifierModel = options.classifierModel || "gpt-4.1-mini";

  const complete = (messages: LlmMessage[], model: string, extra: Record<string, unknown> = {}) =>
    gptComplete(messages as ChatMsg[], {
      model,
      apiKey,
      temperature: options.temperature,
      ...extra,
    });

  return {
    async generate(messages, opts) {
      return complete(messages, opts?.model || defaultModel);
    },

    async classify(messages, choices, opts) {
      if (choices.length === 0) return -1;

      const numbered = choices.map((c, i) => `${i + 1}. ${c}`).join("\n");
      const prompt: LlmMessage[] = [
        { role: "system", content: CLASSIFY_SYSTEM },
        ...messages,
        {
          role: "user",
          content: `Options:\n${numbered}\n\nWhich option applies? Answer with a single number.`,
        },
      ];

      // Routing must not inherit a creative temperature from the agent config.
      const raw = await complete(prompt, opts?.model || classifierModel, {
        temperature: 0,
        maxTokens: 8,
      });

      const match = raw.match(/-?\d+/);
      if (!match) return -1;
      const picked = Number.parseInt(match[0], 10);
      // The prompt asks for 1-based answers and reserves 0 for "none".
      if (picked <= 0 || picked > choices.length) return -1;
      return picked - 1;
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
