/**
 * Speculative flat-mode LLM: start generating on stable partial STT before VAD endpoint.
 */

import { gptStream, type ChatMsg } from "../llm/gpt";
import type { SpeculativeSpeechRun } from "../speculative-speech.shared";

export interface SpeculativeFlatOptions {
  apiKey: string;
  model: string;
  systemContent: string;
  history: ChatMsg[];
  partialUserText: string;
  provider?: import("../llm/gpt").VoiceLlmProvider;
}

export type SpeculativeFlatRun = SpeculativeSpeechRun;

export interface SpeculativeSpeechOptions {
  apiKey: string;
  model: string;
  messages: ChatMsg[];
  partial: string;
  provider?: import("../llm/gpt").VoiceLlmProvider;
}

/** Start streaming a reply from a stable partial transcript. */
export function startSpeculativeFlat(options: SpeculativeFlatOptions): SpeculativeFlatRun {
  const ctrl = new AbortController();
  const tokens: string[] = [];
  const messages: ChatMsg[] = [
    { role: "system", content: options.systemContent },
    ...options.history,
    { role: "user", content: options.partialUserText },
  ];

  const done = (async () => {
    try {
      for await (const delta of gptStream(messages, {
        model: options.model,
        apiKey: options.apiKey,
        provider: options.provider,
        signal: ctrl.signal,
        maxTokens: 80,
      })) {
        if (ctrl.signal.aborted) break;
        tokens.push(delta);
      }
    } catch (err) {
      if (!ctrl.signal.aborted) throw err;
    }
    return tokens.join("").trim();
  })();

  return { partial: options.partialUserText, ctrl, tokens, done };
}

/** Start streaming graph speech from stable partial + pre-built messages. */
export function startSpeculativeSpeech(options: SpeculativeSpeechOptions): SpeculativeFlatRun {
  const ctrl = new AbortController();
  const tokens: string[] = [];

  const done = (async () => {
    try {
      for await (const delta of gptStream(options.messages, {
        model: options.model,
        apiKey: options.apiKey,
        provider: options.provider,
        signal: ctrl.signal,
        maxTokens: 64,
      })) {
        if (ctrl.signal.aborted) break;
        tokens.push(delta);
      }
    } catch (err) {
      if (!ctrl.signal.aborted) throw err;
    }
    return tokens.join("").trim();
  })();

  return { partial: options.partial, ctrl, tokens, done };
}

export { partialMatchesFinal, streamSpeculativeTokens } from "../speculative-speech.shared";
