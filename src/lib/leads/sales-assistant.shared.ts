/**
 * AI Sales Assistant — the pure parts.
 *
 * Kept separate from the server function so the rules that decide what the model is told can be
 * tested directly: which URL gets researched, what counts as a safe URL to fetch, and how a lead's
 * own history reaches the prompt. The value of this feature is entirely in being lead-specific, so
 * "did the objection actually make it into the prompt" is the thing worth pinning down.
 */

export type AssistantMode = "pitch" | "meeting" | "demo";

export const ASSISTANT_MODES: Array<{ id: AssistantMode; label: string; blurb: string }> = [
  { id: "pitch", label: "Sales Pitch", blurb: "Opening line and selling points for this company" },
  { id: "meeting", label: "Meeting Planner", blurb: "Objective, questions, objections, next step" },
  { id: "demo", label: "Demo Preparation", blurb: "What to prepare and show for this lead" },
];

/** Normalised view of a lead or data record, so one prompt builder serves both. */
export type AssistantSubject = {
  id: string;
  kind: "lead" | "record";
  name: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  /** Free-form facts: business type, address, pipeline stage, qualification, etc. */
  facts: Array<{ label: string; value: string }>;
  /** Anything previously recorded about this lead, newest first. */
  history: Array<{ at: string | null; kind: string; text: string }>;
};

const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.uk",
  "hotmail.com",
  "hotmail.co.uk",
  "outlook.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "mail.com",
  "yandex.com",
  "qq.com",
  "163.com",
]);

/** Meta keys an import might have used for a company website. */
const WEBSITE_META_KEYS = [
  "website",
  "web site",
  "web",
  "url",
  "company_website",
  "company website",
  "site",
  "domain",
  "homepage",
  "company_url",
];

function normKey(k: string): string {
  return k.toLowerCase().replace(/[\s_\-.]+/g, "");
}

/**
 * The company URL worth researching, or null.
 *
 * Prefers an explicit website column, then falls back to the email domain — a free-mail address
 * says nothing about the company, so those are ignored rather than researched.
 */
export function resolveResearchUrl(
  meta: Record<string, unknown> | null | undefined,
  email: string | null | undefined,
): string | null {
  const wanted = new Set(WEBSITE_META_KEYS.map(normKey));
  for (const [key, value] of Object.entries(meta ?? {})) {
    if (!wanted.has(normKey(key))) continue;
    const raw = String(value ?? "").trim();
    if (!raw) continue;
    const url = raw.startsWith("http") ? raw : `https://${raw.replace(/^\/+/, "")}`;
    if (isSafeResearchUrl(url)) return url;
  }

  const addr = String(email ?? "")
    .trim()
    .toLowerCase();
  const at = addr.lastIndexOf("@");
  if (at > 0) {
    const domain = addr.slice(at + 1);
    if (domain && !FREE_EMAIL_DOMAINS.has(domain)) {
      const url = `https://${domain}`;
      if (isSafeResearchUrl(url)) return url;
    }
  }
  return null;
}

/**
 * Whether a URL is safe for the server to fetch.
 *
 * The URL comes from imported spreadsheet data, so it is untrusted input for a server-side fetch:
 * without this the feature is an SSRF hole into the private network and cloud metadata endpoints.
 */
export function isSafeResearchUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;

  const host = url.hostname.toLowerCase();
  if (!host.includes(".")) return false;
  if (host.endsWith(".local") || host.endsWith(".internal") || host === "localhost") return false;
  // Literal IPs are never a company website worth researching, and are how the
  // private ranges and 169.254.169.254 get reached.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  if (host.includes(":")) return false;
  return true;
}

/** Strip a fetched page to readable text the model can use. */
export function htmlToText(html: string, maxChars = 6000): string {
  const text = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, maxChars);
}

