/**
 * Standard call outcome — one field every agent reports after every call.
 *
 * Today each client's CRM rules guess the outcome from sentiment and summary wording (WBAH's
 * status rules, the WeeBespoke decline regexes), which is where most of the audit findings came
 * from. A single outcome chosen by the post-call model from a fixed list gives the outcome-rules
 * table one thing to act on, the same for every client and agent. Categories follow WBAH's
 * reason-code sheet (stop contacting, not interested, threat/complaint, profanity, wants a human,
 * wrong number, bereavement/vulnerability …).
 *
 * No imports: reachable from the separately bundled voice gateway.
 */

export const CALL_OUTCOME_FIELD_NAME = "call_outcome";

export const CALL_OUTCOMES = [
  "booked",
  "callback_requested",
  "not_interested",
  "do_not_contact",
  "wrong_number",
  "wants_human",
  "abusive",
  "vulnerable",
  "no_conversation",
  "other",
] as const;

export type CallOutcome = (typeof CALL_OUTCOMES)[number];

/** Highest first: when a call fits several, the earliest in this list is the outcome. */
const OUTCOME_GUIDE: Record<CallOutcome, string> = {
  vulnerable:
    "the caller mentioned a bereavement, serious illness, hospital, dementia, confusion, distress or that they cannot cope",
  do_not_contact:
    "the caller asked not to be called or contacted again, to be removed from the list or have their details deleted, said they are on the TPS, or threatened a complaint, legal action, Ofcom or trading standards",
  wrong_number:
    "the person is not the lead, says it is the wrong number, does not own the property, or never made an enquiry",
  booked: "an appointment or consultation was booked and confirmed on the call",
  callback_requested:
    "the caller asked to be called back later, was busy, at work or driving, or the line was too poor to continue",
  not_interested:
    "the caller clearly said they are not interested, changed their mind, already sold, or do not want to go ahead",
  wants_human: "the caller asked for a real person and the call ended without a booking",
  abusive: "the caller swore at or insulted the agent and nothing above applies",
  no_conversation: "voicemail, silence, or the call ended before any real conversation",
  other: "none of the above",
};

/** Description the post-call model reads; lists the values in priority order. */
export const CALL_OUTCOME_DESCRIPTION =
  "The single outcome of this call. Pick the FIRST value in this order that applies: " +
  (Object.entries(OUTCOME_GUIDE) as Array<[CallOutcome, string]>)
    .map(([value, when]) => `${value} — ${when}`)
    .join("; ") +
  ".";

/** Choices in priority order (the order the description lists them). */
const CHOICES_IN_PRIORITY = Object.keys(OUTCOME_GUIDE) as CallOutcome[];

export type StandardAnalysisField = {
  name: string;
  description: string;
  type: "enum";
  choices: string[];
};

export function standardCallOutcomeField(): StandardAnalysisField {
  return {
    name: CALL_OUTCOME_FIELD_NAME,
    description: CALL_OUTCOME_DESCRIPTION,
    type: "enum",
    choices: [...CHOICES_IN_PRIORITY],
  };
}

/**
 * Append the standard field to a post-call schema. An agent that already defines
 * `call_outcome` keeps its own definition.
 */
export function withStandardCallOutcome<T extends { name?: unknown }>(
  fields: readonly T[],
): Array<T | StandardAnalysisField> {
  const has = fields.some(
    (f) => String(f?.name ?? "").trim().toLowerCase() === CALL_OUTCOME_FIELD_NAME,
  );
  return has ? [...fields] : [...fields, standardCallOutcomeField()];
}

/** A model's answer → one of the standard outcomes, or null when it is not one. */
export function normalizeCallOutcome(value: unknown): CallOutcome | null {
  const v = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (!v) return null;
  if ((CALL_OUTCOMES as readonly string[]).includes(v)) return v as CallOutcome;
  const aliases: Record<string, CallOutcome> = {
    callback: "callback_requested",
    call_back: "callback_requested",
    dnc: "do_not_contact",
    remove: "do_not_contact",
    no_answer: "no_conversation",
    voicemail: "no_conversation",
    human: "wants_human",
  };
  return aliases[v] ?? null;
}
