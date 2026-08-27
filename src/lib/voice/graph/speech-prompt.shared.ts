/**
 * Spoken-turn prompt helpers — keep the speech LLM tiny and skip it when the
 * node already has words to say (Retell static-sentence path).
 *
 * Generic builder nodes often store a task ("Ask the preferred title") rather
 * than a script. Those must never be read aloud.
 */

export function referencedTemplateVars(text: string): string[] {
  const names = new Set<string>();
  const re = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) names.add(match[1]!);
  return [...names];
}

const TASK_PREFIX =
  /^(?:please\s+|now\s+|then\s+|next\s+)?(?:the agent (?:should|must|will|needs to)\s+)?(?:i (?:need to|will|should|am going to)\s+)?(?:let me\s+)?(ask|find out|confirm|collect|get (?:their|the|his|her|your)|determine|check (?:if|whether)|request|inquire|prompt the|obtain|capture|elicit|make sure|figure out|establish|gather|record|take down)\b/i;

/** First line is an instruction to the model, not words for the caller. */
export function looksLikeAgentTask(text: string): boolean {
  const first = text.trim().split(/\n/)[0]?.trim() ?? "";
  return TASK_PREFIX.test(first);
}

/** Script lines are already the words to speak — no LLM needed. */
export function looksLikeSpokenLine(script: string): boolean {
  const t = script.trim();
  if (!t || looksLikeAgentTask(t)) return false;
  const first = t.split(/\n/)[0]?.trim() ?? "";
  if (/[?]/.test(t)) return true;
  if (
    /^(hi|hello|hey|thanks|thank you|great|okay|ok|perfect|can i|could i|i |we |it's |it is |i've |i have )/i.test(
      first,
    )
  ) {
    return true;
  }
  return t.length <= 180 && t.split(/\s+/).length <= 45;
}

function asYourNoun(thing: string): string {
  return thing
    .replace(/^(the|their|his|her|a|an|your)\s+/i, "")
    .replace(/\btheir\b/gi, "your")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Turn a generic node task into a short spoken question so TTS never reads
 * "Ask the preferred title" if the speech model echoes the instruction.
 */
export function spokenQuestionFromTask(task: string): string {
  const first = task.trim().split(/\n/)[0]?.trim() ?? "";
  if (!first) return "";
  let t = first.replace(/[.]+$/, "").trim();
  t = t.replace(/^(please\s+|now\s+|then\s+|next\s+)/i, "");
  t = t.replace(/^(the agent (?:should|must|will|needs to)\s+)/i, "");
  t = t.replace(/^(i (?:need to|will|should|am going to)\s+|let me\s+)/i, "");

  const askIfTheyAre = t.match(/^ask(?:\s+the\s+caller)?\s+if\s+they\s+(?:are|'re)\s+(.+)$/i);
  if (askIfTheyAre) return `Are you ${asYourNoun(askIfTheyAre[1]!)}?`;

  const askIfThey = t.match(/^ask(?:\s+the\s+caller)?\s+if\s+they\s+(.+)$/i);
  if (askIfThey) return `Do you ${askIfThey[1]!.trim()}?`;

  const askWhat = t.match(/^ask\s+what\s+(.+)$/i);
  if (askWhat) {
    let rest = askWhat[1]!.trim();
    rest = rest.replace(/\s+it is$/i, " is it");
    rest = rest.replace(/\s+they are$/i, " you are");
    return `What ${rest}?`;
  }

  const askCallerTo = t.match(/^ask(?:\s+the)?(?:\s+caller)?\s+to\s+(.+)$/i);
  if (askCallerTo) {
    const rest = askCallerTo[1]!.trim();
    if (/^(confirm|verify|repeat)\b/i.test(rest)) return `Can I ${rest}?`;
    return `Could you ${rest}?`;
  }

  const gather = t.match(
    /^(?:ask(?:\s+the\s+caller)?|find out|collect|get|obtain|capture|request|inquire about|elicit|determine|establish|gather|record|take down)\s+(?:for\s+)?(.+)$/i,
  );
  if (gather) {
    return `What's your ${asYourNoun(gather[1]!)}?`;
  }

  const confirm = t.match(/^confirm\s+(.+)$/i);
  if (confirm) return `Can I confirm ${asYourNoun(confirm[1]!)}?`;

  return "";
}

export interface PromptParts {
  script: string;
  directions: string[];
  task: string;
}

/** Split node prompt text into spoken script, builder notes, and agent tasks. */
export function splitPromptParts(
  raw: string,
  isDirection: (line: string) => boolean,
): PromptParts {
  const directions: string[] = [];
  const body: string[] = [];
  for (const line of raw
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)) {
    if (isDirection(line) || /\bdo not ask any other questions\b/i.test(line)) {
      directions.push(line);
    } else {
      body.push(line);
    }
  }
  const bodyText = body.join("\n");
  if (looksLikeAgentTask(bodyText)) {
    return { script: "", directions, task: bodyText };
  }
  return { script: bodyText, directions, task: "" };
}

export function spokenFallback(parts: PromptParts): string {
  const fromScript = parts.script
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join(" ")
    .trim();
  if (fromScript && !looksLikeAgentTask(fromScript)) return fromScript;
  return spokenQuestionFromTask(parts.task || fromScript);
}

/** CRM fields this turn actually reads via {{var}} — omit the rest. */
export function leadFieldsForTurn(
  raw: string,
  variables: Record<string, unknown>,
): Array<[string, string]> {
  const needed = referencedTemplateVars(raw);
  if (needed.length === 0) return [];
  const out: Array<[string, string]> = [];
  for (const name of needed) {
    const value = variables[name];
    if (value === null || value === undefined || value === "") continue;
    out.push([name, String(value)]);
  }
  return out;
}
