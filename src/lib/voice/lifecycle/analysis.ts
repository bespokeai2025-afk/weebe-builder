/**
 * Post-call analysis.
 *
 * Retell runs a text-LLM pass after every call and reports the result as
 * `call_analysis`. Downstream code depends on those four fields heavily —
 * `user_sentiment` becomes `calls.sentiment`, `call_successful` decides outbound
 * campaign outcomes, `in_voicemail` suppresses lead updates, and
 * `custom_analysis_data` feeds bookings, CRM dispatch and lead-gen mapping — so
 * the native engine has to produce them too, in the same shape.
 *
 * Relative imports only (reachable from vite.config.ts).
 */
import { gptComplete, resolveVoiceLlmApiKey } from "../llm/gpt";
import type { AnalysisField, RetellCallAnalysis, TranscriptTurn } from "./types";
import { formatTranscript, mergeTurns } from "./transcript";

/** Cerebras gpt-oss-120b — same model the live graph uses. */
const DEFAULT_ANALYSIS_MODEL = "gpt-4o-mini";

/**
 * Same keyword list the webhook processor and the `is_voicemail` backfill use.
 * Kept in sync deliberately: a call we do not flag here is still caught there,
 * but flagging it here saves a needless LLM call.
 */
const VOICEMAIL_KEYWORDS = [
  "voicemail",
  "answering machine",
  "leave a message",
  "leave your message",
  "mailbox",
  "after the beep",
  "not available",
  "automated message",
  "please record",
];

export interface AnalyzeCallInput {
  turns: readonly TranscriptTurn[];
  agentName?: string | null;
  /** Free-text definition of a successful call, from the agent's settings. */
  successCriteria?: string | null;
  /** The agent's `post_call_analysis_data` schema. */
  schema?: readonly AnalysisField[];
  model?: string | null;
  apiKey?: string;
  durationSeconds: number;
  disconnectionReason?: string | null;
  signal?: AbortSignal;
}

/**
 * Run the analysis pass, degrading to heuristics rather than failing.
 *
 * A call that produced no analysis still has to reach the webhook, because the
 * transcript, recording and campaign bookkeeping ride on the same event. So
 * every failure path here returns a usable object instead of throwing.
 */
export async function analyzeCall(input: AnalyzeCallInput): Promise<RetellCallAnalysis> {
  const turns = mergeTurns(input.turns);
  const transcript = formatTranscript(turns);
  const userSaidSomething = turns.some((t) => t.role === "user");
  const voicemailHeuristic = detectVoicemail(turns, input.disconnectionReason);

  // No caller speech means there is nothing to summarise and nothing to judge.
  // Retell reports these as unsuccessful, and paying for an LLM call to be told
  // "the user did not speak" is waste on the highest-volume call type there is.
  if (!transcript || !userSaidSomething) {
    return {
      call_summary: transcript
        ? "The agent spoke but the caller never responded."
        : "No conversation took place.",
      user_sentiment: "Neutral",
      call_successful: false,
      in_voicemail: voicemailHeuristic,
      custom_analysis_data: {},
    };
  }

  const apiKey = input.apiKey ?? resolveVoiceLlmApiKey();
  if (!apiKey) {
    return heuristicAnalysis(transcript, voicemailHeuristic);
  }

  const model = input.model || DEFAULT_ANALYSIS_MODEL;
  const schema = input.schema ?? [];

  try {
    // Built-ins and custom fields run separately and concurrently.
    //
    // They used to share ONE call with one JSON reply capped at 900 tokens. Custom fields are
    // often full extraction prompts in their own right — a nested "structured JSON output", a
    // multi-tag sentiment classifier — written for Retell, which evaluates each field on its own.
    // Crammed together they competed for the budget, their instructions interfered, and fields
    // named like the built-ins (call_summary, user_sentiment) were left null because the model had
    // "already answered" them at the top level. On a real 16-turn call, 9 of 10 fields came back
    // empty, including an email the caller had spoken.
    const [builtInsRaw, custom] = await Promise.all([
      gptComplete(
        [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: buildUserPrompt({
              transcript,
              agentName: input.agentName,
              successCriteria: input.successCriteria,
              schema: [],
              durationSeconds: input.durationSeconds,
              disconnectionReason: input.disconnectionReason,
            }),
          },
        ],
        {
          model,
          apiKey,
          temperature: 0,
          maxTokens: 900,
          responseFormat: "json_object",
          signal: input.signal,
        },
      ),
      extractCustomFields(transcript, schema, {
        model,
        apiKey,
        agentName: input.agentName,
        signal: input.signal,
      }),
    ]);
    const analysis = normalizeAnalysis(builtInsRaw, [], voicemailHeuristic);
    analysis.custom_analysis_data = coerceCustomData(custom, schema);
    return analysis;
  } catch (err) {
    console.warn(
      "[voice-analysis] analysis pass failed, falling back to heuristics:",
      err instanceof Error ? err.message : err,
    );
    return heuristicAnalysis(transcript, voicemailHeuristic);
  }
}

