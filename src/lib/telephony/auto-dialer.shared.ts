/**
 * Auto Dialer — shared, environment-free logic.
 *
 * Dials a list of real numbers one at a time. When a target answers, it rings
 * two real people's phones simultaneously and bridges the call to whichever
 * picks up first — Twilio's native `<Dial>` behaviour with multiple `<Number>`
 * nouns, so no custom conference orchestration is needed.
 */

export type DialerSessionStatus = "draft" | "running" | "paused" | "completed" | "cancelled";

export type DialerTargetStatus =
  | "pending"
  | "dialing"
  | "ringing"
  | "bridged"
  | "no_answer"
  | "busy"
  | "failed"
  | "completed";

/** A target's call is still in flight — the queue must not advance past it yet. */
export const IN_FLIGHT_TARGET_STATUSES: DialerTargetStatus[] = ["dialing", "ringing"];

/** Terminal states — the target's call has finished, one way or another. */
export const TERMINAL_TARGET_STATUSES: DialerTargetStatus[] = [
  "bridged",
  "no_answer",
  "busy",
  "failed",
  "completed",
];

export function isTerminalTargetStatus(status: string): boolean {
  return (TERMINAL_TARGET_STATUSES as string[]).includes(status);
}

/**
 * E.164 validation for real PSTN dialling.
 *
 * Stricter than the WhatsApp phone helpers deliberately: a malformed number
 * here doesn't fail to send a message, it places a real call (and a real
 * person's phone rings), so a number that doesn't parse cleanly is rejected
 * rather than guessed at.
 */
const E164_RE = /^\+[1-9]\d{7,14}$/;

export function isValidE164(phone: string | null | undefined): boolean {
  return E164_RE.test(String(phone ?? "").trim());
}

/**
 * Best-effort E.164 normalisation for numbers pasted without a leading "+".
 * Mirrors `normalizeLeadPhone`'s country-code heuristics but returns "" (never
 * a guess) when the result still isn't a valid E.164 number — the caller list
 * form surfaces that as a per-row error rather than silently dropping digits.
 */
export function toE164(raw: string | null | undefined): string {
  let s = String(raw ?? "").trim();
  if (!s) return "";
  s = s.replace(/[\s.\-()]/g, "");
  if (/[a-zA-Z]/.test(s)) return "";
  const digits = s.replace(/\D/g, "");
  if (digits.length < 8) return "";
  if (s.startsWith("00")) s = "+" + s.slice(2);
  else if (!s.startsWith("+")) s = "+" + digits;
  return isValidE164(s) ? s : "";
}

export interface DialerTargetInput {
  name?: string | null;
  phone: string;
}

export interface ParsedDialerTarget {
  name: string | null;
  phone: string;
}

export interface DialerTargetParseError {
  line: number;
  raw: string;
  reason: string;
}

/**
 * Parse the pasted-in call list: one target per line, "Name, +9715..." or just
 * a bare number. Invalid lines are reported rather than skipped silently —
 * this is a real dial list, and a dropped row is a person who never gets
 * called with no indication why.
 */
export function parseDialerTargetList(raw: string): {
  targets: ParsedDialerTarget[];
  errors: DialerTargetParseError[];
} {
  const targets: ParsedDialerTarget[] = [];
  const errors: DialerTargetParseError[] = [];
  const lines = raw.split(/\r?\n/);

  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let name: string | null = null;
    let phonePart = trimmed;
    const commaIdx = trimmed.lastIndexOf(",");
    if (commaIdx > -1) {
      name = trimmed.slice(0, commaIdx).trim() || null;
      phonePart = trimmed.slice(commaIdx + 1).trim();
    }

    const phone = toE164(phonePart);
    if (!phone) {
      errors.push({ line: i + 1, raw: trimmed, reason: "Not a valid phone number" });
      return;
    }
    targets.push({ name, phone });
  });

  return { targets, errors };
}

/** De-duplicate a target list by phone, keeping the first occurrence's name. */
export function dedupeDialerTargets(targets: ParsedDialerTarget[]): ParsedDialerTarget[] {
  const seen = new Set<string>();
  const out: ParsedDialerTarget[] = [];
  for (const t of targets) {
    if (seen.has(t.phone)) continue;
    seen.add(t.phone);
    out.push(t);
  }
  return out;
}

