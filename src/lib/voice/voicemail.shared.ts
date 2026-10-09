/**
 * Live answering-machine handling for outbound calls.
 *
 * Retell watches the first seconds of a call and, when it hears a voicemail greeting, hangs up or
 * leaves a message. The native engine only noticed voicemail afterwards, from the transcript, so
 * the agent would talk to a recording and the call would run (and bill) as if a person had answered.
 *
 * Detection reads the caller-side transcript — a greeting is long, scripted, and says things no
 * person answering a phone says ("leave a message after the tone"). It scores phrases rather than
 * trusting any single word, so a person saying "I'm not available right now" is not mistaken for a
 * machine, and a machine that says "please leave a message" always is.
 *
 * Relative imports only — reachable from the voice gateway bundle.
 */

export type VoicemailAction = "none" | "hangup" | "leave_message";

export interface VoicemailPolicy {
  action: Exclude<VoicemailAction, "none">;
  /** Spoken after the greeting ends when `action` is `leave_message`. May contain {{variables}}. */
  message: string;
  /** Detection only runs this long after the call connects. */
  timeoutMs: number;
}

export const VOICEMAIL_TIMEOUT_DEFAULT_MS = 30_000;
export const VOICEMAIL_TIMEOUT_MIN_MS = 5_000;
export const VOICEMAIL_TIMEOUT_MAX_MS = 180_000;

function clampTimeout(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return VOICEMAIL_TIMEOUT_DEFAULT_MS;
  return Math.min(VOICEMAIL_TIMEOUT_MAX_MS, Math.max(VOICEMAIL_TIMEOUT_MIN_MS, Math.round(n)));
}

/**
 * The agent's voicemail policy, or null when live handling is off (the default — an agent that
 * never configured it behaves exactly as before).
 *
 * Builder fields win; an agent imported from Retell falls back to its own `voicemail_option`.
 */
export function resolveVoicemailPolicy(
  settings: Record<string, unknown> | null | undefined,
): VoicemailPolicy | null {
  const s = settings ?? {};
  const raw = (s.rawAgent ?? {}) as Record<string, unknown>;

  const action = String(s.voicemailAction ?? "").trim();
  if (action === "hangup") {
    return { action: "hangup", message: "", timeoutMs: clampTimeout(s.voicemailDetectionTimeoutMs) };
  }
  if (action === "leave_message") {
    const message = String(s.voicemailMessage ?? "").trim();
    if (!message) return null;
    return { action: "leave_message", message, timeoutMs: clampTimeout(s.voicemailDetectionTimeoutMs) };
  }
  if (action === "none") return null;

  // Imported from Retell: { action: { type: "hangup" | "static_text", text } }.
  const option = raw.voicemail_option as { action?: { type?: string; text?: string } } | null | undefined;
  const type = option?.action?.type;
  const timeoutMs = clampTimeout(s.voicemailDetectionTimeoutMs ?? raw.voicemail_detection_timeout_ms);
  if (type === "hangup") return { action: "hangup", message: "", timeoutMs };
  if (type === "static_text" && option?.action?.text?.trim()) {
    return { action: "leave_message", message: option.action.text.trim(), timeoutMs };
  }
  return null;
}

// ── Detection ─────────────────────────────────────────────────────────────────

interface Cue {
  re: RegExp;
  points: number;
  label: string;
}

/** Phrases only a recording says. One is enough on its own. */
const STRONG: Cue[] = [
  { re: /\bleave (?:a|your|us|me|the)?\s*(?:short |brief |detailed )?(?:message|voice ?mail)\b/i, points: 3, label: "leave a message" },
  { re: /\b(?:after|at) the (?:tone|beep|signal)\b/i, points: 3, label: "after the tone" },
  { re: /\brecord your (?:message|name)\b/i, points: 3, label: "record your message" },
  { re: /\bvoice ?mail (?:of|for|box|service|system|message)\b/i, points: 3, label: "voicemail of" },
  { re: /\bvoice ?mail\b/i, points: 2, label: "voicemail" },
  { re: /\bmail ?box (?:is full|has not been set up|is not set up|you have (?:reached|dialed|called))\b/i, points: 3, label: "mailbox" },
  { re: /\bthe (?:person|party|number|subscriber|customer) (?:you(?:'| a)?re|you are|you have|you.ve) (?:trying to reach|calling|dialled|dialed|called)\b/i, points: 3, label: "number you have called" },
  { re: /\b(?:is|are) (?:currently |presently |temporarily )?(?:not available|unavailable|not reachable|switched off|out of (?:the )?(?:service|coverage))\b/i, points: 2, label: "unavailable" },
  { re: /\bpress (?:1|one|pound|hash|star|the pound key|the star key)\b/i, points: 2, label: "press a key" },
  { re: /\bwhen (?:you(?:'| a)?re|you are) (?:finished|done)\b/i, points: 2, label: "when finished" },
];

/** Phrases a person could say too — two are needed. */
const WEAK: Cue[] = [
  { re: /\b(?:you(?:'| ha)?ve|you have) reached\b/i, points: 1, label: "you have reached" },
  { re: /\bnot (?:available|able to (?:come|take|answer))\b/i, points: 1, label: "not available" },
  { re: /\b(?:can(?:'|no)?t|cannot|unable to) (?:take|answer|come to) (?:your|the) (?:call|phone)\b/i, points: 1, label: "can't take your call" },
  { re: /\b(?:sorry|apologi[sz]e).{0,25}\b(?:missed|miss) your call\b/i, points: 2, label: "missed your call" },
  { re: /\bplease leave\b/i, points: 1, label: "please leave" },
  { re: /\b(?:get|call) (?:back to you|you back)\b/i, points: 1, label: "get back to you" },
  { re: /\baway from (?:the|my|our) (?:phone|desk)\b/i, points: 1, label: "away from phone" },
  { re: /\b(?:your|the) call (?:is|has been) (?:forwarded|being forwarded|transferred)\b/i, points: 2, label: "call forwarded" },
];

export interface VoicemailVerdict {
  score: number;
  cues: string[];
}

/**
 * Whether this caller-side text is an answering machine's greeting.
 *
 * Needs a strong cue, or two weaker ones, and a few words of context — a lone "voicemail" from
 * a person ("I'll check my voicemail") is too short to count.
 */
export function detectVoicemailGreeting(text: string): VoicemailVerdict | null {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.split(" ").length < 4) return null;
  let score = 0;
  let strong = false;
  const cues: string[] = [];
  for (const cue of STRONG) {
    if (cue.re.test(t)) {
      score += cue.points;
      cues.push(cue.label);
      if (cue.points >= 3) strong = true;
    }
  }
  for (const cue of WEAK) {
    if (cue.re.test(t)) {
      score += cue.points;
      cues.push(cue.label);
    }
  }
  if (strong || score >= 3) return { score, cues };
  return null;
}
