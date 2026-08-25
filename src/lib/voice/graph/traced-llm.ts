/**
 * Wrap VmLlm with latency marks for routing and speech generation.
 */

import type { CallTurnTrace } from "./latency-trace";
import type { LlmMessage, VariableValue, VmLlm } from "./types";

export function createTracedVmLlm(
  inner: VmLlm,
  getTrace: () => CallTurnTrace | null,
): VmLlm {
  return {
    async generate(messages, opts) {
      const trace = getTrace();
      trace?.mark("llm_speech_request_start");
      const text = await inner.generate(messages, opts);
      trace?.mark("llm_speech_complete");
      return text;
    },

    generateStream(messages, opts) {
      const innerStream = inner.generateStream?.(messages, opts);
      if (!innerStream) return inner.generate(messages, opts).then((t) => (async function* () { yield t; })());

      const trace = getTrace();
      trace?.mark("llm_speech_request_start");

      async function* wrap(): AsyncGenerator<string> {
        let first = true;
        try {
          for await (const delta of innerStream) {
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
