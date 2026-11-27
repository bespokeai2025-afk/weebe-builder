/**
 * Combined routing + reply: one model call that picks the next step and writes the agent's line.
 *
 * The separate path (`selectEdge` → `classify`, then a speech call) costs a full classifier round
 * trip before the reply can be spoken: measured on a live call, classifier turns were heard at
 * 3.4–4.0 s against 2.0–2.5 s for turns the quick rules routed. Here the model is forced to call
 * `workflow_reply(transition, reply)` with `transition` first, so the route is known a few tokens
 * after the first one and the reply streams straight on behind it.
 *
 * Properties kept from the separate path:
 *   - Routing text never reaches the voice: the reply is a tool argument, not prose.
 *   - Fail-closed: a transition that is not one of the options means "stay"; the agent continues
 *     the current step rather than taking a transition nobody authored.
 *   - Fixed-text and action destinations still run as authored; their reply is discarded.
 *
 * Off by default — `webeeRoutingMode: "combined"` on the agent, or WEBEE_NATIVE_ROUTING_MODE.
 *
 * Relative imports only — this module is reachable from vite.config.ts.
 */

export type RoutingMode = "separate" | "combined";

export const ROUTING_MODE_ENV = "WEBEE_NATIVE_ROUTING_MODE";

/** The agent's `webeeRoutingMode`, else WEBEE_NATIVE_ROUTING_MODE, else "separate". */
export function resolveRoutingMode(settings: Record<string, unknown> | null | undefined): RoutingMode {
  const own = String((settings ?? {}).webeeRoutingMode ?? "").trim().toLowerCase();
  if (own === "combined" || own === "separate") return own;
  const fromEnv = String((typeof process !== "undefined" ? process.env?.[ROUTING_MODE_ENV] : undefined) ?? "")
    .trim()
    .toLowerCase();
  return fromEnv === "combined" ? "combined" : "separate";
}

export const ROUTE_REPLY_TOOL_NAME = "workflow_reply";

/** OpenAI-style tool definition. `transition` is declared first: models emit arguments in order. */
export const ROUTE_REPLY_TOOL = {
  type: "function",
  function: {
    name: ROUTE_REPLY_TOOL_NAME,
    description: "Choose where the call goes next and say the agent's next line.",
    parameters: {
      type: "object",
      properties: {
        transition: {
          type: "integer",
          description: "Number of the option the caller's latest reply meets, or 0 to stay on the current step.",
        },
        reply: {
          type: "string",
          description: "The agent's next spoken line for the chosen step, or \"\" when that step speaks for itself.",
        },
      },
      required: ["transition", "reply"],
      additionalProperties: false,
    },
  },
} as const;

export const ROUTE_REPLY_TOOL_CHOICE = { type: "function", function: { name: ROUTE_REPLY_TOOL_NAME } } as const;

/** One option the model may pick, as the VM describes it. */
export interface RouteReplyOption {
  /** The transition condition, as authored (variables filled). */
  condition: string;
  /** Destination step's name. */
  stepName: string;
  /** What the agent's line must do at that step; null when the step speaks for itself. */
  task: string | null;
  /** Why the step speaks for itself ("a fixed line", "an action"), when `task` is null. */
  selfSpeaking?: string;
  /** Extra instruction for that step (e.g. details not provided yet). */
  note?: string;
}

/**
 * The routing block of the system prompt. Same decision rule as the classifier (CLASSIFY_SYSTEM
 * in llm.ts): an option counts only when the caller's latest reply itself states it.
 */
