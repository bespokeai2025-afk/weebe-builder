/**
 * Wrap VmLlm with latency marks for routing and speech generation.
 */

import type { CallTurnTrace } from "./latency-trace";
import type { LlmMessage, VariableValue, VmLlm } from "./types";

/** Characters sent to the model — a cheap stand-in for prompt tokens. */
export function promptCharCount(messages: Array<{ content?: unknown }>): number {
  let n = 0;
  for (const m of messages) n += typeof m.content === "string" ? m.content.length : 0;
  return n;
}

export function createTracedVmLlm(
  inner: VmLlm,
  getTrace: () => CallTurnTrace | null,
): VmLlm {
  return {
    async generate(messages, opts) {
      const trace = getTrace();
      trace?.setSpeechLlm(opts?.model, promptCharCount(messages));
      trace?.mark("llm_speech_request_start");
      const text = await inner.generate(messages, opts);
      trace?.mark("llm_speech_complete");
      return text;
    },

    generateStream(messages, opts) {
      const trace = getTrace();
      trace?.setSpeechLlm(opts?.model, promptCharCount(messages));
      const innerStream = inner.generateStream?.(messages, opts);
      // No streaming on the inner client: still return a stream (callers `for await` it), with
      // the whole reply as one chunk.
      if (!innerStream) {
        return (async function* () {
          trace?.mark("llm_speech_request_start");
          const text = await inner.generate(messages, opts);
          trace?.mark("llm_speech_complete");
          yield text;
        })();
      }
      const stream: AsyncIterable<string> = innerStream;

      trace?.mark("llm_speech_request_start");

      async function* wrap(): AsyncGenerator<string> {
        let first = true;
        try {
          for await (const delta of stream) {
            if (first && delta) {
              trace?.mark("llm_speech_first_token");
              first = false;
            }
            yield delta;
          }
        } finally {
          trace?.mark("llm_speech_complete");
        }
      }
      return wrap();
    },

    async classify(messages, choices, opts) {
      const trace = getTrace();
      trace?.mark("llm_route_request_start");
      const index = await inner.classify(messages, choices, opts);
      trace?.mark("llm_route_complete");
      return index;
    },

    async extract(messages, fields, opts) {
      return inner.extract(messages, fields, opts);
    },
  };
}
