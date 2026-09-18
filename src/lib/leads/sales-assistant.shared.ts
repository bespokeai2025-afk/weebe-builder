/**
 * AI Sales Assistant — the pure parts.
 *
 * Kept separate from the server function so the rules that decide what the model is told can be
 * tested directly: which URL gets researched, what counts as a safe URL to fetch, and how a lead's
 * own history reaches the prompt. The value of this feature is entirely in being lead-specific, so
 * "did the objection actually make it into the prompt" is the thing worth pinning down.
 */

import {
  WEBEE_CORE_POSITIONING,
  matchWebeeIndustry,
  webeeIndustryBrief,
} from "./webee-sales-context.shared";

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
  pitch: `A 30-SECOND PITCH. It is spoken out loud, so the whole "Say this" section must read in
about 30 seconds — roughly 75-85 words. Tight is the point; do not pad it.

Produce, as markdown with these exact headings:
## Hook
One catchy line, 12 words or fewer, about THIS company's world. Usable as an opener or an email
subject. No questions, no buzzwords, no "revolutionise".
## Say this
The actual 30-second pitch, as continuous spoken words in one short paragraph. Aim for 70-85
words — that is the 30 seconds. Under 60 words is too short and wastes the slot.
Structure it: their situation in one line → the cost of it → what WEBEE does about it → a single
ask for the next step. Plain spoken English. No headings, no bullets, no stage directions.
## Three points to land
Exactly 3 bullets, one line each — the points the 30 seconds must get across, so the rep can
recover if the conversation moves.
## If they push back
2-3 bullets, formatted "**What they say** — your reply in one sentence".
## Do not say
2 short bullets: the generic lines that would lose this particular buyer, and why.`,
  meeting: `AN IN-DEPTH MEETING PLAN. This is the rep's full working document for the call — assume
they will have it open in front of them. Be thorough and concrete; length is fine here.

Produce, as markdown with these exact headings:
## Objective
One sentence: the commitment you want by the end, not "build rapport".
## What we know and what we must confirm
Two short bullet groups, labelled "Known" and "To confirm", drawn from the lead's own record.
## Agenda
A timed running order for a 30-minute call, as "0-5 min — …" lines.
## Discovery questions
6-8 questions grouped under "Current situation", "Cost and volume" and "Decision process".
Ordered so each earns the right to ask the next. At least two must quantify call volume, missed
calls or staff time, so value can be costed later.
## Likely pain points
4-5 bullets, each with the business consequence, mapped to where this sector leaks.
## What to demonstrate
4-5 WEBEE capabilities. For each: why THIS lead should care, in one clause.
## Proof and numbers to use
3-4 bullets: the pilot metrics this sector measures, and how to frame them honestly. Never invent
a statistic or a customer name.
## Objections and responses
4-5 pairs, formatted "**Objection** — response". Anything this lead has already raised comes
first. Answer it directly; never dismiss it or promise something not in evidence. One pair must
handle "we are already looking at another AI voice tool" — that is where WEBEE's actual
differentiator belongs: a standalone builder gives you the voice agent, WEBEE gives you the
operational journey around it (qualify, book, CRM write-back, follow-up).
## Commercials to prepare for
2-3 bullets on pricing, pilot scope or procurement questions likely to come up.
## Next step
One sentence with a concrete commitment and a date or timeframe.
## Red flags
2-3 bullets: what would tell you this is not a real opportunity.`,
  demo: `AN IN-DEPTH DEMO PLAN. Assume the rep is running a live demo for this company and will work
from this document. Be thorough and specific; length is fine here.

Produce, as markdown with these exact headings:
## Demo checklist
6-8 items, each on its own line in the form "- [ ] item". Concrete preparation actions only —
what to set up, confirm, load or rehearse before this specific demo. No advice or explanation.
## Demo narrative
A short paragraph: the story the demo tells for this company, start to finish.
## Run of show
An ordered list of 5-7 steps, each as "Step — what you show — what you say while showing it".
Follow this sector's own workflow order.
## Suggested scenario
A concrete scenario in this company's own words: a real call or message this business would
plausibly receive, with the details a caller would actually give.
## Key points to explain
4-5 bullets, including where WEBEE ends and their people begin.
## Questions to ask during the demo
4-5 questions that surface buying signals while you have their attention.
## Concerns to expect
4-5 bullets drawn from this lead's previous interactions where there are any, each with how to
handle it live rather than deferring it.
## What could go wrong
2-3 bullets: the parts most likely to fail or confuse, and the fallback for each.
## After the demo
2-3 bullets: what to send, what to agree, and by when.`,
};

export const ASSISTANT_SYSTEM_PROMPT = `You are a sales strategist with thirty years of enterprise and SMB selling behind you, briefing a WeBespoke rep before they speak to a specific lead about WEBEE.

How you work:
- You are specific or you are useless. Generic sales copy is a failure. Every claim ties to this company's actual business.
- You use the lead's own history. If they raised a concern, you meet it head on. You never treat a warm lead as a cold one.
- You sell the consequence, not the feature. "Twelve missed calls a week" beats "24/7 availability".
- You stay on WEBEE's actual positioning as supplied below. You do not invent product capabilities.
- You never claim WEBEE replaces human expertise. The message is "both, not either/or": people keep judgement, exceptions, approval and accountability.
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

  // WEBEE's own story, and the industry deck that matches this lead. Without
  // these the model invented WEBEE's positioning from the product name and
  // produced plausible but off-message copy.
  lines.push("");
  lines.push("## What WEBEE actually is (use this, do not improvise it)");
  lines.push(WEBEE_CORE_POSITIONING);

  const haystack = [
    subject.company ?? "",
    subject.facts.map((f) => `${f.label} ${f.value}`).join(" "),
    research?.text ?? "",
  ].join(" ");
  lines.push("");
  lines.push("## Industry playbook");
  lines.push(webeeIndustryBrief(matchWebeeIndustry(haystack)));

  lines.push("");
  lines.push("## Task");
  lines.push(MODE_INSTRUCTIONS[mode]);

  return lines.join("\n");
}