export function routeReplyInstructions(input: {
  currentStep: string;
  currentTask: string;
  options: RouteReplyOption[];
}): string {
  const lines: string[] = [
    "In ONE call to workflow_reply you decide where the call goes next and say the agent's next line.",
    "",
    `Current step: ${input.currentStep}. Its task (do not read aloud):`,
    input.currentTask,
    "",
    "Options for `transition`:",
    "0. None of these — the caller has not met any condition below. Stay on the current step.",
  ];
  input.options.forEach((o, i) => {
    const target =
      o.task !== null
        ? `next step "${o.stepName}" — the agent's line must do this (do not read aloud): ${o.task}`
        : `next step "${o.stepName}" ${o.selfSpeaking ?? "speaks for itself"} — set reply to "".`;
    lines.push(`${i + 1}. If: ${o.condition}\n   Then: ${target}${o.note ? `\n   ${o.note}` : ""}`);
  });
  lines.push(
    "",
    "Choosing `transition`: pick an option only if the caller's latest reply itself states what its condition describes, in any wording. A reply about a related topic, or one you would have to infer the option from, does not count. If it answers something else, is off topic, or meets no condition clearly, pick 0 — staying is safe; a wrong transition is not.",
    "Writing `reply`: the agent's next spoken line, carrying out ONLY the chosen step's task. For 0, if the caller asked something answer it briefly, then bring them back to what the current step still needs, in fresh words. Short, natural spoken sentences. Never say option numbers, step names, conditions, placeholders or curly braces.",
  );
  return lines.join("\n");
}

/** The closing instruction, after the conversation. */
export const ROUTE_REPLY_TAIL =
  "Call workflow_reply now: `transition` first (an option number, or 0 to stay), then `reply`.";

/**
 * Incremental parser for streamed `workflow_reply` arguments: `{"transition": 2, "reply": "…"}`
 * arriving in arbitrary fragments. Emits the transition as soon as its number is complete and the
 * reply as decoded text pieces, so speech can start before the arguments finish.
 */
export class RouteReplyArgumentsParser {
  private buf = "";
  private transitionDone = false;
  private transitionValue: number | null = null;
  /** Index in `buf` where the reply string's content starts, once its opening quote is seen. */
  private replyStart = -1;
  /** How far into `buf` the reply has been decoded. */
  private replyPos = -1;
  private replyClosed = false;

  /** Feed one fragment; returns what became available. */
  push(fragment: string): { transition?: number | null; reply?: string } {
    this.buf += fragment;
    const out: { transition?: number | null; reply?: string } = {};
    if (!this.transitionDone) {
      const m = /"transition"\s*:\s*(-?\d+)(?=\s*[,}])/.exec(this.buf);
      const bad = !m && /"transition"\s*:\s*(?!-?\d)[^\s]/.exec(this.buf);
      if (m) {
        this.transitionDone = true;
        this.transitionValue = Number(m[1]);
        out.transition = this.transitionValue;
      } else if (bad) {
        // A non-integer transition (a label, null): not an option — the caller treats it as stay.
        this.transitionDone = true;
        out.transition = null;
      }
    }
    if (this.replyStart < 0) {
      const r = /"reply"\s*:\s*"/.exec(this.buf);
      if (r) {
        this.replyStart = r.index + r[0].length;
        this.replyPos = this.replyStart;
      }
    }
    if (this.replyStart >= 0 && !this.replyClosed) {
      const text = this.decodeReply();
      if (text) out.reply = text;
    }
    return out;
  }

  get transition(): number | null {
    return this.transitionValue;
  }

  get hasTransition(): boolean {
    return this.transitionDone;
  }

  /** Decode JSON string content from `replyPos`, stopping before an incomplete escape. */
  private decodeReply(): string {
    let out = "";
    let i = this.replyPos;
    const s = this.buf;
    while (i < s.length) {
      const ch = s[i]!;
      if (ch === '"') {
        this.replyClosed = true;
        i++;
        break;
      }
      if (ch !== "\\") {
        out += ch;
        i++;
        continue;
      }
      if (i + 1 >= s.length) break; // escape split across fragments
      const next = s[i + 1]!;
      if (next === "u") {
        if (i + 6 > s.length) break;
        const code = Number.parseInt(s.slice(i + 2, i + 6), 16);
        if (Number.isFinite(code)) out += String.fromCharCode(code);
        i += 6;
        continue;
      }
      const simple: Record<string, string> = { n: "\n", t: "\t", r: "", b: "", f: "", '"': '"', "\\": "\\", "/": "/" };
      out += simple[next] ?? next;
      i += 2;
    }
    this.replyPos = i;
    return out;
  }
}
