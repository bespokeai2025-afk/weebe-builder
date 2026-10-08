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

import { normaliseSpokenNumbers, validateExtractedValue } from "./extraction-validation.shared";
import {
  gptComplete,
  gptStream,
  type CerebrasBreaker,
  type ChatMsg,
  type VoiceLlmProvider,
} from "../llm/gpt";
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
  // Without these two lines the classifier forced a reply onto whichever option looked least
  // wrong: on a live call "it's freehold" (answering a different question) went to "if its
  // vacant" — a wrong turn the call could not recover from, where staying would have been. The
  // wording is a balance: a stricter "the caller must have said it" also sent real answers
  // ("we live in it ourselves" → "im living there") to none on gpt-4.1-nano, making callers
  // repeat themselves. This version kept every real answer routing in offline checks.
  "Pick an option only if the caller's latest reply itself states what that option's condition describes, in any wording. A reply about a related topic, or one you would have to infer the option from, does not count.",
  "If the reply answers something else, is off topic, or meets no condition clearly, pick the 'None of these' option. Staying is safe; a wrong transition is not.",
  'Reply with JSON only: {"transition": <option_number_or_label>}',
  "Option numbers are 1-based. Use 0 if none apply.",
  'Labels may match option text (e.g. "positive"). Do not generate speech.',
].join("\n");

/** gpt-oss spends a slice of max_tokens on reasoning — keep room for spoken words. */
const SPEECH_MAX_TOKENS = 512;
const CLASSIFY_MAX_TOKENS = 128;
const EXTRACT_MAX_TOKENS = 256;
/**
 * classify()/extract()'s own timeout, far below gpt.ts's 25s default. Both run on the critical
 * path of a turn (before the agent can speak or route), and both already have a graceful fallback
 * for failure — `selectEdge` falls back to an unconditional edge or "none", extraction is
 * documented best-effort and simply skips the turn's variables — so a slow response should fail
 * fast into that fallback, not hold the whole turn hostage. Observed on a real call: a single
 * classify request took 12.3s (well under the old 25s ceiling, so it never errored — it just made
 * the caller wait 12+ seconds mid-turn, in dead air, right as they were confirming their email). A
 * caller getting a slightly-worse routing/extraction outcome after 4s beats 12+ seconds of silence.
 */
const BACKGROUND_LLM_TIMEOUT_MS = 4_000;

const EXTRACT_SYSTEM = [
  "You extract structured data from a voice conversation.",
  "Return a JSON object containing only the requested fields.",
  "Use null for any field the conversation does not clearly establish — never guess,",
  "and never carry over an example value as if the caller had said it.",
  "Only put a value in a field if it is that kind of information. An email address goes only in",
  "an email field, a phone number only in a phone field, a person's name only in a name field.",
  "If the caller gave an email when asked for a phone number, the phone field is null.",
  "Take values from what the CALLER said, not from what the agent said.",
  "Phone numbers in the conversation have already been converted to digits — copy them",
  "exactly, digit for digit, without adding or removing any. Write phone numbers as digits only.",
  "If the caller corrects themselves, use the corrected value.",
].join("\n");

export function createOpenAiVmLlm(options: OpenAiVmLlmOptions): VmLlm {
  const { apiKey, provider } = options;
  const defaultModel =
    options.defaultModel ||
    (provider === "openai" ? WEBEE_NATIVE_OPENAI_SPEECH_MODEL : WEBEE_NATIVE_SPEECH_MODEL);
  const classifierModel =
    options.classifierModel ||
    (provider === "openai" ? WEBEE_NATIVE_OPENAI_CLASSIFIER_MODEL : WEBEE_NATIVE_CLASSIFIER_MODEL);

  // One breaker per call (per createOpenAiVmLlm instance — one is built per voice call). Once any
  // call on this call hits a Cerebras quota/rate-limit error, every later call/classify/extract
  // on the SAME call skips straight to OpenAI instead of paying for a second failed Cerebras
  // attempt first — see CerebrasBreaker's doc comment for why this must not be shared across calls.
  const breaker: CerebrasBreaker = { down: false };

  const complete = (messages: LlmMessage[], model: string, extra: Record<string, unknown> = {}) =>
    gptComplete(messages as ChatMsg[], {
      model,
      apiKey,
      provider,
      temperature: options.temperature ?? 0.3,
      breaker,
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
        breaker,
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
        timeoutMs: BACKGROUND_LLM_TIMEOUT_MS,
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

      // The caller's spoken numbers become numerals here, deterministically, so the
      // model only copies digits — left to the model, "double oh" lost a zero.
      const normalised = messages.map((m) =>
        m.role === "user" && typeof m.content === "string"
          ? { ...m, content: normaliseSpokenNumbers(m.content) }
          : m,
      );
      const prompt: LlmMessage[] = [
        { role: "system", content: EXTRACT_SYSTEM },
        ...normalised,
        {
          role: "user",
          content: `Extract these fields from the conversation:\n${spec}\n\nReturn JSON with exactly these keys.`,
        },
      ];

      const raw = await complete(prompt, opts?.model || classifierModel, {
        temperature: 0,
        maxTokens: EXTRACT_MAX_TOKENS,
        responseFormat: "json_object",
        timeoutMs: BACKGROUND_LLM_TIMEOUT_MS,
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
        // Type first, then meaning: a string that is the wrong kind for its field
        // (an email in mobile_number) is dropped so the agent asks again, rather
        // than stored and read back to the caller.
        const typed = coerce(source[field.name], field.type);
        const value = validateExtractedValue(field, typed);
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
