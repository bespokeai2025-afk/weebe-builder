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

export function looksLikeInstructionLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  return (
    /^(be |do not |don't |never |always |make sure|if the |when the |only |avoid |keep |stay |if variables|note:|n\.b\.|instruction:|step \d|extract |call |wait for |proceed |never |required |optional )/i.test(
      t,
    ) ||
    /\b(do not ask|don't read|if variables|extract the|required arguments|transition|when they say)\b/i.test(
      t,
    )
  );
}

/** Script lines are already the words to speak — no LLM needed. */
export function looksLikeSpokenLine(script: string): boolean {
  const t = script.trim();
  if (!t || looksLikeAgentTask(t) || looksLikeBuilderPrompt(t)) return false;
  const spoken = spokenLinesOnly(t);
  if (spoken.length === 0) return false;
  const compact = spoken.join(" ");
  if (compact.length > 180 || compact.split(/\s+/).length > 40) return false;
  const first = spoken[0] ?? "";
  if (/[?]/.test(first)) return true;
  if (
    /^(hi|hello|hey|thanks|thank you|great|okay|ok|perfect|can i|could i|i |we |it's |it is |i've |i have )/i.test(
      first,
    )
  ) {
    return true;
  }
  return spoken.length === 1 && compact.length <= 140;
}

function asYourNoun(thing: string): string {
  return thing
    .replace(/^(the|their|there|his|her|a|an|your)\s+/i, "")
    .replace(/\b(their|there)\b/gi, "your")
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
    /^(?:ask(?:\s+the\s+caller)?|find out|collect|get|obtain|capture|request|inquire about|elicit|determine|establish|gather|record|take down)\s+(?:for\s+)?(?:the\s+caller(?:'s)?\s+|their\s+|there\s+|the\s+)?(.+)$/i,
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

/** Builder asked for a performed line, not a verbatim collect question. */
export function wantsSpokenFlavor(text: string): boolean {
  return /\b(funny|quirky|humou?r|inviting|playful|witty)\b/i.test(text);
}

/**
 * Script is already the words to speak (a short question or greeting), not a
 * leftover fragment or a multi-line pitch that still needs the speech model.
 */
export function isVerbatimSpeakable(script: string): boolean {
  const t = script.trim();
  if (!t || looksLikeAgentTask(t) || looksLikeBuilderPrompt(t)) return false;
  const lines = spokenLinesOnly(t);
  if (lines.length === 0) return false;
  const compact = lines.join(" ");
  if (compact.length > 180 || lines.length > 2) return false;
  const first = lines[0] ?? "";
  if (/[?]/.test(first) && lines.length === 1) return true;
  if (lines.length <= 2 && compact.length <= 140 && /[?]/.test(compact)) return true;
  return (
    lines.length === 1 &&
    /^(hi|hello|hey|thanks|thank you|great|okay|ok|perfect|can i|could i|i |we |it's |it is |i've |i have )/i.test(
      first,
    )
  );
}

/** Markdown / multi-section builder prompts must never be read aloud. */
export function looksLikeBuilderPrompt(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/^##\s/.test(t) || /\n##\s/.test(t)) return true;
  if (/^#\s/.test(t)) return true;
  if (/\b(what to do|required fields|when to engage)\b/i.test(t) && t.length > 80) return true;
  const lines = t.split(/\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length >= 3 && lines.filter(looksLikeInstructionLine).length >= 1) return true;
  if (t.length > 220 && /\b(if the (?:user|caller)|extract |do not |never |step \d)\b/i.test(t)) {
    return true;
  }
  return false;
}

function spokenLinesOnly(script: string): string[] {
  return script
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => l && !looksLikeInstructionLine(l) && !looksLikeAgentTask(l));
}

/** Spoken lines only — never builder directions or extract/step instructions. */
export function spokenScriptOnly(text: string): string {
  return spokenLinesOnly(text)
    .map(stripInlineInstructions)
    .filter(Boolean)
    .join(" ")
    .trim();
}

export type SpeechMode = "static" | "template" | "llm";

export interface SpeechPlan {
  mode: SpeechMode;
  script: string;
}

/** Same-line builder notes: "…as quick as possible only ask for first name". */
export function stripInlineInstructions(text: string): string {
  return text
    .replace(
      /\s+(only ask|do not ask|don't ask|never ask|make sure(?: to)?|do not\b|don't\b|never\b|always\b|extract\b|if the (?:user|caller))\b[\s\S]*$/i,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
}

export function polishSpokenLine(text: string): string {
  let t = stripInlineInstructions(text);
  if (!t) return "";
  t = t.replace(/\bi\b/g, "I");
  t = t.charAt(0).toUpperCase() + t.slice(1);
  if (
    !/[.!?]$/.test(t) &&
    /^(can i|could i|could you|would you|will you|may i|do you|does |did you|is it|are you|what|where|when|who|why|how)\b/i.test(
      t,
    )
  ) {
    t += "?";
  }
  return t;
}

/**
 * Retell-style speech plan: static / template skip the LLM; prompt does not.
 * A spoken sentence plus an "only ask…" note is a template, not a prompt.
 */
export function resolveSpeechPlan(
  raw: string,
  declaredType?: "prompt" | "static_text" | "template",
): SpeechPlan {
  const t = raw.trim();
  if (!t || /^NO_RESPONSE_NEEDED$/i.test(t) || wantsSpokenFlavor(t)) {
    return { mode: "llm", script: "" };
  }
  const parts = splitPromptParts(t, looksLikeInstructionLine);
  const script = polishSpokenLine(spokenScriptOnly(parts.script || ""));
  const hasVars = /\{\{[^{}]+\}\}/.test(t) || /\{\{[^{}]+\}\}/.test(parts.script);
  if (declaredType === "static_text" || declaredType === "template") {
    if (script) return { mode: hasVars || declaredType === "template" ? "template" : "static", script };
    return { mode: "llm", script: "" };
  }
  if (script && isVerbatimSpeakable(parts.script) && !looksLikeBuilderPrompt(t)) {
    return { mode: hasVars ? "template" : "static", script };
  }
  return { mode: "llm", script };
}

/**
 * Words we can send to TTS without waiting on the speech LLM.
 * Returns null when the node still needs generated flavour or an open why/how.
 */
export function instantSpeechText(
  raw: string,
  isDirection: (line: string) => boolean = () => false,
): string | null {
  const t = raw.trim();
  if (!t || /^NO_RESPONSE_NEEDED$/i.test(t)) return null;
  if (wantsSpokenFlavor(t)) return null;
  const planned = resolveSpeechPlan(t);
  if ((planned.mode === "static" || planned.mode === "template") && planned.script) {
    return planned.script;
  }
  const parts = splitPromptParts(t, isDirection);
  if (isVerbatimSpeakable(parts.script)) {
    const polished = polishSpokenLine(spokenLinesOnly(parts.script).join(" "));
    return polished || null;
  }
  if (parts.task) {
    if (/\b(ask|find out|gather|collect|determine)\b[\s\S]{0,80}\b(why|how|when|who)\b/i.test(parts.task)) {
      return null;
    }
    const q = spokenQuestionFromTask(parts.task);
    if (q && q !== parts.task.trim()) return q;
  }
  return null;
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