export interface RouteNumbersValidation {
  ok: boolean;
  error: string | null;
}

/**
 * One or two route numbers, both valid E.164, and — when there are two —
 * not the same number twice.
 *
 * One number is a plain 1-to-1 bridge: the target answers, that one phone
 * rings, done. Two numbers is the simul-ring case (`buildSimulRingTwiml`) —
 * both ring at once and whichever answers first is connected. Anything
 * beyond two isn't supported: Twilio's own `<Dial>` behaviour for more than
 * two `<Number>` nouns is the same simul-ring race, so there's no case this
 * feature exists for that a third number would serve better than either of
 * the two shapes above.
 */
export function validateRouteNumbers(numbers: string[]): RouteNumbersValidation {
  if (numbers.length < 1 || numbers.length > 2) {
    return { ok: false, error: "Add 1 or 2 numbers to route answered calls to." };
  }
  for (const n of numbers) {
    if (!isValidE164(n)) {
      return { ok: false, error: `"${n}" isn't a valid phone number — include the country code.` };
    }
  }
  if (numbers.length === 2 && numbers[0] === numbers[1]) {
    return { ok: false, error: "The 2 route numbers must be different." };
  }
  return { ok: true, error: null };
}

/**
 * TwiML executed when the dialled target answers: ring the route number(s),
 * bridge to whichever answers first. With a single number this is a plain
 * 1-to-1 bridge; with two, Twilio rings both simultaneously — its native
 * behaviour for multiple `<Number>` nouns inside one `<Dial>`. Each `<Number>`
 * carries its own `answered` callback so a two-number run can report which of
 * the two people actually took the call — `<Dial>`'s own action callback only
 * reports that *someone* did.
 */
export function buildSimulRingTwiml(params: {
  routeNumbers: string[];
  timeoutSecs: number;
  actionUrl: string;
  legAnsweredUrls: string[];
  callerId: string;
}): string {
  const { routeNumbers, timeoutSecs, actionUrl, legAnsweredUrls, callerId } = params;
  const numbers = routeNumbers
    .map(
      (n, i) =>
        `    <Number statusCallbackEvent="answered" statusCallback="${escapeXml(legAnsweredUrls[i] ?? actionUrl)}" statusCallbackMethod="POST">${escapeXml(n)}</Number>`,
    )
    .join("\n");
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<Response>\n` +
    `  <Dial timeout="${Math.max(5, Math.min(60, timeoutSecs))}" callerId="${escapeXml(callerId)}" action="${escapeXml(actionUrl)}" method="POST">\n` +
    `${numbers}\n` +
    `  </Dial>\n` +
    `</Response>`
  );
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Map Twilio's <Dial> action-callback `DialCallStatus` to our target status. */
export function mapDialResultStatus(dialCallStatus: string): DialerTargetStatus {
  const map: Record<string, DialerTargetStatus> = {
    completed: "bridged", // Dial connected to one of the 2 numbers and the call happened
    "no-answer": "no_answer",
    busy: "busy",
    failed: "failed",
    canceled: "failed",
  };
  return map[dialCallStatus] ?? "failed";
}

/** Map the outer call's own status callback (before it ever reaches <Dial>) to our target status. */
export function mapLeadCallStatus(twilioStatus: string): DialerTargetStatus | null {
  // "completed" here is ambiguous — it fires whether or not <Dial> ran, and when
  // it did run the Dial-result callback already reported the real outcome. The
  // caller de-duplicates via `advanced_at`; this mapping only supplies the
  // terminal states that mean the target's call never reached <Dial> at all.
  const map: Record<string, DialerTargetStatus | null> = {
    queued: null,
    initiated: null,
    ringing: "ringing",
    "in-progress": null, // now inside <Dial>; the action callback owns the outcome
    "no-answer": "no_answer",
    busy: "busy",
    failed: "failed",
    canceled: "failed",
    completed: "completed",
  };
  return map[twilioStatus] ?? null;
}

export function statusLabel(status: DialerTargetStatus): string {
  const map: Record<DialerTargetStatus, string> = {
    pending: "Waiting",
    dialing: "Dialling…",
    ringing: "Ringing…",
    bridged: "Connected",
    no_answer: "No answer",
    busy: "Busy",
    failed: "Failed",
    completed: "Done",
  };
  return map[status] ?? status;
}