const FIELD_SYSTEM_PROMPT = [
  "You extract exactly ONE field from a completed phone call transcript between an AI agent and a caller.",
  "Follow the field's instructions exactly — they may ask for a date, a label, a summary or a JSON object.",
  'Reply with a single JSON object of the form {"value": ...} and nothing else.',
  "If the instructions ask for a JSON object, put that object in value.",
  "Use null for value when the transcript does not establish it. Never invent facts that are not in the transcript.",
  'Speech-to-text may have mangled spoken details ("jane gmail.com" for jane@gmail.com); recover them when the meaning is clear.',
].join(" ");

/** How many field extractions run at once — enough to finish fast, few enough to avoid rate limits. */
const FIELD_CONCURRENCY = 4;

async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Extract each custom post-call field with its own call, the way Retell evaluates them.
 *
 * One field failing leaves that field null; it never blanks the rest.
 */
export async function extractCustomFields(
  transcript: string,
  schema: readonly AnalysisField[],
  opts: { model: string; apiKey: string; agentName?: string | null; signal?: AbortSignal },
): Promise<Record<string, unknown>> {
  const fields = schema.filter((f) => f.name);
  if (fields.length === 0) return {};

  const values = await mapPool(fields, FIELD_CONCURRENCY, async (field) => {
    const spec = [
      `Field name: ${field.name}`,
      `Type: ${field.type ?? "string"}`,
      field.choices?.length ? `Allowed values: ${field.choices.join(", ")}` : "",
      field.description ? `Instructions:\n${field.description}` : "",
      field.examples?.length ? `Example value: ${field.examples[0]}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    try {
      const raw = await gptComplete(
        [
          { role: "system", content: FIELD_SYSTEM_PROMPT },
          {
            role: "user",
            content: `${opts.agentName ? `Agent: ${opts.agentName}\n\n` : ""}Transcript:\n${transcript}\n\n${spec}`,
          },
        ],
        {
          model: opts.model,
          apiKey: opts.apiKey,
          temperature: 0,
          // A field may itself be a structured JSON summary, so it gets real room.
          maxTokens: 1200,
          responseFormat: "json_object",
          signal: opts.signal,
        },
      );
      const parsed = JSON.parse(extractJsonObject(raw)) as Record<string, unknown>;
      // A field whose own instructions say "produce a JSON object" often returns that object
      // directly rather than inside {"value": …}. Treat it as the value instead of dropping it.
      const value =
        parsed && typeof parsed === "object" && "value" in parsed
          ? parsed.value
          : parsed && typeof parsed === "object" && Object.keys(parsed).length > 0
            ? parsed
            : null;
      return [field.name, value ?? null] as const;
    } catch (err) {
      console.warn(
        `[voice-analysis] field "${field.name}" extraction failed:`,
        err instanceof Error ? err.message : err,
      );
      return [field.name, null] as const;
    }
  });

  return Object.fromEntries(values);
}

/**
 * Detect an answering machine from the shape of the call.
 *
 * Keywords alone are not enough — a human who says "I can leave a message for
 * him" would be flagged. The structural signal is what separates the two: a
 * machine talks once and never takes another turn, and because consecutive
 * utterances from one speaker are merged, that shows up as exactly one user turn
 * for the whole call. Any real conversation has more.
 */
function detectVoicemail(
  turns: readonly TranscriptTurn[],
  disconnectionReason?: string | null,
): boolean {
  if (disconnectionReason === "voicemail_reached") return true;
  const userTurns = turns.filter((t) => t.role === "user");
  if (userTurns.length !== 1) return false;
  const text = userTurns[0].text.toLowerCase();
  return VOICEMAIL_KEYWORDS.some((kw) => text.includes(kw));
}

/** Analysis without an LLM: honest about what it does not know. */
function heuristicAnalysis(transcript: string, inVoicemail: boolean): RetellCallAnalysis {
  const firstLines = transcript.split("\n").slice(0, 4).join(" ").slice(0, 400);
  return {
    call_summary: firstLines || null,
    user_sentiment: "Neutral",
    // Null, not false: we genuinely do not know, and false would mark a real
    // campaign contact as a failed outcome.
    call_successful: null,
    in_voicemail: inVoicemail,
    custom_analysis_data: {},
  };
}

const SYSTEM_PROMPT = [
  "You analyse completed phone conversations between an AI voice agent and a human.",
  "Reply with a single JSON object and nothing else.",
  "Keys: call_summary (2-3 sentences, past tense, third person),",
  "user_sentiment (exactly one of Positive, Neutral, Negative — describing the human, not the agent),",
  "call_successful (boolean: did the call achieve its stated goal),",
  "in_voicemail (boolean: did the agent reach an answering machine rather than a person),",
  "custom_analysis_data (object with exactly the requested extraction fields).",
  "Never invent facts that are not in the transcript. Use null for anything the transcript does not state.",
].join(" ");

function buildUserPrompt(args: {
  transcript: string;
  agentName?: string | null;
  successCriteria?: string | null;
  schema: readonly AnalysisField[];
  durationSeconds: number;
  disconnectionReason?: string | null;
}): string {
  const parts = [`Transcript:\n${args.transcript}`];
  if (args.agentName) parts.push(`Agent name: ${args.agentName}`);
  parts.push(`Call duration: ${args.durationSeconds} seconds`);
  if (args.disconnectionReason) parts.push(`How the call ended: ${args.disconnectionReason}`);
  parts.push(
    args.successCriteria
      ? `A successful call means: ${args.successCriteria}`
      : "A successful call means the agent completed the task it set out to do and the human was not left blocked.",
  );

  if (args.schema.length > 0) {
    const fields = args.schema
      .map((f) => {
        const bits = [`- ${f.name} (${f.type ?? "string"})`];
        if (f.description) bits.push(`: ${f.description}`);
        if (f.choices?.length) bits.push(` One of: ${f.choices.join(", ")}.`);
        return bits.join("");
      })
      .join("\n");
    parts.push(`Extract these fields into custom_analysis_data:\n${fields}`);
  } else {
    parts.push("Return custom_analysis_data as an empty object.");
  }

  return parts.join("\n\n");
}

/**
 * Coerce a model response into `RetellCallAnalysis`.
 *
 * The model is asked for JSON but the fields still arrive as the wrong types
 * ("true", "Positive." with a full stop, a number as a string). Downstream code
 * writes these straight into typed Postgres columns, so coercion happens here
 * rather than turning into an insert error three hops away.
 */
export function normalizeAnalysis(
  raw: string,
  schema: readonly AnalysisField[],
  voicemailHeuristic = false,
): RetellCallAnalysis {
  let parsed: Record<string, unknown> = {};
  try {
    const candidate = JSON.parse(extractJsonObject(raw)) as unknown;
    if (candidate && typeof candidate === "object") parsed = candidate as Record<string, unknown>;
  } catch {
    return heuristicAnalysis(raw.slice(0, 400), voicemailHeuristic);
  }

  const custom = (parsed.custom_analysis_data ?? {}) as Record<string, unknown>;
  return {
    call_summary: asText(parsed.call_summary),
    user_sentiment: normalizeSentiment(parsed.user_sentiment),
    call_successful: asBoolean(parsed.call_successful),
    // Trust the heuristic when it fired: it reads the call's structure, which a
    // model summarising the words alone routinely misses.
    in_voicemail: voicemailHeuristic || asBoolean(parsed.in_voicemail) === true,
    custom_analysis_data: coerceCustomData(custom, schema),
  };
}

/** Pull the outermost `{...}` out of a reply that wrapped it in prose or fences. */
function extractJsonObject(raw: string): string {
  const trimmed = raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  if (trimmed.startsWith("{")) return trimmed;
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  return start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;
}

function asText(value: unknown): string | null {
  if (typeof value !== "string") return value == null ? null : String(value);
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.toLowerCase() !== "null" ? trimmed : null;
}

function asBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lower = value.trim().toLowerCase();
    if (["true", "yes", "1"].includes(lower)) return true;
    if (["false", "no", "0"].includes(lower)) return false;
  }
  return null;
}

function normalizeSentiment(value: unknown): string {
  const text = typeof value === "string" ? value.toLowerCase() : "";
  if (text.includes("positive")) return "Positive";
  if (text.includes("negative")) return "Negative";
  return "Neutral";
}

/**
 * Keep only declared fields, cast to their declared types.
 *
 * Unrequested keys are dropped so booking and CRM mappers, which look up fields
 * by name, cannot be fed a hallucinated `appointment_date`.
 */
/** "null", "none", "n/a", "unknown" and friends — an answer that means "not found". */
export function isNullWord(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return /^(null|none|n\/a|na|nil|undefined|unknown|not (found|provided|mentioned|available|stated)|-+)\.?$/i.test(
    value.trim(),
  );
}

function coerceCustomData(
  custom: Record<string, unknown>,
  schema: readonly AnalysisField[],
): Record<string, unknown> {
  if (schema.length === 0) return {};
  const out: Record<string, unknown> = {};
  for (const field of schema) {
    if (!field.name) continue;
    const value = custom[field.name];
    // The model sometimes writes the WORD instead of JSON null — stored as-is, a field showed the
    // literal text "null" on the call as though it had been extracted.
    if (value == null || value === "" || isNullWord(value)) {
      out[field.name] = null;
      continue;
    }
    switch (field.type) {
      case "number": {
        const num =
          typeof value === "number" ? value : Number(String(value).replace(/[^0-9.-]/g, ""));
        out[field.name] = Number.isFinite(num) ? num : null;
        break;
      }
      case "boolean":
        out[field.name] = asBoolean(value);
        break;
      case "enum": {
        const text = String(value);
        const match = field.choices?.find((c) => c.toLowerCase() === text.toLowerCase());
        out[field.name] = match ?? (field.choices?.length ? null : text);
        break;
      }
      default:
        out[field.name] = typeof value === "string" ? value : JSON.stringify(value);
    }
  }
  return out;
}
