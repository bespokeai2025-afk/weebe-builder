/**
 * Per-turn latency marks for WEBEE Native graph calls.
 *
 * Marks are relative to `turnOrigin` (usually VAD endpoint) unless `sttFinalAt`
 * is set, in which case graph phases are also reported from STT final.
 */

export type RouteMethod =
  | "unconditional"
  | "equation"
  | "equation_else"
  | "generic_single"
  | "heuristic"
  | "llm"
  | "none"
  | "global_heuristic"
  | "global_llm"
  | "global_skip";

export type LatencyMark =
  | "stt_final"
  | "graph_user_submit"
  | "graph_route_global_start"
  | "graph_route_global_end"
  | "graph_route_edge_start"
  | "graph_route_edge_end"
  | "graph_advance_start"
  | "graph_node_loaded"
  | "graph_advance_end"
  | "llm_route_request_start"
  | "llm_route_complete"
  | "llm_speech_request_start"
  | "llm_speech_first_token"
  | "llm_speech_first_sentence"
  | "llm_speech_complete"
  | "tts_speak_start"
  | "tts_first_audio"
  | "partial_stt_stable"
  | "stt_partial_fallback"
  | "speculative_llm_start"
  | "speculative_speech_hit"
  | "user_speech_start"
  | "turn_detected"
  | "interruption_detected"
  | "audio_stop"
  | "response_start"
  | "response_cancelled"
  | "router_start"
  | "router_complete";

export class CallTurnTrace {
  private readonly marks = new Map<LatencyMark, number>();
  private sttFinalAt: number | null = null;
  private userSpeechStartAt: number | null = null;
  private edgeRouteMethod: RouteMethod | null = null;
  private globalRouteMethod: RouteMethod | null = null;

  constructor(
    readonly turnId: number,
    readonly turnOrigin: number,
    private readonly logPrefix = "[cascade-gateway]",
  ) {}

  /** Anchor graph/LLM marks to STT completion (endpoint→stt is separate). */
  setSttFinal(at: number): void {
    this.sttFinalAt = at;
    this.mark("stt_final", at);
  }

  setUserSpeechStart(at: number): void {
    this.userSpeechStartAt = at;
    this.mark("user_speech_start", at);
  }

  mark(name: LatencyMark, at: number = Date.now()): void {
    if (!this.marks.has(name)) this.marks.set(name, at);
  }

  /** Record how an edge or global transition was resolved (equation/heuristic/llm/…). */
  recordRoute(scope: "edge" | "global", method: RouteMethod): void {
    if (scope === "edge") this.edgeRouteMethod = method;
    else this.globalRouteMethod = method;
  }

  msSinceStt(name: LatencyMark): number | null {
    if (!this.sttFinalAt) return null;
    const at = this.marks.get(name);
    return at ? Math.round(at - this.sttFinalAt) : null;
  }

  msSinceUserSpeech(name: LatencyMark): number | null {
    if (!this.userSpeechStartAt) return null;
    const at = this.marks.get(name);
    return at ? Math.round(at - this.userSpeechStartAt) : null;
  }

  flushSummary(): void {
    const fromStt = (name: LatencyMark) => {
      const ms = this.msSinceStt(name);
      return ms !== null ? `${ms}ms` : "n/a";
    };
    const fromSpeech = (name: LatencyMark) => {
      const ms = this.msSinceUserSpeech(name);
      return ms !== null ? `${ms}ms` : "n/a";
    };
    console.log(
      `${this.logPrefix} turn ${this.turnId} trace` +
        ` stt_final=0ms` +
        ` route_global=${fromStt("graph_route_global_end")}` +
        ` route_global_method=${this.globalRouteMethod ?? "n/a"}` +
        ` route_edge=${fromStt("graph_route_edge_end")}` +
        ` route_edge_method=${this.edgeRouteMethod ?? "n/a"}` +
        ` node_loaded=${fromStt("graph_node_loaded")}` +
        ` llm_route=${fromStt("llm_route_complete")}` +
        ` llm_1st_token=${fromStt("llm_speech_first_token")}` +
        ` llm_1st_sentence=${fromStt("llm_speech_first_sentence")}` +
        ` tts_1st_audio=${fromStt("tts_first_audio")}` +
        ` speech→stt_partial=${fromSpeech("partial_stt_stable")}` +
        ` speech→audio=${fromSpeech("tts_first_audio")}`,
    );
  }
}