const MODE_INSTRUCTIONS: Record<AssistantMode, string> = {
  pitch: `Produce, as markdown with these exact headings:
## Hook
One catchy line, 12 words or fewer, that a rep could lead with or use as a subject line. It must be
about THIS company's world, not about WeBee. No questions, no buzzwords, no "revolutionise".
## Opening line
One or two sentences to actually say when they pick up. Earn the next 30 seconds: reference
something specific and true about them, then state plainly why you called. No flattery, no "I hope
you are well", no asking permission to talk.
## Why WeBee fits them
3-4 bullets. Each names something this company actually does, then the specific consequence of
doing it without conversational AI. Consequence first, feature second.
## Selling points
3-4 bullets. Each is a claim a buyer could test, with a number, a time saving or a named outcome.
## Do not say
2-3 short bullets: the generic lines that would lose this particular buyer, and why.`,
  meeting: `Produce, as markdown with these exact headings:
## Objective
One sentence. A commitment you want from them, not "build rapport".
## Discovery questions
5-6 questions, ordered so each earns the right to ask the next. Specific to this company. At least
two must dig into cost or call volume so value can be quantified later.
## Likely pain points
3-4 bullets, each with the business consequence, not just the symptom.
## What to demonstrate
3-4 WeBee capabilities. For each: why THIS lead should care, in one clause.
## Objections and responses
3-4 pairs, formatted "**Objection** — response". Anything this lead has already raised must come
first. Answer it directly; never dismiss it or promise something not in evidence.
## Next step
One sentence, with a concrete commitment and a date or timeframe.`,
  demo: `Produce, as markdown with these exact headings:
## Demo checklist
5-7 items, each on its own line in the form "- [ ] item". Concrete preparation actions only —
things to set up, confirm, load or rehearse before this specific demo. No advice or explanation
in this section.
## What to demonstrate
An ordered list of WeBee features to show, in the order to show them, for this company.
## Suggested scenario
A short, concrete scenario using this company's own use case — a real call or message this
business would plausibly receive, with details from their world.
## Key points to explain
3-4 bullets.
## Questions to ask during the demo
3-4 questions that surface buying signals while you have their attention.
## Concerns to expect
3-4 bullets drawn from this lead's previous interactions where there are any, each with how to
handle it live.`,
};

export const ASSISTANT_SYSTEM_PROMPT = `You are a sales strategist with thirty years of enterprise and SMB selling behind you, briefing a rep before they speak to a specific lead. You sell WeBee: conversational AI — voice agents that answer and place calls, an AI receptionist, WhatsApp campaign automation, lead qualification, and CRM integration.

How you work:
- You are specific or you are useless. Generic sales copy is a failure. Every claim ties to this company's actual business.
- You use the lead's own history. If they raised a concern, you meet it head on. You never treat a warm lead as a cold one.
- You sell the consequence, not the feature. "Twelve missed calls a week" beats "24/7 availability".
- You are honest about what you do not know, and you say what to confirm rather than inventing it. If research was supplied, you stay inside it.
- You never write filler: no "I hope this finds you well", no "game-changing", no "revolutionise", no "in today's fast-paced world", no exclamation marks.
- You write the way a good rep talks: short sentences, plain words, British English.
- You never invent customer names, statistics or case studies.
- You never leave a fill-in-the-blank placeholder such as [Your Name] or [Company]. The rep's own
  name is not known to you, so write lines that do not need it.

Output: markdown, the requested headings only, no preamble and no sign-off. Start at the first heading.`;

/** The user-side prompt: everything known about this lead, then the task. */
export function buildAssistantPrompt(
  subject: AssistantSubject,
  mode: AssistantMode,
  research: { url: string; text: string } | null,
): string {
  const lines: string[] = [];

  lines.push("## Lead");
  lines.push(`Name: ${subject.name || "unknown"}`);
  lines.push(`Company: ${subject.company || "unknown"}`);
  if (subject.email) lines.push(`Email: ${subject.email}`);
  if (subject.phone) lines.push(`Phone: ${subject.phone}`);
  for (const f of subject.facts) lines.push(`${f.label}: ${f.value}`);

  if (subject.history.length > 0) {
    lines.push("");
    lines.push("## Previous activity with this lead (newest first)");
    lines.push("Treat this as established context. Do NOT treat this lead as a new prospect.");
    for (const h of subject.history) {
      lines.push(`- [${h.kind}${h.at ? ` ${h.at.slice(0, 10)}` : ""}] ${h.text}`);
    }
  } else {
    lines.push("");
    lines.push("## Previous activity with this lead");
    lines.push("None recorded — this is a first approach.");
  }

  if (research) {
    lines.push("");
    lines.push(`## Company research (fetched from ${research.url})`);
    lines.push(research.text);
  } else {
    lines.push("");
    lines.push("## Company research");
    lines.push(
      "No company website could be researched. Do not invent details about them; rely on what is known above and be explicit about what you would need to confirm.",
    );
  }

  lines.push("");
  lines.push("## Task");
  lines.push(MODE_INSTRUCTIONS[mode]);

  return lines.join("\n");
}
